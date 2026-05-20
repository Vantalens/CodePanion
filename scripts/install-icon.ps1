# Generate CodePanion app/tray icons from packages/gui/Assets/image.png.
# Source of truth: image.png placed under packages/gui/Assets (any size PNG).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-icon.ps1
# Steps:
#   1. Trim near-white margins (keep the rounded-square container itself).
#   2. Write app-icon-64.png / app-icon-256.png for README/installer use.
#   3. Write multi-resolution app-icon.ico / tray-icon.ico (16..256).
# dist/ copies are not touched; next `npm run package:windows` re-copies them.
# All comments kept ASCII so PowerShell 5.x (CP936) parses this file safely.

[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repoRoot  = Resolve-Path (Join-Path $PSScriptRoot '..')
$assetsDir = Join-Path $repoRoot 'packages\gui\Assets'
$source    = Join-Path $assetsDir 'app-icon-source.png'

if (-not (Test-Path $source)) {
    throw "Source image not found: $source"
}

$src = [System.Drawing.Image]::FromFile($source)
Write-Host ("Source: {0}x{1}" -f $src.Width, $src.Height)

$bmp = New-Object System.Drawing.Bitmap $src
$src.Dispose()

function Get-TrimRect {
    param([System.Drawing.Bitmap]$Image, [int]$Threshold = 245)

    $rect = [System.Drawing.Rectangle]::new(0, 0, $Image.Width, $Image.Height)
    $data = $Image.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $stride = $data.Stride
        $bytes  = [byte[]]::new($stride * $Image.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    } finally {
        $Image.UnlockBits($data)
    }

    $w = $Image.Width; $h = $Image.Height
    $minX = $w; $minY = $h; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $h; $y++) {
        $rowOffset = $y * $stride
        for ($x = 0; $x -lt $w; $x++) {
            $i = $rowOffset + $x * 4
            $b = $bytes[$i]; $g = $bytes[$i+1]; $r = $bytes[$i+2]; $a = $bytes[$i+3]
            # Foreground = visible AND not near-white.
            $isWhite = ($r -ge $Threshold -and $g -ge $Threshold -and $b -ge $Threshold)
            if ($a -gt 8 -and -not $isWhite) {
                if ($x -lt $minX) { $minX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt 0) { return $null }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

$trim = Get-TrimRect -Image $bmp -Threshold 245
if ($null -eq $trim) {
    throw 'No foreground detected (image may be all near-white).'
}
Write-Host ("Trim rect: x={0} y={1} w={2} h={3}" -f $trim.X, $trim.Y, $trim.Width, $trim.Height)

# Expand to a square (longer side) with a small inset so the rounded square does not touch the canvas edge.
$side    = [Math]::Max($trim.Width, $trim.Height)
$padding = [int]([Math]::Round($side * 0.04))
$canvas  = $side + $padding * 2
$square  = New-Object System.Drawing.Bitmap $canvas, $canvas, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($square)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$destX = $padding + [int](($side - $trim.Width)  / 2)
$destY = $padding + [int](($side - $trim.Height) / 2)
$destRect = [System.Drawing.Rectangle]::new($destX, $destY, $trim.Width, $trim.Height)
$g.DrawImage($bmp, $destRect, $trim, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$bmp.Dispose()

Write-Host ("Square canvas: {0}x{1}" -f $square.Width, $square.Height)

function Resize-Image {
    param([System.Drawing.Bitmap]$Source, [int]$Size)
    $out = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gx = [System.Drawing.Graphics]::FromImage($out)
    $gx.Clear([System.Drawing.Color]::Transparent)
    $gx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gx.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gx.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gx.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $gx.DrawImage($Source, 0, 0, $Size, $Size)
    $gx.Dispose()
    return $out
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$resized = @{}
foreach ($s in $sizes) {
    $resized[$s] = Resize-Image -Source $square -Size $s
}

$resized[64].Save((Join-Path $assetsDir 'app-icon-64.png'),  [System.Drawing.Imaging.ImageFormat]::Png)
$resized[256].Save((Join-Path $assetsDir 'app-icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host 'Wrote app-icon-64.png / app-icon-256.png'

# ICO container: ICONDIR (6 bytes) + N * ICONDIRENTRY (16 bytes) + N image blobs.
# Storing PNG frames inside ICO is supported on Vista+.
function Write-Ico {
    param([string]$Path, [int[]]$IncludeSizes)

    $entries = @()
    foreach ($s in $IncludeSizes) {
        $bm = $resized[$s]
        $ms = New-Object System.IO.MemoryStream
        $bm.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $entries += [PSCustomObject]@{
            Size  = $s
            Bytes = $ms.ToArray()
        }
        $ms.Dispose()
    }

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter $fs
    try {
        $bw.Write([UInt16]0)
        $bw.Write([UInt16]1)
        $bw.Write([UInt16]$entries.Count)

        $offset = 6 + 16 * $entries.Count
        foreach ($e in $entries) {
            $dim = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
            $bw.Write([byte]$dim)
            $bw.Write([byte]$dim)
            $bw.Write([byte]0)
            $bw.Write([byte]0)
            $bw.Write([UInt16]1)
            $bw.Write([UInt16]32)
            $bw.Write([UInt32]$e.Bytes.Length)
            $bw.Write([UInt32]$offset)
            $offset += $e.Bytes.Length
        }
        foreach ($e in $entries) {
            $bw.Write($e.Bytes)
        }
    } finally {
        $bw.Dispose()
        $fs.Dispose()
    }
}

Write-Ico -Path (Join-Path $assetsDir 'app-icon.ico')  -IncludeSizes @(16, 24, 32, 48, 64, 128, 256)
Write-Ico -Path (Join-Path $assetsDir 'tray-icon.ico') -IncludeSizes @(16, 24, 32, 48)
Write-Host 'Wrote app-icon.ico / tray-icon.ico'

foreach ($s in $sizes) { $resized[$s].Dispose() }
$square.Dispose()

Write-Host 'Done.'
