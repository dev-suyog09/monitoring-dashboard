<#
.SYNOPSIS
  One command that sets up the dashboard on this Windows PC, the same way it runs on the author's laptop.

.DESCRIPTION
  Installs what is missing (Node.js LTS and Azure CLI, via winget), signs in to Azure, builds the frontend and backend,
  creates backend\.env, registers the silent "NTRX AppOps" scheduled task (starts at logon / start-up and every 15 minutes,
  no console window), starts it, waits until it answers, and opens http://localhost:3001.

  Safe to run again at any time: it only does what is still needed (add -Update to also pull the newest code).

.PARAMETER Update      git pull the newest code first, then rebuild.
.PARAMETER NoBrowser   Do not open the dashboard when finished.
.PARAMETER SkipTests   Skip the quick backend self-test.
.PARAMETER NoAutostart Do not register the scheduled task; just start the backend once in the background.
.PARAMETER PrivateNode Use a private copy of Node.js (downloaded for this user only) even if one is installed.
                       This is also what happens by itself when Node.js is missing or too old.
.PARAMETER TenantId    Azure tenant to sign in to (only if `az login` needs one).
.PARAMETER Uninstall   Remove the scheduled task and stop the backend (files and settings stay).
.PARAMETER DryRun      Show what would happen without changing anything.

.EXAMPLE
  .\setup.cmd
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Update
#>
[CmdletBinding()]
param(
  [switch]$Update,
  [switch]$NoBrowser,
  [switch]$SkipTests,
  [switch]$NoAutostart,
  [switch]$PrivateNode,
  [switch]$Uninstall,
  [switch]$DryRun,
  [string]$TenantId = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$TaskName = 'NTRX AppOps'
# --use-system-ca (used by the launcher so the backend trusts the company's certificates) needs Node.js 22.15 or newer
$MinNode = [version]'22.15.0'
$PrivateNodeDir = Join-Path $env:LOCALAPPDATA 'NTRX-AppOps\node'
$Url = 'http://localhost:3001'
$script:warnings = New-Object System.Collections.Generic.List[string]
$script:n = 0

# ------------------------------------------------------------------------------------------------ output helpers
function Step($text) { $script:n++; Write-Host ''; Write-Host ("[{0}] {1}" -f $script:n, $text) -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Info($text) { Write-Host "        $text" -ForegroundColor Gray }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow; $script:warnings.Add($text) | Out-Null }
function Fail($text) { throw $text }
function Would($text) { Write-Host "    (dry run) would: $text" -ForegroundColor DarkYellow }

# After installing something, make it visible to this window without opening a new one.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $extra = @('C:\Program Files\nodejs', 'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin', 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin')
  $env:Path = (($machine, $user) + $extra | Where-Object { $_ }) -join ';'
}

function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Run a native command and stop with a clear message when it fails.
function Run([string]$what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE). Scroll up for the reason." }
}

function Install-WithWinget([string]$id, [string]$label) {
  if (-not (Has 'winget')) {
    Fail "$label is not installed and winget is not available. Install $label yourself (see SETUP.md), open a NEW PowerShell window, and run this script again."
  }
  Info "installing $label with winget (this can take a few minutes)..."
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  # winget answers 0 on success; "already installed / no upgrade" also counts as fine
  Update-SessionPath
}

function Get-NodeVersion([string]$exe) {
  try { return [version]((((& $exe --version) -replace '^v', '').Split('-')[0])) } catch { return $null }
}

# A Node.js for this user only: no administrator rights, no installer, nothing global changed. The download comes from
# nodejs.org and is checked against the checksum nodejs.org publishes before anything is unpacked.
function Install-PrivateNode {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  # Windows PowerShell 5.1 may default to old TLS and does not use the company proxy login by itself
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  try { [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch { }
  $base = 'https://nodejs.org/dist/latest-v24.x'
  Info 'downloading Node.js 24 LTS from nodejs.org (about 30 MB)...'
  try { $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content }
  catch { Fail "Could not reach nodejs.org ($($_.Exception.Message)). Check the internet / proxy, or install Node.js 22.15 or newer yourself and run this again." }
  $line = ($sums -split "`n" | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1)
  if (-not $line) { Fail "nodejs.org has no Windows $arch build listed. Install Node.js 22.15 or newer yourself and run this again." }
  $parts = $line.Trim() -split '\s+'
  $hash = $parts[0].ToLower()
  $zipName = $parts[1]
  $zip = Join-Path $env:TEMP $zipName
  Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $hash) {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Fail 'The Node.js download did not match the checksum nodejs.org publishes, so it was thrown away. Try again; if it repeats, install Node.js yourself.'
  }
  Info 'checksum verified, unpacking...'
  $stage = Join-Path $env:TEMP 'appops-node-unpack'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $stage -Force
  $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
  if (Test-Path $PrivateNodeDir) { Remove-Item $PrivateNodeDir -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $PrivateNodeDir) -Force | Out-Null
  Move-Item $inner.FullName $PrivateNodeDir
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# Put the private Node.js first on PATH for this window (the scheduled task finds it by itself, see start-appops.ps1).
function Use-PrivateNode { $env:Path = "$PrivateNodeDir;$env:Path" }

function Test-Health {
  try { return (Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { return $false }
}

# Stop with a clear message when some other program already listens on the dashboard's port (we have just stopped our own copy).
function Assert-PortFree {
  Start-Sleep -Milliseconds 800
  $busy = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    $p = Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue
    Fail "Port 3001 is already used by '$($p.ProcessName)' (process $($busy[0].OwningProcess)). Close it and run setup again, or change PORT in backend\.env and open that address instead."
  }
}

function Stop-Backend {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dist\\server\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# ------------------------------------------------------------------------------------------------ start
$transcript = Join-Path $root 'setup.log'
try { Start-Transcript -Path $transcript -Force | Out-Null } catch { }
$started = Get-Date

try {
  Write-Host ''
  Write-Host '  NTRX AppOps - Godzilla Health Monitor - one-command setup' -ForegroundColor White
  Write-Host "  folder: $root" -ForegroundColor Gray
  if ($DryRun) { Write-Host '  DRY RUN: nothing will be changed.' -ForegroundColor DarkYellow }

  if ($env:OS -ne 'Windows_NT') {
    Fail 'This script is for Windows (it registers a Windows scheduled task). On macOS / Linux follow SETUP.md.'
  }
  if (-not (Test-Path (Join-Path $backend 'package.json')) -or -not (Test-Path (Join-Path $frontend 'package.json'))) {
    Fail "Run this from the project folder: backend\package.json and frontend\package.json were not found next to setup.ps1."
  }
  Update-SessionPath

  # ---------------------------------------------------------------------------------------------- uninstall
  if ($Uninstall) {
    Step "Removing the scheduled task '$TaskName'"
    if ($DryRun) { Would "unregister the task and stop the backend" }
    else {
      if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Ok 'task removed'
      } else { Info 'there was no such task' }
      Stop-Backend
      Ok 'backend stopped'
    }
    Write-Host "`nDone. The files and backend\.env are untouched; run .\setup.cmd to install again." -ForegroundColor Green
    return
  }

  # ---------------------------------------------------------------------------------------------- 1. code
  if ($Update) {
    Step 'Getting the newest code'
    if ($DryRun) { Would 'git pull --ff-only' }
    elseif ((Has 'git') -and (Test-Path (Join-Path $root '.git'))) {
      Run 'git pull' { git -C $root pull --ff-only }
      Ok 'up to date'
    } else { Warn 'git (or the .git folder) is not available, so the code was not updated.' }
  }

  # ---------------------------------------------------------------------------------------------- 2. prerequisites
  Step 'Checking Node.js'
  $haveNode = $false
  if (-not $PrivateNode -and (Has 'node')) {
    $v = Get-NodeVersion 'node'
    if ($v -and $v -ge $MinNode) { Ok "Node.js $v (installed on this PC)"; $haveNode = $true }
    else { Info "Node.js $v is too old (22.15 or newer is needed), using a private copy instead" }
  } elseif (-not $PrivateNode) { Info 'Node.js is not installed, using a private copy (no administrator rights needed)' }
  if (-not $haveNode) {
    $mine = Join-Path $PrivateNodeDir 'node.exe'
    $mineVer = if (Test-Path $mine) { Get-NodeVersion $mine } else { $null }
    if ($DryRun) { Would "use / download a private Node.js 24 LTS into $PrivateNodeDir" }
    else {
      if ($mineVer -and $mineVer -ge $MinNode -and -not $Update) { Info "private Node.js $mineVer is already there" }
      else { Install-PrivateNode }
      Use-PrivateNode
      if (-not (Has 'node')) { Fail 'The private Node.js could not be started. Delete the folder %LOCALAPPDATA%\NTRX-AppOps\node and run this again.' }
      Ok "Node.js $(Get-NodeVersion 'node') (private copy in $PrivateNodeDir)"
    }
  }
  if (-not $DryRun -and -not (Has 'npm')) { Fail 'npm was not found next to Node.js. Delete %LOCALAPPDATA%\NTRX-AppOps\node and run this again.' }

  Step 'Checking Azure CLI'
  if (Has 'az') { $azv = ''; try { $azv = ((az version -o json 2>$null) | ConvertFrom-Json).'azure-cli' } catch { }; Ok "Azure CLI $azv" }
  elseif ($DryRun) { Would 'install Azure CLI with winget' }
  else {
    Install-WithWinget 'Microsoft.AzureCLI' 'Azure CLI'
    if (-not (Has 'az')) { Fail 'Azure CLI was installed but is not visible yet. Open a NEW PowerShell window and run .\setup.cmd again.' }
    Ok 'Azure CLI installed'
  }

  # ---------------------------------------------------------------------------------------------- 3. Azure sign-in
  Step 'Signing in to Azure'
  if ($DryRun) { Would 'az login (only if not already signed in)' }
  else {
    $who = $null
    try { $who = (az account show --query user.name -o tsv 2>$null) } catch { }
    if (-not $who) {
      Info 'a browser window opens: sign in with your work account'
      if ($TenantId) { Run 'az login' { az login --tenant $TenantId | Out-Null } } else { Run 'az login' { az login | Out-Null } }
      $who = (az account show --query user.name -o tsv)
    }
    Ok "signed in as $who"

    # can we actually see the archive accounts? (a quick Resource Graph count; no extension needed)
    try {
      $tmp = Join-Path $env:TEMP 'appops-rg.json'
      Set-Content -Path $tmp -Value '{"query":"Resources | where type =~ ''microsoft.storage/storageaccounts'' and name endswith ''srd01'' | count"}' -Encoding ASCII
      $res = az rest --method post --url 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01' --body "@$tmp" -o json 2>$null | ConvertFrom-Json
      Remove-Item $tmp -ErrorAction SilentlyContinue
      $d = $res.data
      $count = if ($d.rows) { [int]$d.rows[0][0] } else { [int]$d[0].Count }
      if ($count -gt 0) { Ok "this login can see $count SRD storage account(s)" }
      else { Warn 'this login sees no "*srd01" storage accounts. Ask for Reader access on the subscriptions (see SETUP.md), or the dashboard will be empty.' }
    } catch { Warn 'could not check which storage accounts this login can see (the dashboard will still start).' }
  }

  # ---------------------------------------------------------------------------------------------- 4. settings file
  Step 'Settings file (backend\.env)'
  $envFile = Join-Path $backend '.env'
  if (Test-Path $envFile) { Ok 'backend\.env already exists, left as it is' }
  elseif ($DryRun) { Would 'copy backend\.env.example to backend\.env' }
  else {
    Copy-Item (Join-Path $backend '.env.example') $envFile
    Ok 'created backend\.env from the template (accounts are auto-discovered; nothing to edit)'
  }

  # a copy that is still running would lock files while the packages are reinstalled
  if (-not $DryRun) { Stop-Backend }

  # ---------------------------------------------------------------------------------------------- 5. build
  foreach ($part in @(@{ Name = 'backend'; Dir = $backend }, @{ Name = 'frontend'; Dir = $frontend })) {
    Step "Installing and building the $($part.Name)"
    if ($DryRun) { Would "npm ci and npm run build in $($part.Name)"; continue }
    Push-Location $part.Dir
    try {
      $lock = Test-Path 'package-lock.json'
      if ($lock) {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Info 'npm ci did not work, trying npm install'; Run 'npm install' { npm install --no-audit --no-fund } }
      } else { Run 'npm install' { npm install --no-audit --no-fund } }
      Run "building the $($part.Name)" { npm run build }
      Ok "$($part.Name) built"
    } finally { Pop-Location }
  }

  if (-not $SkipTests) {
    Step 'Quick backend self-test'
    if ($DryRun) { Would 'npm test in backend' }
    else {
      Push-Location $backend
      try {
        # through cmd so npm's stderr lines are plain text (Windows PowerShell 5.1 would turn them into errors)
        $out = & cmd /c 'npm test 2>&1'
        if ($LASTEXITCODE -eq 0) { Ok ((($out | Select-String 'pass \d+' | Select-Object -Last 1).Line).Trim()) }
        else { Warn 'the backend self-test reported a problem (the app may still work). Run "npm test" in backend to see it.' }
      } finally { Pop-Location }
    }
  }

  # ---------------------------------------------------------------------------------------------- 6. run it
  if ($NoAutostart) {
    Step 'Starting the backend (no scheduled task)'
    if ($DryRun) { Would 'run start-appops.ps1 -Restart' }
    else { Stop-Backend; Assert-PortFree; & (Join-Path $root 'start-appops.ps1') -Restart; Ok 'started in the background' }
  } else {
    Step "Registering the silent scheduled task '$TaskName'"
    $launcher = Join-Path $root 'start-appops.ps1'
    # conhost --headless runs PowerShell with NO console window at all; plain "powershell -WindowStyle Hidden" flashes one every run.
    $headless = (Has 'conhost.exe') -and ([Environment]::OSVersion.Version.Build -ge 19041)
    if ($headless) {
      $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`" -Restart"
    } else {
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -Restart"
    }
    $me = "$env:USERDOMAIN\$env:USERNAME"
    $rep = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)).Repetition
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $me
    $logon.Repetition = $rep
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Repetition = $rep
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    if ($DryRun) { Would "register the task (logon + start-up, every 15 minutes, no window) running $launcher" }
    else {
      try {
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $boot) -Settings $settings -Principal $principal -Force | Out-Null
        Ok 'runs at logon and at start-up, then every 15 minutes, with no window'
      } catch {
        # the start-up trigger needs administrator rights on some PCs; logon is enough for a personal machine
        Info "the start-up trigger was not allowed ($($_.Exception.Message.Trim())), using logon only"
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon) -Settings $settings -Principal $principal -Force | Out-Null
        Ok 'runs at logon, then every 15 minutes, with no window'
      }
    }

    Step 'Starting the dashboard'
    if ($DryRun) { Would "start the task and wait for $Url" }
    else {
      Stop-Backend
      Assert-PortFree
      Start-ScheduledTask -TaskName $TaskName
      Ok 'task started'
    }
  }

  # ---------------------------------------------------------------------------------------------- 7. wait for it
  Step "Waiting for $Url"
  if ($DryRun) { Would 'wait for the health check' }
  else {
    $up = $false
    for ($i = 0; $i -lt 60; $i++) { if (Test-Health) { $up = $true; break }; Start-Sleep -Seconds 2 }
    if ($up) { Ok 'the dashboard answers' }
    else { Warn "the dashboard did not answer within 2 minutes. Look at backend\appops.err.log for the reason, then run .\setup.cmd again." }
    if ($up -and -not $NoBrowser) { Start-Process $Url }
  }

  # ---------------------------------------------------------------------------------------------- summary
  $secs = [int]((Get-Date) - $started).TotalSeconds
  Write-Host ''
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor Green
  Write-Host "  Done in ${secs}s.   Open  $Url" -ForegroundColor Green
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor Green
  Write-Host '  * The first scan takes 1-4 minutes; the numbers fill in by themselves.'
  Write-Host '  * It starts by itself at logon and refreshes every 15 minutes, silently.'
  Write-Host '  * Update later:   .\setup.cmd -Update        Remove:   .\setup.cmd -Uninstall'
  Write-Host '  * If it ever shows no data, your Azure sign-in expired: run  az login'
  Write-Host '  * Accounts blocked by a firewall: use the "Needs IP" button in the dashboard.'
  if ($script:warnings.Count -gt 0) {
    Write-Host ''
    Write-Host '  Things to look at:' -ForegroundColor Yellow
    $script:warnings | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
  }
}
catch {
  Write-Host ''
  Write-Host "  SETUP STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Details are in $transcript" -ForegroundColor Gray
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }
