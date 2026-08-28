"""Guarded loopback HTTP transport for the local reconciliation workbench."""

import hmac
import json
import mimetypes
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
from typing import Any, ClassVar, cast
from urllib.parse import parse_qs, urlsplit

from pydantic import ValidationError

from hris_reconcile.ui import api
from hris_reconcile.ui.contract_builder import WizardConfigurationError
from hris_reconcile.ui.csv_upload import CsvParseError
from hris_reconcile.ui.session import Session

_MISSING_QUERY = "<missing>"
MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
HEARTBEAT_TIMEOUT_SECONDS = 90.0


class RequestBodyTooLargeError(ValueError):
    """Raised before reading a request body that exceeds the upload limit."""


def static_directory() -> Path:
    """Resolve packaged static assets in source and PyInstaller builds."""
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root is not None:
        return Path(cast(str, bundle_root)) / "hris_reconcile" / "ui" / "static"
    return Path(__file__).with_name("static")


class LocalServer(ThreadingHTTPServer):
    """HTTP server carrying its one in-memory session and capability token."""

    daemon_threads = True

    def __init__(
        self,
        token: str,
        session: Session | None = None,
        *,
        heartbeat_timeout_seconds: float = HEARTBEAT_TIMEOUT_SECONDS,
    ) -> None:
        self.auth_token = token
        self.session = session or Session()
        self.heartbeat_timeout_seconds = heartbeat_timeout_seconds
        self._heartbeat_deadline: float | None = None
        self._heartbeat_lock = threading.Lock()
        self._watchdog_stop = threading.Event()
        super().__init__(("127.0.0.1", 0), LocalRequestHandler)

    def server_bind(self) -> None:
        # HTTPServer resolves its bind address with getfqdn(). The workbench has
        # no use for a hostname, and avoiding that lookup prevents a DNS query
        # during startup while preserving TCPServer's exact bind behavior.
        TCPServer.server_bind(self)
        self.server_name = "127.0.0.1"
        self.server_port = self.server_address[1]

    def serve_forever(self, poll_interval: float = 0.5) -> None:
        self._watchdog_stop.clear()
        watchdog = threading.Thread(
            target=self._watch_heartbeat,
            name="hris-reconcile-heartbeat",
            daemon=True,
        )
        watchdog.start()
        try:
            super().serve_forever(poll_interval)
        finally:
            self._watchdog_stop.set()
            watchdog.join(timeout=1.0)

    def record_heartbeat(self) -> None:
        """Extend the lifetime of a browser-owned in-memory session."""
        with self._heartbeat_lock:
            self._heartbeat_deadline = (
                time.monotonic() + self.heartbeat_timeout_seconds
            )

    def request_shutdown(self) -> None:
        """Clear sensitive state and stop after the current response is sent."""
        self.session.clear()
        timer = threading.Timer(0.05, self.shutdown)
        timer.daemon = True
        timer.start()

    def _watch_heartbeat(self) -> None:
        while not self._watchdog_stop.wait(1.0):
            with self._heartbeat_lock:
                deadline = self._heartbeat_deadline
            if deadline is not None and time.monotonic() >= deadline:
                self.session.clear()
                self.shutdown()
                return

    @property
    def expected_host(self) -> str:
        return f"127.0.0.1:{self.server_port}"

    @property
    def expected_origin(self) -> str:
        return f"http://{self.expected_host}"


class LocalRequestHandler(BaseHTTPRequestHandler):
    """Validate transport security, then route to framework-free API functions."""

    server: LocalServer
    protocol_version = "HTTP/1.1"
    _STATIC: ClassVar[dict[str, str]] = {
        "/app.js": "app.js",
        "/app.css": "app.css",
    }

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_OPTIONS(self) -> None:
        status = (
            HTTPStatus.METHOD_NOT_ALLOWED
            if self._transport_allowed()
            else HTTPStatus.FORBIDDEN
        )
        self._empty(status)

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def do_DELETE(self) -> None:
        self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        if not self._transport_allowed():
            self._empty(HTTPStatus.FORBIDDEN)
            return
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            if not self._token_allowed():
                self._empty(HTTPStatus.FORBIDDEN)
                return
            self._dispatch_api(method, parsed.path, parse_qs(parsed.query))
            return
        if method != "GET":
            self._empty(HTTPStatus.METHOD_NOT_ALLOWED)
            return
        if parsed.path in ("/", "/index.html"):
            query_token = parse_qs(parsed.query).get("token", [""])[0]
            if not hmac.compare_digest(query_token, self.server.auth_token):
                self._empty(HTTPStatus.FORBIDDEN)
                return
            self._static("index.html")
            return
        filename = self._STATIC.get(parsed.path)
        if filename is None:
            self._empty(HTTPStatus.NOT_FOUND)
            return
        self._static(filename)

    def _transport_allowed(self) -> bool:
        if self.headers.get("Host") != self.server.expected_host:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin == self.server.expected_origin

    def _token_allowed(self) -> bool:
        supplied = self.headers.get("X-Auth-Token", "")
        return hmac.compare_digest(supplied, self.server.auth_token)

    def _read_body(self) -> bytes:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("request body length is required")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ValueError("invalid request body length") from error
        if length < 0:
            raise ValueError("invalid request body length")
        if length > MAX_REQUEST_BODY_BYTES:
            raise RequestBodyTooLargeError(
                "The selected file exceeds the 64 MiB upload limit. "
                "Choose a smaller CSV file."
            )
        return self.rfile.read(length)

    def _json_body(self, model: type[api.RequestModel]) -> api.RequestModel:
        try:
            return model.model_validate_json(self._read_body())
        except ValidationError as error:
            raise ValueError("invalid request body") from error

    def _dispatch_api(
        self, method: str, path: str, query: dict[str, list[str]]
    ) -> None:
        try:
            response = self._route(method, path, query)
        except RequestBodyTooLargeError as error:
            self.close_connection = True
            self._json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": str(error)},
                {"Connection": "close"},
            )
        except (WizardConfigurationError, CsvParseError, ValueError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception:
            self._json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The local reconciliation request failed."},
            )
        else:
            if response is not None:
                self._json(HTTPStatus.OK, response)

    def _route(self, method: str, path: str, query: dict[str, list[str]]) -> Any:
        parts = path.strip("/").split("/")
        if len(parts) >= 3 and parts[:2] == ["api", "dataset"]:
            side = self._side(parts[2])
            if len(parts) == 3 and method == "POST":
                filename = self.headers.get("X-Filename", "").strip()
                if not filename:
                    raise ValueError("X-Filename header is required")
                return api.upload_dataset(
                    self.server.session, side, self._read_body(), filename
                )
            if len(parts) == 3 and method == "DELETE":
                return api.delete_dataset(self.server.session, side)
            if len(parts) == 4 and parts[3] == "name" and method == "PUT":
                body = cast(
                    api.DatasetNameRequest,
                    self._json_body(api.DatasetNameRequest),
                )
                return api.set_dataset_name(self.server.session, side, body)
        routes: dict[tuple[str, str], Any] = {
            ("GET", "/api/identity/suggestion"): lambda: api.identity_suggestion(
                self.server.session
            ),
            ("POST", "/api/identity/score"): lambda: api.identity_score(
                self.server.session,
                cast(api.IdentityPairRequest, self._json_body(api.IdentityPairRequest)),
            ),
            ("POST", "/api/identity/confirm"): lambda: api.confirm_identity(
                self.server.session,
                cast(api.IdentityPairRequest, self._json_body(api.IdentityPairRequest)),
            ),
            ("GET", "/api/fields/suggestions"): lambda: api.field_suggestions(
                self.server.session
            ),
            ("POST", "/api/fields/confirm"): lambda: api.confirm_fields(
                self.server.session,
                cast(
                    api.FieldsConfirmRequest,
                    self._json_body(api.FieldsConfirmRequest),
                ),
            ),
            ("POST", "/api/mappings/observed"): lambda: api.observed_mappings(
                self.server.session,
                cast(
                    api.MappingObservedRequest,
                    self._json_body(api.MappingObservedRequest),
                ),
            ),
            ("POST", "/api/mappings/confirm"): lambda: api.confirm_mappings(
                self.server.session,
                cast(
                    api.MappingsConfirmRequest,
                    self._json_body(api.MappingsConfirmRequest),
                ),
            ),
            ("POST", "/api/run"): lambda: api.run_reconciliation(
                self.server.session,
                cast(api.RunRequest, self._json_body(api.RunRequest)),
            ),
            ("GET", "/api/results/summary"): lambda: api.results_summary(
                self.server.session
            ),
            ("GET", "/api/results/by-field"): lambda: api.results_by_field(
                self.server.session
            ),
            ("GET", "/api/results/matching"): lambda: api.matching_results(
                self.server.session
            ),
            ("POST", "/api/session/clear"): self._clear_session,
            ("POST", "/api/session/heartbeat"): self._heartbeat,
            ("POST", "/api/session/shutdown"): self._shutdown,
        }
        callback = routes.get((method, path))
        if callback is not None:
            return callback()
        if method == "GET" and path == "/api/results/by-pair":
            return api.results_by_pair(self.server.session, self._query(query, "field"))
        if method == "GET" and path == "/api/results/details":
            field_name = self._query(query, "field")
            return api.result_details(
                self.server.session,
                field_name,
                left_value=self._nullable_query(query, "left"),
                right_value=self._nullable_query(query, "right"),
                filter_left="left" in query,
                filter_right="right" in query,
            )
        if method == "GET" and path.startswith("/api/download/"):
            name = path.removeprefix("/api/download/")
            content, content_type, filename = api.download(self.server.session, name)
            self._bytes(
                HTTPStatus.OK,
                content,
                content_type,
                {"Content-Disposition": f'attachment; filename="{filename}"'},
            )
            return None
        raise ValueError("unknown API route")

    def _clear_session(self) -> dict[str, bool]:
        self.server.session.clear()
        return {"ok": True}

    def _heartbeat(self) -> dict[str, bool]:
        self.server.record_heartbeat()
        return {"ok": True}

    def _shutdown(self) -> dict[str, bool]:
        self.server.request_shutdown()
        return {"ok": True}

    @staticmethod
    def _side(value: str) -> api.Side:
        if value not in ("left", "right"):
            raise ValueError("dataset side must be left or right")
        return cast(api.Side, value)

    @staticmethod
    def _query(query: dict[str, list[str]], name: str) -> str:
        values = query.get(name)
        if not values or not values[0]:
            raise ValueError(f"query parameter {name!r} is required")
        return values[0]

    @staticmethod
    def _nullable_query(query: dict[str, list[str]], name: str) -> str | None:
        values = query.get(name)
        if not values:
            return None
        return None if values[0] == _MISSING_QUERY else values[0]

    def _static(self, filename: str) -> None:
        path = static_directory() / filename
        try:
            content = path.read_bytes()
        except OSError:
            self._empty(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        self._bytes(HTTPStatus.OK, content, content_type)

    def _json(
        self,
        status: HTTPStatus,
        value: Any,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self._bytes(
            status,
            content,
            "application/json; charset=utf-8",
            extra_headers,
        )

    def _empty(self, status: HTTPStatus) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _bytes(
        self,
        status: HTTPStatus,
        content: bytes,
        content_type: str,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy", "default-src 'self'; connect-src 'self'"
        )
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(content)


def create_server(
    token: str,
    session: Session | None = None,
    *,
    heartbeat_timeout_seconds: float = HEARTBEAT_TIMEOUT_SECONDS,
) -> LocalServer:
    """Create a guarded server bound only to an OS-assigned loopback port."""
    return LocalServer(
        token,
        session,
        heartbeat_timeout_seconds=heartbeat_timeout_seconds,
    )
