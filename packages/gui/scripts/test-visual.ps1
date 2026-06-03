$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$repoRoot = Split-Path -Parent (Split-Path -Parent $root)
$vite = Join-Path $repoRoot "node_modules\vite\bin\vite.js"

if (-not (Test-Path -LiteralPath $vite)) {
    throw "Vite entry not found: $vite"
}

$process = Start-Process `
    -FilePath "node.exe" `
    -ArgumentList @($vite, "--host", "127.0.0.1", "--port", "3000") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $connect = $client.BeginConnect("127.0.0.1", 3000, $null, $null)
            if ($connect.AsyncWaitHandle.WaitOne(500)) {
                $client.EndConnect($connect)
                $client.Close()
                $ready = $true
                break
            }
            $client.Close()
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $ready) {
        throw "Vite dev server did not open http://127.0.0.1:3000"
    }

    Push-Location $root
    try {
        npx playwright test --config playwright.config.cjs
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} finally {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
