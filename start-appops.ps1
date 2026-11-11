# NTRX AppOps - startup launcher.
# Runs the built single-process server (API + UI) on http://localhost:3001.
# Backend re-scans every 15 minutes (REFRESH_MS). Registered by install-autostart.ps1.

# -Restart: stop any running copy first, so every scheduled run starts a fresh backend
# (re-resolves the egress IP, re-reads account keys, clears stale errors). If the source code is newer than the
# built files (backend\dist, frontend\dist) they are rebuilt first, so a restart always runs the code on disk.
# -Fresh:   a hard restart for when you changed something. Same as -Restart, and it also ignores the saved scan and
# waits until the first real scan is done (the page then never shows old results). The scheduled task does not use it.
param([switch]$Restart, [switch]$Fresh)
if ($Fresh) { $Restart = $true }

$ErrorActionPreference = 'SilentlyContinue'
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'

# Make node + Azure CLI resolvable regardless of the logon PATH.
# setup.ps1 puts a private Node.js here when the PC has none (or an old one); it wins over any other.
$privateNode = Join-Path $env:LOCALAPPDATA 'NTRX-AppOps\node'
$env:PATH = "$privateNode;C:\Program Files\nodejs;C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin;C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;" + $env:PATH
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }

# 15-minute backend refresh (env vars take precedence over .env).
$env:REFRESH_MS = '900000'
# Name lookups (DNS) run on Node's thread pool, which has 4 threads by default. When the network's DNS is slow, the ~200 storage
# names of a scan queue behind each other and every account times out. 64 lets them run side by side (72 s -> 4 s measured).
$env:UV_THREADPOOL_SIZE = '64'

# Rebuild a part when any of its source files is newer than its built output.
function Update-Build($part, $sources, $output) {
  $dir = Join-Path $root $part
  $out = Join-Path $dir $output
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) { return }   # dependencies not installed here (run setup.cmd)
  $built = if (Test-Path $out) { (Get-Item $out).LastWriteTime } else { [datetime]::MinValue }
  $newest = $sources | ForEach-Object { Join-Path $dir $_ } | Where-Object { Test-Path $_ } |
    ForEach-Object { if ((Get-Item $_).PSIsContainer) { Get-ChildItem $_ -Recurse -File } else { Get-Item $_ } } |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest -or $newest.LastWriteTime -le $built) { return }
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { return }
  $log = Join-Path $backend 'appops.build.log'
  "[$(Get-Date -Format s)] rebuilding the $part ($($newest.Name) is newer than the build)" | Add-Content $log
  Push-Location $dir
  & $npm run build 2>&1 | Add-Content $log
  $ok = ($LASTEXITCODE -eq 0)
  Pop-Location
  if ($ok -and (Test-Path $out)) { (Get-Item $out).LastWriteTime = Get-Date }   # so the build counts as newer than the source
  else { "[$(Get-Date -Format s)] the $part build failed; keeping the previous build" | Add-Content $log }
}

if ($Restart) {
  Update-Build 'backend' @('src', 'package.json', 'tsconfig.json') 'dist\server.js'
  Update-Build 'frontend' @('src', 'index.html', 'package.json', 'vite.config.ts') 'dist\index.html'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'dist\\server\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
}

# Don't start a second copy if it's already listening on 3001.
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { return }

if ($Fresh) { $env:FRESH_START = '1' } else { Remove-Item Env:FRESH_START -ErrorAction SilentlyContinue }
Start-Process $node -ArgumentList '--use-system-ca','dist\server.js' -WorkingDirectory $backend -WindowStyle Hidden `
  -RedirectStandardOutput "$backend\appops.out.log" -RedirectStandardError "$backend\appops.err.log"

if ($Fresh) {
  # wait for the first real scan (a minute or two), then say so
  $t0 = Get-Date
  $ready = $false
  while (((Get-Date) - $t0).TotalSeconds -lt 360 -and -not $ready) {
    Start-Sleep -Seconds 3
    try { $ready = [bool](Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 5).ready } catch { }
  }
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  if ($ready) { Write-Host "Fresh restart done: the first real scan finished after $secs s. Press Ctrl+F5 in the browser." }
  else { Write-Host "The backend is up but the first scan is still running after $secs s; the page shows 'warming up' until it ends." }
}
