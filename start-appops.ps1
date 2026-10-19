# NTRX AppOps - startup launcher.
# Runs the built single-process server (API + UI) on http://localhost:3001.
# Backend re-scans every 15 minutes (REFRESH_MS). Registered by install-autostart.ps1.

# -Restart: stop any running copy first, so every scheduled run starts a fresh backend
# (re-resolves the egress IP, re-reads account keys, clears stale errors).
param([switch]$Restart)

$ErrorActionPreference = 'SilentlyContinue'
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'

# Make node + Azure CLI resolvable regardless of the logon PATH.
$env:PATH = "C:\Program Files\nodejs;C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin;C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:PATH
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }

# 15-minute backend refresh (env vars take precedence over .env).
$env:REFRESH_MS = '900000'

if ($Restart) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'dist\\server\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
}

# Don't start a second copy if it's already listening on 3001.
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { return }

Start-Process $node -ArgumentList '--use-system-ca','dist\server.js' -WorkingDirectory $backend -WindowStyle Hidden `
  -RedirectStandardOutput "$backend\appops.out.log" -RedirectStandardError "$backend\appops.err.log"
