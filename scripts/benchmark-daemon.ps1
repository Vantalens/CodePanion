#!/usr/bin/env pwsh
# Performance benchmark script for Rust daemon

$ErrorActionPreference = "Stop"

Write-Host "=== CodePanion Rust Daemon Performance Benchmark ===" -ForegroundColor Cyan
Write-Host ""

# Build release binary
Write-Host "[1/4] Building release binary..." -ForegroundColor Yellow
Set-Location codepanion-rust
cargo build --release --bin codepanion-daemon 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

$binaryPath = "target\release\codepanion-daemon.exe"
$binary = Get-Item $binaryPath

# Binary size
Write-Host "[2/4] Measuring binary size..." -ForegroundColor Yellow
$sizeMB = [math]::Round($binary.Length / 1MB, 2)
Write-Host "Binary size: $sizeMB MB" -ForegroundColor Green
Write-Host "  Target: < 20 MB" -ForegroundColor Gray
if ($sizeMB -lt 20) {
    Write-Host "  ✓ PASS" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL" -ForegroundColor Red
}
Write-Host ""

# Cold start time
Write-Host "[3/4] Measuring cold start time..." -ForegroundColor Yellow
$coldStartTimes = @()
for ($i = 1; $i -le 5; $i++) {
    $start = Get-Date
    $process = Start-Process -FilePath $binaryPath -ArgumentList "--serve", "18318" -PassThru -WindowStyle Hidden

    # Wait for daemon to be ready
    $ready = $false
    $timeout = 5000  # 5 seconds
    $elapsed = 0
    while (-not $ready -and $elapsed -lt $timeout) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:18318/health" -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $ready = $true
            }
        } catch {
            Start-Sleep -Milliseconds 50
            $elapsed += 50
        }
    }

    $end = Get-Date
    $coldStartMs = ($end - $start).TotalMilliseconds
    $coldStartTimes += $coldStartMs

    Stop-Process -Id $process.Id -Force
    Start-Sleep -Milliseconds 500
}

$avgColdStart = [math]::Round(($coldStartTimes | Measure-Object -Average).Average, 2)
Write-Host "Cold start time (avg of 5): $avgColdStart ms" -ForegroundColor Green
Write-Host "  Target: < 500 ms" -ForegroundColor Gray
if ($avgColdStart -lt 500) {
    Write-Host "  ✓ PASS" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL" -ForegroundColor Red
}
Write-Host ""

# Memory usage
Write-Host "[4/4] Measuring memory usage..." -ForegroundColor Yellow
$process = Start-Process -FilePath $binaryPath -ArgumentList "--serve", "18318" -PassThru -WindowStyle Hidden

# Wait for daemon to be ready
Start-Sleep -Seconds 2

# Get idle memory
$proc = Get-Process -Id $process.Id
$idleMemoryMB = [math]::Round($proc.WorkingSet64 / 1MB, 2)

Write-Host "Idle memory: $idleMemoryMB MB" -ForegroundColor Green
Write-Host "  Target: < 50 MB" -ForegroundColor Gray
if ($idleMemoryMB -lt 50) {
    Write-Host "  ✓ PASS" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL" -ForegroundColor Red
}

Stop-Process -Id $process.Id -Force
Write-Host ""

# Summary
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Binary size:      $sizeMB MB (target: < 20 MB)" -ForegroundColor $(if ($sizeMB -lt 20) {"Green"} else {"Red"})
Write-Host "Cold start:       $avgColdStart ms (target: < 500 ms)" -ForegroundColor $(if ($avgColdStart -lt 500) {"Green"} else {"Red"})
Write-Host "Idle memory:      $idleMemoryMB MB (target: < 50 MB)" -ForegroundColor $(if ($idleMemoryMB -lt 50) {"Green"} else {"Red"})
Write-Host ""

# Exit code
$allPass = ($sizeMB -lt 20) -and ($avgColdStart -lt 500) -and ($idleMemoryMB -lt 50)
if ($allPass) {
    Write-Host "✓ All benchmarks PASSED" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ Some benchmarks FAILED" -ForegroundColor Red
    exit 1
}
