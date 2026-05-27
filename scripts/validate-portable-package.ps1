param(
    [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "dist\CodePanion-$RuntimeIdentifier"
$nodeModules = Join-Path $distDir "daemon\node_modules"
$packagedNode = Join-Path $distDir "runtime\node.exe"

function Assert-PathExists {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Portable package is missing required path: $Path"
    }
}

$requiredPaths = @(
    (Join-Path $distDir "CodePanion.Gui.exe"),
    (Join-Path $distDir "README_START.txt"),
    (Join-Path $distDir "daemon\daemon.cjs"),
    $packagedNode,
    $nodeModules
)
foreach ($path in $requiredPaths) {
    Assert-PathExists -Path $path
}

$allowedModules = @(
    "node-pty",
    "pino",
    "sonic-boom",
    "thread-stream",
    "atomic-sleep",
    "on-exit-leak-free",
    "pino-abstract-transport",
    "pino-std-serializers",
    "process-warning",
    "quick-format-unescaped",
    "real-require",
    "safe-stable-stringify",
    "@pinojs\redact"
)
$actualModules = @()
Get-ChildItem -LiteralPath $nodeModules -Directory -Force | ForEach-Object {
    if ($_.Name.StartsWith("@")) {
        Get-ChildItem -LiteralPath $_.FullName -Directory -Force | ForEach-Object {
            $actualModules += (Join-Path $_.Parent.Name $_.Name)
        }
    } else {
        $actualModules += $_.Name
    }
}
$unexpectedModules = @($actualModules | Where-Object { $allowedModules -notcontains $_ })
if ($unexpectedModules.Count -gt 0) {
    throw "Portable package contains unapproved runtime modules: $($unexpectedModules -join ', ')"
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

$forbiddenDirectories = @(Get-ChildItem -LiteralPath $nodeModules -Recurse -Directory -Force |
    Where-Object { $_.Name -match "^(\.github|\.vscode|coverage|fixtures|scripts|test|tests|docs|example|examples|benchmark|benchmarks)$" })
if ($forbiddenDirectories.Count -gt 0) {
    throw "Portable package contains development-only directories: $($forbiddenDirectories[0].FullName)"
}

$requiredPrebuild = switch ($RuntimeIdentifier) {
    "win-x64"   { "win32-x64" }
    "win-arm64" { "win32-arm64" }
    default     { throw "Unsupported portable runtime identifier: $RuntimeIdentifier" }
}
$prebuildRoot = Join-Path $nodeModules "node-pty\prebuilds"
Assert-PathExists -Path (Join-Path $prebuildRoot $requiredPrebuild)
$unexpectedPrebuilds = @(Get-ChildItem -LiteralPath $prebuildRoot -Directory -Force |
    Where-Object { $_.Name -ne $requiredPrebuild })
if ($unexpectedPrebuilds.Count -gt 0) {
    throw "Portable package contains native prebuilds for unsupported platforms: $($unexpectedPrebuilds.Name -join ', ')"
}

Push-Location -LiteralPath $distDir
try {
    & $packagedNode -e "require('./daemon/node_modules/node-pty'); require('./daemon/node_modules/pino'); require('./daemon/node_modules/sonic-boom'); require('./daemon/node_modules/thread-stream'); console.log('portable runtime deps ok');"
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged Node.js failed to load daemon runtime dependencies."
    }
} finally {
    Pop-Location
}

Write-Host "[validate] Portable package allowlist and runtime probe passed: $distDir"
