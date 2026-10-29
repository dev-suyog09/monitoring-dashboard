# One-time installer: builds the app and registers the "NTRX AppOps" scheduled task
# (starts at logon, restarts if it stops, backend refreshes every 15 min).
# Run from the project root:  powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '==> Checking prerequisites'
foreach ($c in 'node','npm','az') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "'$c' not found on PATH. Install it and open a NEW terminal." }
}
az account show --query name -o tsv 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Not logged in - running az login...'; az login | Out-Null }

Write-Host '==> Building frontend'
Push-Location (Join-Path $root 'frontend'); npm install; npm run build; Pop-Location
Write-Host '==> Building backend'
Push-Location (Join-Path $root 'backend');  npm install; npm run build; Pop-Location

if (-not (Test-Path (Join-Path $root 'backend\.env'))) {
  Copy-Item (Join-Path $root 'backend\.env.example') (Join-Path $root 'backend\.env')
  Write-Host 'Created backend\.env from template - review it (STORAGE_DISCOVER=true for auto-discovery).'
}

Write-Host '==> Registering scheduled task "NTRX AppOps"'
$launcher = Join-Path $root 'start-appops.ps1'
# conhost --headless runs PowerShell with NO console at all (Windows 11 / recent Windows 10). Plain `powershell.exe -WindowStyle Hidden`
# still flashes a console window every time the task runs; fall back to it only where conhost has no --headless.
$headless = (Get-Command conhost.exe -ErrorAction SilentlyContinue) -and ([Environment]::OSVersion.Version.Build -ge 19041)
if ($headless) {
  $action = New-ScheduledTaskAction -Execute 'conhost.exe' `
    -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`" -Restart"
} else {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -Restart"
}
# Logon + startup triggers, each re-run every 15 min (-Restart makes each run replace the backend with a fresh one).
$rep      = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)).Repetition
$logon    = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$boot     = New-ScheduledTaskTrigger -AtStartup
$logon.Repetition = $rep; $boot.Repetition = $rep
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'NTRX AppOps' -Action $action -Trigger @($logon,$boot) -Settings $settings -Principal $principal -Force | Out-Null

Write-Host '==> Starting it now'
Start-ScheduledTask -TaskName 'NTRX AppOps'
Write-Host 'Done. Give it ~1 minute on first start, then open http://localhost:3001'
