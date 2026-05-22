param(
    [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $root "packages\gui\bin\Release\net8.0-windows\$RuntimeIdentifier\publish"
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
    $running = Get-Process -Name "CodePanion.Gui" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and [System.IO.Path]::GetFullPath($_.Path).StartsWith($resolvedPackageDir, [System.StringComparison]::OrdinalIgnoreCase)
        }

    foreach ($process in $running) {
        Write-Host "[package] Stopping running portable GUI. PID: $($process.Id)"
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

Set-Location -LiteralPath $root

Write-Host "[1/4] Building daemon bundle..."
npm run build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[2/4] Publishing GUI ($RuntimeIdentifier)..."
dotnet publish $project -c Release -r $RuntimeIdentifier --self-contained true -p:PublishSingleFile=false
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "[3/4] Preparing portable package..."
Stop-RunningPortableGui -PackageDir $distDir
if (Test-Path $distDir) {
    Remove-DirectoryWithRetry -Path $distDir
}
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Copy-Item -Path (Join-Path $publishDir "*") -Destination $distDir -Recurse -Force

$runtimeDir = Join-Path $distDir "runtime"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$nodePath = Resolve-NodePath
$nodeInfo = Assert-NodeRuntime -NodePath $nodePath
$packagedNodePath = Join-Path $runtimeDir "node.exe"
Copy-Item -LiteralPath $nodePath -Destination $packagedNodePath -Force
Assert-NodeRuntime -NodePath $packagedNodePath | Out-Null
Write-Host "[package] Node runtime: $($nodeInfo.Version), SHA256=$($nodeInfo.Sha256)"

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

Write-Host "[4/4] Done."
Write-Host "Portable package: $distDir"
Write-Host "Entry: $(Join-Path $distDir 'CodePanion.Gui.exe')"
