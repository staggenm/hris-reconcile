[CmdletBinding()]
param(
    [string]$Artifact = "",
    [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "The Windows executable must be verified on Windows."
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Artifact) {
    $Artifact = Join-Path $ProjectRoot "dist\HRIS-Reconciliation.exe"
}
if (-not (Test-Path $Artifact -PathType Leaf)) {
    throw "Windows artifact not found: $Artifact"
}

$Bytes = [System.IO.File]::ReadAllBytes($Artifact)
if ($Bytes.Length -lt 256) {
    throw "Artifact is too small to be a valid Windows executable."
}
$PeOffset = [System.BitConverter]::ToInt32($Bytes, 0x3c)
$PeSignature = [System.Text.Encoding]::ASCII.GetString($Bytes, $PeOffset, 4)
if ($PeSignature -ne "PE`0`0") {
    throw "Artifact does not have a valid PE signature."
}

$OptionalHeaderOffset = $PeOffset + 24
$SubsystemOffset = $OptionalHeaderOffset + 68
$Subsystem = [System.BitConverter]::ToUInt16($Bytes, $SubsystemOffset)
if ($Subsystem -ne 2) {
    throw "Artifact is not a Windows GUI application (subsystem=$Subsystem)."
}

$Version = (Get-Item $Artifact).VersionInfo
if ($Version.FileVersion -ne "0.3.0.0") {
    throw "Unexpected file version: $($Version.FileVersion)"
}
if ($Version.ProductName -ne "HRIS Reconciliation") {
    throw "Unexpected product name: $($Version.ProductName)"
}

$Signature = Get-AuthenticodeSignature $Artifact
if ($RequireSignature -and $Signature.Status -ne "Valid") {
    throw "Authenticode signature is not valid: $($Signature.Status)"
}

$Hash = Get-FileHash -Algorithm SHA256 $Artifact
Write-Host "Artifact: $Artifact"
Write-Host "Subsystem: Windows GUI"
Write-Host "Version: $($Version.FileVersion)"
Write-Host "Signature: $($Signature.Status)"
Write-Host "SHA256: $($Hash.Hash)"
