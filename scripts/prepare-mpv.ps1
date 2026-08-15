$ErrorActionPreference = "Stop"
$destDir = Join-Path $PSScriptRoot "..\src-tauri\resources"
$dest = Join-Path $destDir "mpv.exe"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

if (Test-Path $dest) {
    Write-Host "mpv.exe already present at $dest"
    exit 0
}

$source = $null
if (Test-Path -LiteralPath "C:\mpv\mpv.exe") {
    $source = "C:\mpv\mpv.exe"
} elseif ($env:EJFLIX_MPV -and (Test-Path -LiteralPath $env:EJFLIX_MPV)) {
    $source = $env:EJFLIX_MPV
}

if (-not $source) {
    Write-Error "mpv.exe not found. Install mpv to C:\mpv or set EJFLIX_MPV."
}

Copy-Item -LiteralPath $source -Destination $dest
Write-Host "Copied $source -> $dest"
