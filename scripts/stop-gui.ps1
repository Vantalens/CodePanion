$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$running = Get-Process -Name "CodePanion.Gui" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like (Join-Path $root "packages\gui\bin\*") }

if (-not $running) {
    Write-Host "[GUI] CodePanion.Gui is not running."
    exit 0
}

foreach ($process in $running) {
    Write-Host "[GUI] Stopping CodePanion.Gui. PID: $($process.Id)..."
    Stop-Process -Id $process.Id -Force
}
