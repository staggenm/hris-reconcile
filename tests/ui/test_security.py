import http.client
import subprocess
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from hris_reconcile.security import _is_loopback_address
from hris_reconcile.ui.server import LocalServer, create_server

PROJECT_ROOT = Path(__file__).parents[2]


@contextmanager
def running_server(token: str = "correct-token") -> Iterator[LocalServer]:
    server = create_server(token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def response(
    server: LocalServer, path: str, *, headers: dict[str, str] | None = None
) -> http.client.HTTPResponse:
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
    connection.request("GET", path, headers=headers or {})
    result = connection.getresponse()
    result.read()
    return result


def test_server_binds_only_to_ipv4_loopback_and_uses_ephemeral_port() -> None:
    server = create_server("token")
    try:
        assert server.server_address[0] == "127.0.0.1"
        assert server.server_address[1] != 0
        assert server.server_name == "127.0.0.1"
    finally:
        server.server_close()


def test_missing_and_wrong_tokens_are_rejected_without_cors() -> None:
    with running_server() as server:
        missing = response(server, "/api/identity/suggestion")
        wrong = response(
            server,
            "/api/identity/suggestion",
            headers={"X-Auth-Token": "wrong-token"},
        )

    assert missing.status == 403
    assert wrong.status == 403
    assert missing.getheader("Access-Control-Allow-Origin") is None
    assert wrong.getheader("Access-Control-Allow-Origin") is None


def test_foreign_host_and_origin_are_rejected() -> None:
    with running_server() as server:
        foreign_host = response(
            server,
            "/api/identity/suggestion",
            headers={"Host": "attacker.invalid", "X-Auth-Token": "correct-token"},
        )
        foreign_origin = response(
            server,
            "/api/identity/suggestion",
            headers={
                "Origin": "https://attacker.invalid",
                "X-Auth-Token": "correct-token",
            },
        )

    assert foreign_host.status == 403
    assert foreign_origin.status == 403
    assert foreign_origin.getheader("Access-Control-Allow-Origin") is None


def test_index_requires_query_token_and_static_assets_are_local() -> None:
    with running_server() as server:
        denied = response(server, "/")
        allowed = response(server, "/?token=correct-token")
        script = response(server, "/app.js")

    assert denied.status == 403
    assert allowed.status == 200
    assert script.status == 200
    assert allowed.getheader("Access-Control-Allow-Origin") is None

    static = PROJECT_ROOT / "src" / "hris_reconcile" / "ui" / "static"
    for name in ("index.html", "app.js", "app.css"):
        content = (static / name).read_text(encoding="utf-8")
        assert "http://" not in content
        assert "https://" not in content


def test_network_tripwire_aborts_external_socket_operations() -> None:
    connect = subprocess.run(
        [
            sys.executable,
            "-c",
            "from hris_reconcile.security import install_network_tripwire; "
            "import socket; install_network_tripwire(); "
            "socket.create_connection(('192.0.2.1', 9), timeout=.01)",
        ],
        check=False,
    )
    sendto = subprocess.run(
        [
            sys.executable,
            "-c",
            "from hris_reconcile.security import install_network_tripwire; "
            "import socket; install_network_tripwire(); "
            "socket.socket(type=socket.SOCK_DGRAM).sendto(b'test', "
            "('192.0.2.1', 9))",
        ],
        check=False,
    )
    getaddrinfo = subprocess.run(
        [
            sys.executable,
            "-c",
            "from hris_reconcile.security import install_network_tripwire; "
            "import socket; install_network_tripwire(); "
            "socket.getaddrinfo('external.invalid', 443)",
        ],
        check=False,
    )

    assert connect.returncode == 70
    assert sendto.returncode == 70
    assert getaddrinfo.returncode == 70


def test_network_tripwire_permits_loopback_and_server_startup() -> None:
    loopback = subprocess.run(
        [
            sys.executable,
            "-c",
            "from hris_reconcile.security import install_network_tripwire; "
            "import socket; install_network_tripwire(); s=socket.socket(); "
            "socket.getaddrinfo('localhost', 80); "
            "\ntry: s.connect(('127.0.0.1', 9))\nexcept OSError: pass",
        ],
        check=False,
    )
    startup = subprocess.run(
        [
            sys.executable,
            "-c",
            "from hris_reconcile.security import install_network_tripwire; "
            "install_network_tripwire(); "
            "from hris_reconcile.ui.server import create_server; "
            "server=create_server('token'); server.server_close()",
        ],
        check=False,
    )

    assert loopback.returncode == 0
    assert startup.returncode == 0


def test_unknown_address_shape_is_not_loopback() -> None:
    assert not _is_loopback_address(["127.0.0.1", 80])
