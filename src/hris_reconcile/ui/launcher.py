"""Launch the guarded, in-memory local reconciliation workbench."""

import platform
import secrets
import subprocess
import sys
import webbrowser

from hris_reconcile.security import install_network_tripwire

_STARTUP_FAILURE_MESSAGE = (
    "HRIS Reconciliation could not start. No uploaded data was saved. "
    "Please contact support."
)


def _print_url(url: str) -> None:
    if sys.stdout is not None:
        print(f"HRIS Reconciliation is available at {url}", flush=True)


def _show_launch_fallback(url: str) -> None:
    message = (
        "The browser did not open automatically. Copy this address into your "
        f"browser:\n\n{url}"
    )
    system = platform.system()
    if system == "Darwin":
        subprocess.run(
            [
                "osascript",
                "-e",
                'display dialog "HRIS Reconciliation could not open the browser. " '
                '& "Copy this address into your browser:" & return & return & '
                f'"{url}" with title "HRIS Reconciliation" buttons {{"OK"}}',
            ],
            check=False,
        )
    elif system == "Windows":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            0,
            message,
            "HRIS Reconciliation",
            0x10,
        )
    else:
        _print_url(url)


def _show_startup_failure() -> None:
    system = platform.system()
    if system == "Darwin":
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display dialog "{_STARTUP_FAILURE_MESSAGE}" '
                'with title "HRIS Reconciliation" buttons {"OK"} '
                "with icon stop",
            ],
            check=False,
        )
    elif system == "Windows":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            0,
            _STARTUP_FAILURE_MESSAGE,
            "HRIS Reconciliation",
            0x10,
        )
    elif sys.stderr is not None:
        print(_STARTUP_FAILURE_MESSAGE, file=sys.stderr, flush=True)


def _open_browser(url: str) -> None:
    try:
        opened = webbrowser.open(url)
    except webbrowser.Error:
        opened = False
    if not opened:
        _show_launch_fallback(url)


def _run_workbench() -> None:
    install_network_tripwire()
    from hris_reconcile.ui.server import create_server

    token = secrets.token_urlsafe(32)
    server = create_server(token)
    url = f"http://127.0.0.1:{server.server_port}/?token={token}"
    _print_url(url)
    _open_browser(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    try:
        _run_workbench()
    except Exception:
        # Windowed builds have no safe traceback destination. Keep the message
        # generic because exception text may contain local paths or field values.
        _show_startup_failure()
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
