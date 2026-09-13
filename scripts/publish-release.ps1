# Builds the installer, copies it to release/ and publishes a GitHub release
# (tag vX.Y.Z, installer attached) so installed copies of ejFlix see the update.
#
#   powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1            # build + publish
#   powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1 -SkipBuild # reuse the last build
#   powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1 -Notes notes.md
#
# Needs the GitHub CLI signed in (`gh auth login`). The version comes from package.json;
# the release body is taken from -Notes when given, otherwise from GitHub's generated notes.

param(
    [switch]$SkipBuild,
    [string]$Notes = "",
    [switch]$Draft
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$tag = "v$version"
$asset = "ejFlix_${version}_x64-setup.exe"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is not installed: https://cli.github.com/"
}

if (-not $SkipBuild) {
    Write-Host "Building ejFlix $version..." -ForegroundColor Cyan
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
}

$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "$root\src-tauri\target" }
$built = Join-Path $targetDir "release\bundle\nsis\$asset"
if (-not (Test-Path $built)) { throw "Installer not found: $built" }

New-Item -ItemType Directory -Force "$root\release" | Out-Null
Copy-Item $built "$root\release\$asset" -Force
Write-Host "Installer: release\$asset" -ForegroundColor Green

$existing = gh release view $tag 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Release $tag already exists; uploading the installer (overwrite)." -ForegroundColor Yellow
    gh release upload $tag "$root\release\$asset" --clobber
    if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }
} else {
    $args = @("release", "create", $tag, "$root\release\$asset", "--title", "ejFlix $version")
    if ($Notes -and (Test-Path $Notes)) { $args += @("--notes-file", $Notes) } else { $args += "--generate-notes" }
    if ($Draft) { $args += "--draft" }
    & gh @args
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
}

Write-Host "Published $tag. Installed copies will offer the update on their next launch." -ForegroundColor Green
