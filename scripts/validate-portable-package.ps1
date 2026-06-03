param(
    [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "dist\CodePanion-$RuntimeIdentifier"
$daemonExe = Join-Path $distDir "daemon\codepanion-daemon.exe"
$cliExe = Join-Path $distDir "codepanion-cli.exe"

function Assert-PathExists {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Portable package is missing required path: $Path"
    }
}

$requiredPaths = @(
    (Join-Path $distDir "CodePanion.exe"),
    (Join-Path $distDir "README_START.txt"),
    $daemonExe,
    $cliExe
)
foreach ($path in $requiredPaths) {
    Assert-PathExists -Path $path
}

$forbiddenRuntimePaths = @(
    (Join-Path $distDir "daemon\daemon.cjs"),
    (Join-Path $distDir "daemon\node_modules"),
    (Join-Path $distDir "runtime\node.exe"),
    (Join-Path $distDir "CodePanion.Gui.exe")
)
foreach ($path in $forbiddenRuntimePaths) {
    if (Test-Path -LiteralPath $path) {
        throw "Portable package still contains legacy Node daemon runtime path: $path"
    }
}

$forbiddenFiles = @(Get-ChildItem -LiteralPath $distDir -Recurse -File -Force |
    Where-Object {
        $_.Extension -in @(".pdb", ".map") -or
        $_.Extension -eq ".ts" -or
        $_.Name -match "\.(test|spec)\.(js|mjs|cjs|ts)$"
    })
if ($forbiddenFiles.Count -gt 0) {
    throw "Portable package contains development/debug files: $($forbiddenFiles[0].FullName)"
}

$forbiddenDirectories = @(Get-ChildItem -LiteralPath $distDir -Recurse -Directory -Force |
    Where-Object { $_.Name -match "^(\.github|\.vscode|coverage|fixtures|scripts|test|tests|docs|example|examples|benchmark|benchmarks)$" })
if ($forbiddenDirectories.Count -gt 0) {
    throw "Portable package contains development-only directories: $($forbiddenDirectories[0].FullName)"
}

& $daemonExe
if ($LASTEXITCODE -ne 0) {
    throw "Packaged Rust daemon failed to start in help/version mode."
}

& $cliExe --help | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Packaged CodePanion CLI failed to print help."
}

Write-Host "[validate] Portable package Rust runtime probe passed: $distDir"
