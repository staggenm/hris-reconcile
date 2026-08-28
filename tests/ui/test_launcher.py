import ctypes
import io
import sys
from types import SimpleNamespace

import pytest

from hris_reconcile.ui import launcher


def test_print_url_is_safe_without_a_console(monkeypatch) -> None:
    monkeypatch.setattr(sys, "stdout", None)

    launcher._print_url("http://127.0.0.1:1234/?token=test")


def test_print_url_writes_when_console_is_available(monkeypatch) -> None:
    output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", output)

    launcher._print_url("http://127.0.0.1:1234/?token=test")

    assert "http://127.0.0.1:1234/?token=test" in output.getvalue()


def test_browser_failure_uses_platform_fallback(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(launcher.webbrowser, "open", lambda url: False)
    monkeypatch.setattr(launcher, "_show_launch_fallback", calls.append)

    launcher._open_browser("http://127.0.0.1:1234/?token=test")

    assert calls == ["http://127.0.0.1:1234/?token=test"]


def test_windows_startup_failure_uses_generic_native_dialog(monkeypatch) -> None:
    messages: list[tuple[object, ...]] = []
    user32 = SimpleNamespace(MessageBoxW=lambda *args: messages.append(args))
    monkeypatch.setattr(launcher.platform, "system", lambda: "Windows")
    monkeypatch.setattr(
        ctypes,
        "windll",
        SimpleNamespace(user32=user32),
        raising=False,
    )

    launcher._show_startup_failure()

    assert len(messages) == 1
    assert messages[0][2] == "HRIS Reconciliation"
    assert "could not start" in str(messages[0][1])


def test_main_hides_unexpected_exception_details(monkeypatch) -> None:
    shown: list[bool] = []

    def fail() -> None:
        raise RuntimeError("sensitive local path or field value")

    monkeypatch.setattr(launcher, "_run_workbench", fail)
    monkeypatch.setattr(
        launcher,
        "_show_startup_failure",
        lambda: shown.append(True),
    )

    with pytest.raises(SystemExit) as exit_info:
        launcher.main()

    assert exit_info.value.code == 1
    assert shown == [True]
