param(
    [int]$Port = 7791
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $root
try {
    cargo build -p codepanion-daemon --release | Out-Host
    $exe = Join-Path $root "target\release\codepanion-daemon.exe"
    if (-not (Test-Path $exe)) {
        throw "daemon binary not found: $exe"
    }

    $sizeBytes = (Get-Item $exe).Length
    $process = $null
    try {
        $startWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $process = Start-Process -FilePath $exe -ArgumentList @("--serve", $Port) -PassThru -WindowStyle Hidden

        $health = $null
        do {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
            } catch {
                Start-Sleep -Milliseconds 10
            }
            if ($startWatch.ElapsedMilliseconds -gt 5000) {
                throw "daemon did not become healthy within 5s"
            }
        } while ($null -eq $health)
        $startWatch.Stop()

        Start-Sleep -Milliseconds 250
        $process.Refresh()
        $workingSetBytes = $process.WorkingSet64

        $healthWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
        $healthWatch.Stop()

        $wsWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $client = [System.Net.Sockets.TcpClient]::new("127.0.0.1", $Port)
        try {
            $stream = $client.GetStream()
            $request = "GET /ws HTTP/1.1`r`nHost: 127.0.0.1:$Port`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==`r`nSec-WebSocket-Version: 13`r`n`r`n"
            $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
            $stream.Write($bytes, 0, $bytes.Length)
            $buffer = New-Object byte[] 2048
            $read = $stream.Read($buffer, 0, $buffer.Length)
            $wsWatch.Stop()
            $wsText = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
            if (-not $wsText.Contains("101 Switching Protocols") -or -not $wsText.Contains('"type":"hello"')) {
                throw "websocket smoke failed: $wsText"
            }
        } finally {
            $client.Close()
        }

        [pscustomobject]@{
            binary = $exe
            binaryBytes = $sizeBytes
            binaryMiB = [math]::Round($sizeBytes / 1MB, 2)
            coldStartMs = $startWatch.ElapsedMilliseconds
            workingSetBytes = $workingSetBytes
            workingSetMiB = [math]::Round($workingSetBytes / 1MB, 2)
            healthLatencyMs = $healthWatch.ElapsedMilliseconds
            websocketHelloMs = $wsWatch.ElapsedMilliseconds
            healthPid = $health.pid
            healthVersion = $health.version
        } | ConvertTo-Json -Depth 3
    } finally {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }
} finally {
    Pop-Location
}

