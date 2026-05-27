param(
    [string]$RuntimeIdentifier = "win-x64",
    [string]$BuildRoot = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$buildArtifactsRoot = if ($BuildRoot) {
    $BuildRoot
} elseif ($env:CODEPANION_GUI_BUILD_ROOT) {
    $env:CODEPANION_GUI_BUILD_ROOT
} else {
    Join-Path $root ".artifacts\gui-build"
}
$publishRoot = Join-Path $buildArtifactsRoot "publish\$RuntimeIdentifier"
$publishDir = Join-Path $publishRoot "publish"
$distRoot = Join-Path $root "dist"
$distDir = Join-Path $distRoot "CodePanion-$RuntimeIdentifier"
$project = Join-Path $root "packages\gui\CodePanion.Gui.csproj"
$expectedNodeVersion = "v24.14.1"
$expectedNodeSha256 = "58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F"

function Resolve-NodePath {
    $configured = $env:CODEPANION_NODE_PATH
    if ($configured -and (Test-Path $configured)) {
        return (Resolve-Path $configured).Path
    }

    $preferred = "D:\Node.js\node.exe"
    if (Test-Path $preferred) {
        return (Resolve-Path $preferred).Path
    }

    $where = (where.exe node 2>$null | Select-Object -First 1)
    if ($where -and (Test-Path $where)) {
        return (Resolve-Path $where).Path
    }

    throw "node.exe not found. Install Node.js or set CODEPANION_NODE_PATH."
}

function Get-Sha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
            return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToUpperInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Assert-NodeRuntime {
    param([string]$NodePath)

    $version = (& $NodePath --version).Trim()
    if ($version -ne $expectedNodeVersion) {
        throw "node.exe version mismatch. Expected $expectedNodeVersion, got $version at $NodePath."
    }

    $hash = Get-Sha256 -Path $NodePath
    if ($hash -ne $expectedNodeSha256) {
        throw "node.exe SHA256 mismatch. Expected $expectedNodeSha256, got $hash at $NodePath."
    }

    return @{
        Version = $version
        Sha256 = $hash
    }
}

function Stop-RunningPortableGui {
    param([string]$PackageDir)

    $resolvedPackageDir = [System.IO.Path]::GetFullPath($PackageDir)
    $escapedPackageDir = $resolvedPackageDir.Replace("\", "\\")
    $running = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            $p = $null
            try { $p = $_.Path } catch { return $false }
            $p -and [System.IO.Path]::GetFullPath($p).StartsWith($resolvedPackageDir, [System.StringComparison]::OrdinalIgnoreCase)
        }

    foreach ($process in $running) {
        Write-Host "[package] Stopping running portable process. PID: $($process.Id), Name: $($process.ProcessName)"
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }

    $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and ($_.CommandLine -like "*$resolvedPackageDir*" -or $_.CommandLine -like "*$escapedPackageDir*")
        }

    foreach ($child in $children) {
        if ($child.ProcessId -eq $PID) {
            continue
        }
        Write-Host "[package] Stopping portable child process. PID: $($child.ProcessId), Name: $($child.Name)"
        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $child.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    }
}

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

# S-2：把 build-daemon-bundle.mjs 标 external 的包从仓库根 node_modules 拷到 dist 包的
# daemon/node_modules 旁边。Node 的 require 解析会自动从 daemon.cjs 所在目录向上找
# node_modules，所以放在 daemon/ 子目录的 node_modules 即可被命中。
function Copy-RuntimeModule {
    param(
        [string]$ModuleName,
        [string]$DestinationRoot,
        [string]$RepoRoot,
        [string[]]$ExcludeDirs = @()
    )

    $source = Join-Path $RepoRoot "node_modules\$ModuleName"
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Runtime module not found in repo root node_modules: $ModuleName"
    }
    $destination = Join-Path $DestinationRoot $ModuleName
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
        if ($ExcludeDirs -contains $_.Name) {
            return
        }
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Recurse -Force
    }
}

# 把 native binding 包 + pino transport 链拷过去；node-pty 体积绝大部分是其它平台的 prebuilds，
# 只保留当前 RuntimeIdentifier 对应那一份。
function Copy-DaemonRuntimeDependencies {
    param(
        [string]$DaemonRuntimeDir,
        [string]$RepoRoot,
        [string]$RuntimeIdentifier
    )

    $nodeModules = Join-Path $DaemonRuntimeDir "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null
    }

    # node-pty loads lib and the selected prebuild at runtime; node-addon-api only provides build headers.
    $platformPrebuild = switch ($RuntimeIdentifier) {
        "win-x64"   { "win32-x64" }
        "win-arm64" { "win32-arm64" }
        default     { "win32-x64" }
    }
    $allPrebuilds = @("darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64")
    $excludePrebuilds = @($allPrebuilds | Where-Object { $_ -ne $platformPrebuild })

    Copy-RuntimeModule -ModuleName "node-pty" -DestinationRoot $nodeModules -RepoRoot $RepoRoot -ExcludeDirs @("src", "deps", "scripts")
    $unwantedPrebuildRoot = Join-Path $nodeModules "node-pty\prebuilds"
    if (Test-Path -LiteralPath $unwantedPrebuildRoot) {
        Get-ChildItem -LiteralPath $unwantedPrebuildRoot -Directory -Force | ForEach-Object {
            if ($excludePrebuilds -contains $_.Name) {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force
            }
        }
    }
    # pino 链：sync:false destination 当前不会触发 worker，但保持磁盘路径完整可以让未来切到 transport
    # 模式也不会爆 MODULE_NOT_FOUND。
    $pinoModules = @(
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
        "@pinojs/redact"
    )
    foreach ($module in $pinoModules) {
        Copy-RuntimeModule -ModuleName $module -DestinationRoot $nodeModules -RepoRoot $RepoRoot -ExcludeDirs @(".github", ".vscode", "coverage", "fixtures", "scripts", "test", "tests", "docs", "example", "examples", "benchmark", "benchmarks")
    }

    Write-Host "[package] Daemon runtime deps copied to $nodeModules"
}

function Remove-PortableDevelopmentFiles {
    param([string]$PackageDir)

    Get-ChildItem -LiteralPath $PackageDir -Recurse -File -Force |
        Where-Object {
            $_.Extension -in @(".pdb", ".map") -or
            $_.Extension -eq ".ts" -or
            $_.Name -match "\.(test|spec)\.(js|mjs|cjs|ts)$"
        } |
        Remove-Item -Force

    $nodeModules = Join-Path $PackageDir "daemon\node_modules"
    if (Test-Path -LiteralPath $nodeModules) {
        Get-ChildItem -LiteralPath $nodeModules -Recurse -Directory -Force |
            Where-Object { $_.Name -match "^(\.github|\.vscode|coverage|fixtures|scripts|test|tests|docs|example|examples|benchmark|benchmarks)$" } |
            Sort-Object { $_.FullName.Length } -Descending |
            Remove-Item -Recurse -Force
    }
}

Set-Location -LiteralPath $root

Write-Host "[1/5] Building daemon bundle..."
npm run build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[2/5] Publishing GUI ($RuntimeIdentifier)..."
New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null
dotnet publish $project -c Release -r $RuntimeIdentifier --self-contained true -p:PublishSingleFile=false -m:1 "-p:BaseIntermediateOutputPath=$(Join-Path $publishRoot 'obj\')" "-p:MSBuildProjectExtensionsPath=$(Join-Path $publishRoot 'obj\')" "-p:BaseOutputPath=$(Join-Path $publishRoot 'bin\')" "-p:PublishDir=$publishDir\"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[3/5] Preparing portable package..."
Stop-RunningPortableGui -PackageDir $distDir
if (Test-Path $distDir) {
    Remove-DirectoryWithRetry -Path $distDir
}
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
# S-1: PS 5.1 与 PS 7 对 `Copy-Item -Path "<dir>\*" -Recurse` 的通配符行为不一致
# （PS 5 会按字面拷贝顶层文件，对子目录递归不稳）。改用 Get-ChildItem -Force 显式
# 枚举顶层条目，再用 Copy-Item -LiteralPath 一项一项递归拷贝，避免任何 wildcard 解析。
Get-ChildItem -LiteralPath $publishDir -Force | ForEach-Object {
    $destination = Join-Path $distDir $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}

$runtimeDir = Join-Path $distDir "runtime"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$nodePath = Resolve-NodePath
$nodeInfo = Assert-NodeRuntime -NodePath $nodePath
$packagedNodePath = Join-Path $runtimeDir "node.exe"
Copy-Item -LiteralPath $nodePath -Destination $packagedNodePath -Force
Assert-NodeRuntime -NodePath $packagedNodePath | Out-Null
Write-Host "[package] Node runtime: $($nodeInfo.Version), SHA256=$($nodeInfo.Sha256)"

# S-2：daemon.cjs 旁的 daemon/ 目录被 dotnet publish 拷过来（含 daemon.cjs），现在补上 external
# 依赖。FindDaemonEntry 已经认准 baseDir/daemon/daemon.cjs，所以 node_modules 放在
# daemon/node_modules 下即可被 Node require 解析命中（向上查找规则）。
$daemonRuntimeDir = Join-Path $distDir "daemon"
if (Test-Path -LiteralPath $daemonRuntimeDir) {
    Copy-DaemonRuntimeDependencies -DaemonRuntimeDir $daemonRuntimeDir -RepoRoot $root -RuntimeIdentifier $RuntimeIdentifier
} else {
    Write-Warning "daemon/ subdirectory missing in publish output; skipping runtime dep copy. Investigate csproj layout."
}

$readmePath = Join-Path $distDir "README_START.txt"
@(
    "CodePanion Portable Build (Windows Alpha)",
    "",
    "Start: double-click CodePanion.Gui.exe.",
    "The GUI starts the local daemon automatically. No separate Node.js or npm install is required for end users.",
    "Keep all files inside this directory tree. The GUI, daemon bundle, and packaged Node runtime must stay together.",
    "",
    "Logs and local config are written to %USERPROFILE%\\.codepanion\\ for the current Windows user.",
    "Uninstall: close the GUI and remove this directory."
) | Set-Content -LiteralPath $readmePath -Encoding UTF8

Remove-PortableDevelopmentFiles -PackageDir $distDir

Write-Host "[4/5] Validating portable package..."
& (Join-Path $PSScriptRoot "validate-portable-package.ps1") -RuntimeIdentifier $RuntimeIdentifier
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[5/5] Done."
Write-Host "Portable package: $distDir"
Write-Host "Entry: $(Join-Path $distDir 'CodePanion.Gui.exe')"
