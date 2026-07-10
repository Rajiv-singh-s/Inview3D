# ===========================================================================
# InView3D — local setup (Windows / PowerShell)
#
# Installs Node dependencies and prepares the .env file. It does NOT install
# the native CV toolchain (FFmpeg, COLMAP, OpenMVS) — use Docker for that, or
# install them manually and put them on PATH. See README "Troubleshooting".
# ===========================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "$root/.env")) {
    Copy-Item "$root/.env.example" "$root/.env"
    Write-Host "Created .env from .env.example" -ForegroundColor Green
}

Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
Set-Location "$root/backend"; npm install

Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
Set-Location "$root/frontend"; npm install

Set-Location $root
Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Start Redis (docker run -p 6379:6379 redis:7-alpine), then run:" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor Yellow
