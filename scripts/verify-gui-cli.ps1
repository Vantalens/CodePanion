param(
    [int]$DaemonPort = 0
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$daemon = $null
$verifyDir = Join-Path $root ".artifacts\verify-gui-cli"

Set-Location -LiteralPath $root
New-Item -ItemType Directory -Path $verifyDir -Force | Out-Null

if ($DaemonPort -eq 0) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        $DaemonPort = $listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}
$daemonUrl = "http://127.0.0.1:$DaemonPort"

Write-Host "=== CodePanion GUI/CLI verification ===" -ForegroundColor Cyan

try {
    Write-Host "[1/5] Build Rust daemon and CLI..." -ForegroundColor Yellow
    Push-Location -LiteralPath (Join-Path $root "codepanion-rust")
    try {
        cargo build --release --bin codepanion-daemon --bin codepanion | Out-Host
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    $daemonPath = Join-Path $root "codepanion-rust\target\release\codepanion-daemon.exe"
    $cliPath = Join-Path $root "codepanion-rust\target\release\codepanion.exe"
    if (-not (Test-Path -LiteralPath $daemonPath)) {
        throw "Missing Rust daemon binary: $daemonPath"
    }
    if (-not (Test-Path -LiteralPath $cliPath)) {
        throw "Missing Rust CLI binary: $cliPath"
    }

    Write-Host "[2/5] Start Rust daemon..." -ForegroundColor Yellow
    $daemonOut = Join-Path $verifyDir "daemon.stdout.log"
    $daemonErr = Join-Path $verifyDir "daemon.stderr.log"
    Remove-Item -LiteralPath $daemonOut,$daemonErr -Force -ErrorAction SilentlyContinue
    $daemon = Start-Process -FilePath $daemonPath -ArgumentList "--serve $DaemonPort" -PassThru -WindowStyle Hidden -RedirectStandardOutput $daemonOut -RedirectStandardError $daemonErr
    Write-Host "Daemon PID: $($daemon.Id)"

    $ready = $false
    for ($i = 1; $i -le 30; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$daemonUrl/health" -TimeoutSec 1 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        if ($daemon.HasExited) {
            Write-Host "Daemon exited with code $($daemon.ExitCode)" -ForegroundColor Red
        }
        if (Test-Path -LiteralPath $daemonOut) {
            Write-Host "--- daemon stdout ---"
            Get-Content -LiteralPath $daemonOut | Out-Host
        }
        if (Test-Path -LiteralPath $daemonErr) {
            Write-Host "--- daemon stderr ---"
            Get-Content -LiteralPath $daemonErr | Out-Host
        }
        throw "Rust daemon did not become healthy at $daemonUrl"
    }

    Write-Host "[3/5] Verify HTTP API..." -ForegroundColor Yellow
    $apiTests = @(
        @{ Name = "Health"; Url = "/health" },
        @{ Name = "Projects"; Url = "/api/v1/projects" },
        @{ Name = "Providers"; Url = "/api/v1/providers" },
        @{ Name = "Scheduler"; Url = "/api/v1/scheduler/runs" },
        @{ Name = "Workflow Board"; Url = "/workflow/board" },
        @{ Name = "Models"; Url = "/v1/models" }
    )

    $passed = 0
    $apiLines = @()
    foreach ($test in $apiTests) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$daemonUrl$($test.Url)" -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  PASS $($test.Name)" -ForegroundColor Green
                $passed++
                $apiLines += "- $($test.Name): HTTP 200 $($test.Url)"
            } else {
                Write-Host "  FAIL $($test.Name) HTTP $($response.StatusCode)" -ForegroundColor Red
                $apiLines += "- $($test.Name): HTTP $($response.StatusCode) $($test.Url)"
            }
        } catch {
            Write-Host "  FAIL $($test.Name): $($_.Exception.Message)" -ForegroundColor Red
            $apiLines += "- $($test.Name): FAILED $($test.Url)"
        }
    }
    if ($passed -ne $apiTests.Count) {
        throw "HTTP API verification failed: $passed/$($apiTests.Count)"
    }

    Write-Host "[4/5] Verify CLI commands..." -ForegroundColor Yellow
    & $cliPath --api-url $daemonUrl provider list | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "provider list failed" }
    & $cliPath --api-url $daemonUrl model list | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "model list failed" }
    & $cliPath --api-url $daemonUrl status | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "status failed" }

    Write-Host "[5/5] Build GUI..." -ForegroundColor Yellow
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\build-gui.ps1") -Configuration Release | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "GUI build failed" }

    New-Item -ItemType Directory -Path (Join-Path $root ".claude") -Force | Out-Null
    $report = @(
        "# GUI/CLI verification report",
        "",
        "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Daemon: Rust daemon",
        "Result: PASS",
        "Port: $DaemonPort",
        "PID: $($daemon.Id)",
        "",
        "## HTTP API"
    ) + $apiLines + @(
        "",
        "## CLI",
        "- provider list: PASS",
        "- model list: PASS",
        "- status: PASS",
        "",
        "## GUI",
        "- Release build: PASS"
    )
    $report | Out-File -FilePath (Join-Path $root ".claude\GUI_VERIFICATION_REPORT.md") -Encoding UTF8

    Write-Host "Verification passed." -ForegroundColor Green
    exit 0
} finally {
    if ($daemon -ne $null) {
        Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $daemon.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
}
