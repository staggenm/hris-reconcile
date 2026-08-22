import os
import sys
import tomllib
from pathlib import Path

import pytest

from hris_reconcile.ui import launcher

PROJECT_ROOT = Path(__file__).parents[2]


def test_streamlit_configuration_is_local_and_disables_statistics() -> None:
    with (PROJECT_ROOT / ".streamlit" / "config.toml").open("rb") as stream:
        configuration = tomllib.load(stream)

    assert configuration["server"]["address"] == "127.0.0.1"
    assert configuration["server"]["headless"] is True
    assert configuration["browser"]["gatherUsageStats"] is False


def test_packaged_launcher_repeats_privacy_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[str] = []

    class ExecCalled(Exception):
        pass

    def capture(_executable: str, command: list[str]) -> None:
        captured.extend(command)
        raise ExecCalled

    monkeypatch.setattr(os, "execv", capture)

    with pytest.raises(ExecCalled):
        launcher.main()

    assert captured[:4] == [sys.executable, "-m", "streamlit", "run"]
    assert "--server.address=127.0.0.1" in captured
    assert "--server.headless=true" in captured
    assert "--browser.gatherUsageStats=false" in captured


def test_streamlit_app_imports_without_starting_a_server() -> None:
    from hris_reconcile.ui import app

    assert callable(app.main)


def test_streamlit_app_upload_smoke_flow() -> None:
    from streamlit.testing.v1 import AppTest

    app_path = PROJECT_ROOT / "src" / "hris_reconcile" / "ui" / "app.py"
    example = PROJECT_ROOT / "examples" / "core_hr_vs_payroll"
    application = AppTest.from_file(app_path).run(timeout=10)
    application.file_uploader[0].upload(
        "core_hr.csv", (example / "core_hr.csv").read_bytes(), "text/csv"
    )
    application.file_uploader[1].upload(
        "payroll.csv", (example / "payroll.csv").read_bytes(), "text/csv"
    )

    application.run(timeout=10)

    assert not application.exception
    assert [item.value for item in application.header] == [
        "1. Upload datasets",
        "2. Match employees",
    ]
    assert [item.value for item in application.selectbox] == [
        "person_id",
        "employee_number",
    ]
