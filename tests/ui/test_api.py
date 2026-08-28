import http.client
import json
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

import pytest

from hris_reconcile.ui import server as server_module
from hris_reconcile.ui.server import (
    MAX_REQUEST_BODY_BYTES,
    LocalServer,
    create_server,
)

PROJECT_ROOT = Path(__file__).parents[2]
EXAMPLE = PROJECT_ROOT / "examples" / "core_hr_vs_payroll"
TOKEN = "api-test-token"


@contextmanager
def running_server() -> Iterator[LocalServer]:
    server = create_server(TOKEN)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def call(
    server: LocalServer,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    request_headers = {"X-Auth-Token": TOKEN, **(headers or {})}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
    connection.request(method, path, body=body, headers=request_headers)
    response = connection.getresponse()
    content = response.read()
    connection.close()
    return response.status, content


def json_call(
    server: LocalServer,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    status, content = call(
        server, method, path, payload=payload, body=body, headers=headers
    )
    assert status == 200, content.decode("utf-8")
    return json.loads(content)


def full_api_run(server: LocalServer) -> dict[str, Any]:
    json_call(
        server,
        "POST",
        "/api/dataset/left",
        body=(EXAMPLE / "core_hr.csv").read_bytes(),
        headers={"X-Filename": "core_hr.csv"},
    )
    json_call(
        server,
        "POST",
        "/api/dataset/right",
        body=(EXAMPLE / "payroll.csv").read_bytes(),
        headers={"X-Filename": "payroll.csv"},
    )
    json_call(
        server,
        "POST",
        "/api/identity/confirm",
        payload={"left_column": "person_id", "right_column": "employee_number"},
    )
    json_call(
        server,
        "POST",
        "/api/fields/confirm",
        payload={
            "fields": [
                {
                    "left_column": "first_name",
                    "right_column": "given_name",
                    "mode": "Normalized text",
                },
                {
                    "left_column": "last_name",
                    "right_column": "surname",
                    "mode": "Normalized text",
                },
                {
                    "left_column": "company",
                    "right_column": "company_code",
                    "mode": "Value mapping",
                },
            ]
        },
    )
    json_call(
        server,
        "POST",
        "/api/mappings/confirm",
        payload={
            "fields": [
                {
                    "left_column": "company",
                    "mappings": [
                        {
                            "canonical_value": "DE_GERMANY",
                            "left_values": ["DE01"],
                            "right_values": ["1000"],
                        },
                        {
                            "canonical_value": "CH_SWITZERLAND",
                            "left_values": ["CH01"],
                            "right_values": ["2000"],
                        },
                    ],
                }
            ]
        },
    )
    return cast(
        dict[str, Any],
        json_call(
            server,
            "POST",
            "/api/run",
            payload={"name": "core_hr_vs_payroll"},
        ),
    )


def test_real_http_api_reproduces_cli_example_counts() -> None:
    with running_server() as server:
        summary = full_api_run(server)

    assert summary["identity_counts"] == {
        "MATCHED": 9,
        "MISSING_LEFT": 1,
        "MISSING_RIGHT": 1,
        "DUPLICATE_LEFT": 0,
        "DUPLICATE_RIGHT": 0,
    }
    assert summary["field_counts"] == {
        "MATCH_EXACT": 15,
        "MATCH_NORMALIZED": 2,
        "MATCH_MAPPED": 8,
        "MISMATCH": 1,
        "LEFT_NULL": 0,
        "RIGHT_NULL": 0,
        "BOTH_NULL": 0,
        "UNMAPPED_LEFT": 1,
        "UNMAPPED_RIGHT": 0,
    }


def test_full_api_run_creates_no_files() -> None:
    temporary_root = Path(tempfile.gettempdir())
    project_before = {
        path.relative_to(PROJECT_ROOT) for path in PROJECT_ROOT.rglob("*")
    }
    temporary_before = {path.name for path in temporary_root.iterdir()}

    with running_server() as server:
        full_api_run(server)
        status, report = call(server, "GET", "/api/download/report.json")

    project_after = {path.relative_to(PROJECT_ROOT) for path in PROJECT_ROOT.rglob("*")}
    temporary_after = {path.name for path in temporary_root.iterdir()}
    assert status == 200
    assert report.startswith(b"{")
    assert project_after == project_before
    assert temporary_after == temporary_before


def test_oversized_upload_is_rejected_from_headers_and_closes_connection() -> None:
    with running_server() as server:
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
        connection.putrequest("POST", "/api/dataset/left")
        connection.putheader("X-Auth-Token", TOKEN)
        connection.putheader("X-Filename", "oversized.csv")
        connection.putheader("Content-Length", str(MAX_REQUEST_BODY_BYTES + 1))
        connection.endheaders()
        response = connection.getresponse()
        content = response.read()
        status = response.status
        connection_header = response.getheader("Connection")
        cors_header = response.getheader("Access-Control-Allow-Origin")
        connection.close()

    assert status == 413
    assert connection_header == "close"
    assert cors_header is None
    assert "64 MiB" in json.loads(content)["error"]


def test_upload_just_under_configured_limit_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    content = b"person_id,name\n1,Ada\n"
    monkeypatch.setattr(server_module, "MAX_REQUEST_BODY_BYTES", len(content) + 1)

    with running_server() as server:
        status, response = call(
            server,
            "POST",
            "/api/dataset/left",
            body=content,
            headers={"X-Filename": "small.csv"},
        )

    assert status == 200
    assert json.loads(response)["row_count"] == 1


def test_shutdown_endpoint_clears_session_and_stops_server() -> None:
    server = create_server(TOKEN)
    server.session.dataset_names["left"] = "Sensitive source"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status, response = call(server, "POST", "/api/session/shutdown")
        thread.join(timeout=2.0)

        assert status == 200
        assert json.loads(response) == {"ok": True}
        assert not thread.is_alive()
        assert server.session.dataset_names == {}
    finally:
        if thread.is_alive():
            server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


def test_missing_heartbeat_clears_session_and_stops_server() -> None:
    server = create_server(TOKEN, heartbeat_timeout_seconds=0.01)
    server.session.dataset_names["left"] = "Sensitive source"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status, response = call(server, "POST", "/api/session/heartbeat")
        thread.join(timeout=2.0)

        assert status == 200
        assert json.loads(response) == {"ok": True}
        assert not thread.is_alive()
        assert server.session.dataset_names == {}
    finally:
        if thread.is_alive():
            server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)
