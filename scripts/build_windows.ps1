[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "The Windows executable must be built on Windows."
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "hris-reconcile-build-" + [System.Guid]::NewGuid().ToString("N")
)
$VirtualEnvironment = Join-Path $BuildRoot "venv"
$PythonExecutable = Join-Path $VirtualEnvironment "Scripts\python.exe"
$PyInstallerExecutable = Join-Path $VirtualEnvironment "Scripts\pyinstaller.exe"
$ArchiveViewerExecutable = Join-Path $VirtualEnvironment "Scripts\pyi-archive_viewer.exe"
$Artifact = Join-Path $ProjectRoot "dist\HRIS-Reconciliation.exe"
$SpecFile = Join-Path $ProjectRoot "hris-reconcile-ui.spec"
$DistPath = Join-Path $ProjectRoot "dist"
$WorkPath = Join-Path $ProjectRoot "build"
$ForbiddenPattern = (
    "^\s*(streamlit|pandas|pyarrow|numpy|altair|requests|pytest|mypy|ruff)(\.|$)"
)
$LocationPushed = $false

try {
    Push-Location $ProjectRoot
    $LocationPushed = $true
    & py -3.12 -m venv $VirtualEnvironment
    & $PythonExecutable -m pip install --upgrade pip
    & $PythonExecutable -m pip install $ProjectRoot "pyinstaller==6.22.2"
    & $PyInstallerExecutable --clean --noconfirm --distpath $DistPath `
        --workpath $WorkPath $SpecFile

    if (-not (Test-Path $Artifact -PathType Leaf)) {
        throw "PyInstaller did not create $Artifact"
    }
    $ArchiveListing = & $ArchiveViewerExecutable -r -b $Artifact
    if ($ArchiveListing | Select-String -Pattern $ForbiddenPattern -Quiet) {
        throw "The executable archive contains a forbidden package."
    }

    $Hash = Get-FileHash -Algorithm SHA256 $Artifact
    Write-Host "Built $Artifact"
    Write-Host "SHA256 $($Hash.Hash)"
}
finally {
    if ($LocationPushed) {
        Pop-Location
    }
    if (Test-Path $BuildRoot) {
        Remove-Item -LiteralPath $BuildRoot -Recurse -Force
    }
}
