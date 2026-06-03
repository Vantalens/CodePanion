param(
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$guiRoot = Join-Path $root "packages\gui"

Set-Location -LiteralPath $guiRoot
Write-Host "[gui:build] npm run tauri:build"
npm run tauri:build
exit $LASTEXITCODE
