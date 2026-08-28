"""PyInstaller definition for the windowed local workbench."""

import sys
from pathlib import Path

project_root = Path.cwd()
static_root = project_root / "src" / "hris_reconcile" / "ui" / "static"
windows_version_file = project_root / "packaging" / "windows-version-info.txt"

analysis = Analysis(
    [str(project_root / "src" / "hris_reconcile" / "ui" / "launcher.py")],
    pathex=[str(project_root / "src")],
    binaries=[],
    datas=[
        (
            str(static_root),
            "hris_reconcile/ui/static",
        )
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # The UI process does not import CLI formatting or development packages.
    # Excluding them prevents packages left in a developer venv from widening
    # the shipped dependency surface through optional-import hooks.
    excludes=[
        "PIL",
        "click",
        "mypy",
        "numpy",
        "pygments",
        "rich",
        "setuptools",
        "toml",
        "typer",
    ],
    noarchive=False,
    optimize=0,
)
archive = PYZ(analysis.pure)

if sys.platform == "darwin":
    executable = EXE(
        archive,
        analysis.scripts,
        [],
        exclude_binaries=True,
        name="hris-reconcile-ui",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        console=False,
        disable_windowed_traceback=True,
    )
    collection = COLLECT(
        executable,
        analysis.binaries,
        analysis.datas,
        strip=False,
        upx=True,
        name="hris-reconcile-ui",
    )
    application = BUNDLE(
        collection,
        name="HRIS Reconciliation.app",
        bundle_identifier="org.hris-reconcile.workbench",
        info_plist={
            "CFBundleDisplayName": "HRIS Reconciliation",
            "CFBundleShortVersionString": "0.3.0",
            "NSHighResolutionCapable": True,
        },
    )
elif sys.platform == "win32":
    executable = EXE(
        archive,
        analysis.scripts,
        analysis.binaries,
        analysis.datas,
        [],
        name="HRIS-Reconciliation",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
        disable_windowed_traceback=True,
        uac_admin=False,
        version=str(windows_version_file),
    )
else:
    executable = EXE(
        archive,
        analysis.scripts,
        analysis.binaries,
        analysis.datas,
        [],
        name="hris-reconcile-ui",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=True,
    )
