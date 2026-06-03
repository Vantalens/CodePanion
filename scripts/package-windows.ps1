param(
    [string]$RuntimeIdentifier = "win-x64",
    [string]$BuildRoot = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $root "dist"
$distDir = Join-Path $distRoot "CodePanion-$RuntimeIdentifier"
$guiRoot = Join-Path $root "packages\gui"
$tauriReleaseDir = Join-Path $guiRoot "src-tauri\target\release"
$rustReleaseDir = Join-Path $root "codepanion-rust\target\release"

function Remove-DirectoryWithRetry {
    param([string]$Path)

    for ($attempt = 1; $attempt -le 8; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 8) {
                throw
            }
            Start-Sleep -Milliseconds (350 * $attempt)
        }
    }
}

Set-Location -LiteralPath $root

Write-Host "[1/4] Building Rust daemon and CLI..."
Push-Location -LiteralPath (Join-Path $root "codepanion-rust")
try {
    cargo build --release --bin codepanion-daemon --bin codepanion
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "[2/4] Building Tauri GUI..."
Push-Location -LiteralPath $guiRoot
try {
    npm run tauri:build
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "[3/4] Preparing portable package..."
if (Test-Path -LiteralPath $distDir) {
    Remove-DirectoryWithRetry -Path $distDir
}
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

$guiExe = Join-Path $tauriReleaseDir "CodePanion.exe"
if (-not (Test-Path -LiteralPath $guiExe)) {
    throw "Tauri GUI exe not found: $guiExe"
}
Copy-Item -LiteralPath $guiExe -Destination (Join-Path $distDir "CodePanion.exe") -Force

$daemonRuntimeDir = Join-Path $distDir "daemon"
New-Item -ItemType Directory -Path $daemonRuntimeDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $rustReleaseDir "codepanion-daemon.exe") -Destination (Join-Path $daemonRuntimeDir "codepanion-daemon.exe") -Force
Copy-Item -LiteralPath (Join-Path $rustReleaseDir "codepanion.exe") -Destination (Join-Path $distDir "codepanion-cli.exe") -Force

$bundleRoot = Join-Path $tauriReleaseDir "bundle"
if (Test-Path -LiteralPath $bundleRoot) {
    Copy-Item -LiteralPath $bundleRoot -Destination (Join-Path $distDir "installer-bundle") -Recurse -Force
}

$readmePath = Join-Path $distDir "README_START.txt"
@(
    "CodePanion Portable Build (Tauri GUI)",
    "",
    "Start: double-click CodePanion.exe.",
    "The GUI starts the local Rust daemon automatically.",
    "Keep the daemon directory next to CodePanion.exe.",
    "",
    "Logs and local config are written to %USERPROFILE%\.codepanion\ for the current Windows user.",
    "Legacy WPF GUI source remains in packages/gui-wpf-legacy for one transition cycle."
) | Set-Content -LiteralPath $readmePath -Encoding UTF8

Write-Host "[4/4] Done."
Write-Host "Portable package: $distDir"
Write-Host "Entry: $(Join-Path $distDir 'CodePanion.exe')"
