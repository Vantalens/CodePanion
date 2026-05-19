param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "packages\gui\CodePanion.Gui.csproj"
$exe = Join-Path $root "packages\gui\bin\$Configuration\net8.0-windows\CodePanion.Gui.exe"

$running = Get-Process -Name "CodePanion.Gui" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like (Join-Path $root "packages\gui\bin\*") } |
    Select-Object -First 1

if ($running) {
    Write-Host "[GUI] CodePanion.Gui is already running. PID: $($running.Id). Skip build and duplicate start."
    exit 0
}

if (-not (Test-Path $exe)) {
    Write-Host "[GUI] $Configuration output not found. Building..."
    dotnet build $project -c $Configuration
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host "[GUI] Starting CodePanion.Gui ($Configuration)..."
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
