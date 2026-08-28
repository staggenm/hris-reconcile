# Windows build and release procedure

The Windows deliverable is one `HRIS-Reconciliation.exe` with no console and no
Python prerequisite. Build and test it natively on 64-bit Windows 10 and Windows
11. PyInstaller does not cross-compile Windows executables from macOS or Linux.

The application must run as a standard user. Do not select **Run as
administrator** and do not configure compatibility settings that request
elevation. PyInstaller one-file applications extract their runtime into a
temporary `_MEI...` directory. That directory may contain application code and
dependencies, but it must never contain uploaded datasets, configuration, or
reconciliation output.

## 1. Prerequisites

- 64-bit Windows 10 or 11
- Python 3.12 available through the Windows `py` launcher
- PowerShell 5.1 or newer
- repository checked out locally
- Windows SDK `signtool.exe` for the signing stage
- an organization-controlled Authenticode certificate for release builds

Before signing, replace the placeholder `CompanyName` and copyright strings in
`packaging/windows-version-info.txt` with the legal publisher identity that will
appear in the certificate.

## 2. Test the source tree

From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\pytest.exe -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\mypy.exe --strict src
```

All checks must pass on Windows. In particular, the audit-hook subprocess tests
must return the expected hard-abort code for external TCP, UDP, and DNS access.

## 3. Build from a clean environment

```powershell
.\scripts\build_windows.ps1
```

The script creates an isolated temporary virtual environment, installs only the
project runtime plus pinned PyInstaller, builds the one-file executable, checks
the embedded archive for forbidden packages, prints its SHA-256 hash, and removes
the temporary environment. Expected output:

```text
dist\HRIS-Reconciliation.exe
```

Do not distribute an artifact if its archive contains Streamlit, pandas,
PyArrow, NumPy, Altair, requests, pytest, mypy, or Ruff.

## 4. Verify the unsigned artifact

```powershell
.\scripts\verify_windows_artifact.ps1
```

The verifier checks the PE signature, Windows GUI subsystem, embedded product
and file version, current Authenticode status, and SHA-256 hash. Before signing,
`Signature: NotSigned` is expected. A console window must not appear when the
executable is launched by double-clicking.

## 5. Network and lifecycle acceptance

Launch the executable as a standard user. While it is running, inspect every
process with its executable name:

```powershell
Get-Process HRIS-Reconciliation | ForEach-Object {
    Get-NetTCPConnection -OwningProcess $_.Id -State Listen
}
```

Every listener must have local address `127.0.0.1` and an ephemeral port. Reject
the artifact if it listens on `0.0.0.0`, `::`, a LAN address, or a fixed port.

From an administrator PowerShell used only to configure the test environment,
block outbound traffic for the executable:

```powershell
$Artifact = (Resolve-Path .\dist\HRIS-Reconciliation.exe).Path
New-NetFirewallRule -DisplayName "HRIS Reconciliation outbound denial test" `
    -Direction Outbound -Program $Artifact -Action Block -Profile Any
```

With the rule active, complete a reconciliation using
`tests\system_a_extract.csv` and `tests\system_b_extract.csv`. Confirm that:

- the browser opens and the complete wizard works;
- browser network requests target only the assigned loopback origin;
- missing or incorrect tokens receive `403`;
- foreign `Host` and `Origin` values receive `403`;
- all three result downloads work;
- **Quit** clears the session and stops both one-file processes;
- closing the tab stops the process immediately or after the heartbeat timeout;
- relaunching starts with an empty session and a new token and port.

Remove the temporary firewall rule after the test:

```powershell
Remove-NetFirewallRule -DisplayName "HRIS Reconciliation outbound denial test"
```

Creating or removing the firewall rule requires elevation. The application
itself must remain non-elevated throughout the test.

## 6. Filesystem privacy acceptance

Use Process Monitor or equivalent endpoint tooling during upload,
reconciliation, drill-down, clear, and quit operations. The executable may write
its `_MEI...` runtime files. It must not write:

- uploaded CSV contents;
- parsed or preview data;
- field or value mappings;
- session or reconciliation state;
- application logs containing identities or source values;
- CSV or JSON output unless the analyst explicitly downloads it.

Force-terminate one test run and inspect any residual `_MEI...` directory. It
must contain application/runtime files only, never HR data.

## 7. Sign and timestamp

Keep certificate material and passwords outside the repository. Prefer the
organization's managed signing service or hardware-backed certificate store.
Using the Windows SDK and an approved RFC 3161 timestamp service:

```powershell
signtool sign /fd SHA256 /tr <RFC3161_TIMESTAMP_URL> /td SHA256 /a `
    .\dist\HRIS-Reconciliation.exe
signtool verify /pa /all /v .\dist\HRIS-Reconciliation.exe
.\scripts\verify_windows_artifact.ps1 -RequireSignature
```

Calculate and record the SHA-256 hash after signing because signing changes the
file. Never reuse the unsigned artifact's hash as the release checksum.

## 8. Final release gate

Release only when all of these are recorded:

- Windows 10 and Windows 11 source tests passed;
- one-file executable built from the clean environment;
- GUI subsystem verified and no console observed;
- no elevation requested or used by the application;
- manifest inspection passed;
- full reconciliation passed with executable outbound traffic blocked;
- loopback-only listener confirmed;
- filesystem privacy inspection passed;
- valid timestamped Authenticode signature verified;
- final SHA-256 checksum recorded;
- clean-machine launch passed without Python installed.

Primary references: [PyInstaller operating mode](https://www.pyinstaller.org/en/stable/operating-mode.html),
[PyInstaller usage](https://pyinstaller.org/en/stable/usage.html),
[Microsoft firewall configuration](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure),
and [Microsoft Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures).
