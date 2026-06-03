$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$guiRoot = Join-Path $root "packages\gui"

Set-Location -LiteralPath $guiRoot
Write-Host "[GUI] Starting Tauri + React CodePanion GUI..."
npm run tauri:dev
exit $LASTEXITCODE
