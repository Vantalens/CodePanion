param(
    [string]$RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$publishDir = Join-Path $root "packages\gui\bin\Release\net8.0-windows\$RuntimeIdentifier\publish"
$distRoot = Join-Path $root "dist"
$distDir = Join-Path $distRoot "RemindAI-$RuntimeIdentifier"
$project = Join-Path $root "packages\gui\RemindAI.Gui.csproj"

function Resolve-NodePath {
    $configured = $env:REMINDAI_NODE_PATH
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

    throw "node.exe not found. Install Node.js or set REMINDAI_NODE_PATH."
}

function Stop-RunningPortableGui {
    param([string]$PackageDir)

    $resolvedPackageDir = [System.IO.Path]::GetFullPath($PackageDir)
    $escapedPackageDir = $resolvedPackageDir.Replace("\", "\\")
    $running = Get-Process -Name "RemindAI.Gui" -ErrorAction SilentlyContinue |
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
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtimeDir "node.exe") -Force

$readmePath = Join-Path $distDir "README_START.txt"
@(
    "RemindAI portable package",
    "",
    "Start: double-click RemindAI.Gui.exe",
    "The GUI will start the local daemon automatically.",
    "Do not move files out of this folder individually."
) | Set-Content -LiteralPath $readmePath -Encoding UTF8

Write-Host "[4/4] Done."
Write-Host "Portable package: $distDir"
Write-Host "Entry: $(Join-Path $distDir 'RemindAI.Gui.exe')"
