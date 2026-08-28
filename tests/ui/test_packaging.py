from pathlib import Path

PROJECT_ROOT = Path(__file__).parents[2]


def test_windows_spec_is_one_file_windowed_and_non_elevated() -> None:
    spec = (PROJECT_ROOT / "hris-reconcile-ui.spec").read_text(encoding="utf-8")

    windows_branch = spec.split('elif sys.platform == "win32":', 1)[1].split(
        "else:", 1
    )[0]
    assert "COLLECT(" not in windows_branch
    assert 'name="HRIS-Reconciliation"' in windows_branch
    assert "console=False" in windows_branch
    assert "disable_windowed_traceback=True" in windows_branch
    assert "uac_admin=False" in windows_branch
    assert "upx=False" in windows_branch
    assert "version=str(windows_version_file)" in windows_branch


def test_windows_version_metadata_matches_project_version() -> None:
    metadata = (
        PROJECT_ROOT / "packaging" / "windows-version-info.txt"
    ).read_text(encoding="utf-8")

    assert "filevers=(0, 3, 0, 0)" in metadata
    assert "prodvers=(0, 3, 0, 0)" in metadata
    assert "StringStruct('FileVersion', '0.3.0')" in metadata
    assert "StringStruct('ProductVersion', '0.3.0')" in metadata
    assert "StringStruct('OriginalFilename', 'HRIS-Reconciliation.exe')" in metadata


def test_windows_build_script_uses_clean_environment_and_checks_archive() -> None:
    script = (PROJECT_ROOT / "scripts" / "build_windows.ps1").read_text(
        encoding="utf-8"
    )

    assert "[System.Guid]::NewGuid()" in script
    assert "pyinstaller==6.22.2" in script
    assert "pyi-archive_viewer.exe" in script
    assert "Get-FileHash -Algorithm SHA256" in script
    assert "Remove-Item -LiteralPath $BuildRoot" in script


def test_windows_artifact_verifier_checks_gui_version_signature_and_hash() -> None:
    script = (
        PROJECT_ROOT / "scripts" / "verify_windows_artifact.ps1"
    ).read_text(encoding="utf-8")

    assert "$Subsystem -ne 2" in script
    assert '$Version.FileVersion -ne "0.3.0.0"' in script
    assert "Get-AuthenticodeSignature" in script
    assert "$RequireSignature" in script
    assert "Get-FileHash -Algorithm SHA256" in script
