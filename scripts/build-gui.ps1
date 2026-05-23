param(
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "packages\gui\CodePanion.Gui.csproj"

if (-not $OutputRoot) {
    if ($env:CODEPANION_GUI_BUILD_ROOT) {
        $OutputRoot = $env:CODEPANION_GUI_BUILD_ROOT
    } else {
        $OutputRoot = Join-Path $root ".artifacts\gui-build"
    }
}

$buildRoot = if ($RuntimeIdentifier) {
    Join-Path $OutputRoot $RuntimeIdentifier
} else {
    Join-Path $OutputRoot "portable"
}

$objRoot = Join-Path $buildRoot "obj\"
$binRoot = Join-Path $buildRoot "bin\"

New-Item -ItemType Directory -Path $objRoot -Force | Out-Null
New-Item -ItemType Directory -Path $binRoot -Force | Out-Null

$arguments = @(
    "build"
    $project
    "-c"
    $Configuration
    "-m:1"
    "-p:BaseIntermediateOutputPath=$objRoot"
    "-p:MSBuildProjectExtensionsPath=$objRoot"
    "-p:BaseOutputPath=$binRoot"
)

if ($RuntimeIdentifier) {
    $arguments += @("-r", $RuntimeIdentifier)
}

Write-Host "[gui:build] dotnet $($arguments -join ' ')"
& dotnet @arguments
exit $LASTEXITCODE
