# Add your public IP to the storage firewall of the BOT STORAGE accounts that belong to one or more SRD locations.
#
# You give SRD account names (one, or several separated by commas). For each, the script finds the matching
# bot storage account(s) - the "botstorage*" accounts in the same tenant/region (resource group "<tenant>-grp-rec-NN"),
# the same matching the dashboard uses. You can also pass bot storage names (botstorage...) directly.
#
# Rules (same as add-ip-to-srd.ps1):
#   - Only the bot accounts belonging to the names you give are touched.
#   - Private-endpoint-only accounts are IGNORED: private endpoints and NO IP rules (or public access disabled).
#   - Accounts that already have IP rules get the IP added, even if they also have private endpoints.
#   - If the IP is already on the list, nothing is changed.
# A report at the end shows how many were added / already present / ignored / not found / failed.
#
# Interactive:   powershell -ExecutionPolicy Bypass -File .\add-ip-to-botstorage.ps1
# Non-interactive / dry run:
#   .\add-ip-to-botstorage.ps1 -Accounts adcprduaensasrd01,nedprdeuwsasrd01 -Ip 96.45.38.161 -DryRun
#   .\add-ip-to-botstorage.ps1 -Accounts adcprduaensasrd01 -Ip 96.45.38.161 -Yes
#
# Needs: Azure CLI, `az login`, and write access (Owner / Contributor / Storage Account Contributor) on the accounts.
param(
  [string[]]$Accounts,   # SRD account names (or botstorage account names)
  [string]$Ip,           # IPv4 address to allow
  [switch]$DryRun,       # show what would change, change nothing
  [switch]$Yes,          # skip the confirmation prompt
  [int[]]$Skip     # numbers (from the preview list) to skip, e.g. -Skip 4,7
)

$ErrorActionPreference = 'Stop'
$BotPrefix = 'botstorage'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw "Azure CLI ('az') not found on PATH." }
az account show --query name -o tsv 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Not logged in. Run 'az login' first." }

# --- 1. Which SRD locations? ---
if (-not $Accounts) {
  $raw = Read-Host 'SRD storage account name(s) - one, or several separated by commas'
  $Accounts = @($raw)
}
$names = @($Accounts | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ } | Select-Object -Unique)
if ($names.Count -eq 0) { throw 'No account names given.' }

# --- 2. Which IP? ---
$ipRegex = '^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$'
if (-not $Ip) {
  $detected = $null
  try { $detected = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5).ToString().Trim() } catch {}
  $prompt = if ($detected) { "Your current public IP address [Enter = $detected]" } else { 'Your current public IP address' }
  $Ip = (Read-Host $prompt).Trim()
  if (-not $Ip -and $detected) { $Ip = $detected }
}
if ($Ip -notmatch $ipRegex) { throw "'$Ip' is not a valid IPv4 address." }

# Tenant/region key shared by an SRD account and its bot storage: "adcprdntx-uaen-grp-srd-01" and
# "adcprdntx-uaen-grp-rec-02" -> "adcprdnt-uaen" (ntx / ntrx spellings are treated as the same tenant).
function Get-GroupKey([string]$rg) {
  if ($rg -match '^(.+)-grp-(srd|rec)-\d+$') { return ($Matches[1].ToLower() -replace 'ntrx|ntx|ntr(?=-)', 'nt') }
  return $null
}

# --- 3. Resolve the bot storage accounts ---
$srdNames = @($names | Where-Object { -not $_.StartsWith($BotPrefix) })
$botNames = @($names | Where-Object { $_.StartsWith($BotPrefix) })

$srdRows = @()
if ($srdNames.Count) {
  $q = ($srdNames | ForEach-Object { "'$_'" }) -join ','
  $srdRows = @(az graph query -q "resources | where type =~ 'microsoft.storage/storageAccounts' and name in~ ($q) | project name, resourceGroup" --first 1000 --query data -o json | ConvertFrom-Json)
}
$srdByName = @{}; foreach ($s in $srdRows) { $srdByName[$s.name.ToLower()] = $s }

$allBots = @(az graph query -q ("resources | where type =~ 'microsoft.storage/storageAccounts' and name startswith '$BotPrefix' " +
  "| project name, subscriptionId, resourceGroup, pna=tostring(properties.publicNetworkAccess), " +
  "def=tostring(properties.networkAcls.defaultAction), ips=properties.networkAcls.ipRules, " +
  "pe=array_length(properties.privateEndpointConnections)") --first 1000 --query data -o json | ConvertFrom-Json)
$botByName = @{}; foreach ($b in $allBots) { $botByName[$b.name.ToLower()] = $b }

# Build the list of (Source, bot account) pairs; keep track of SRD names with no bot storage.
$targets  = [ordered]@{}   # bot name -> source label
$noBot    = @()
$notFound = @()
foreach ($n in $srdNames) {
  $srd = $srdByName[$n]
  if (-not $srd) { $notFound += $n; continue }
  $key = Get-GroupKey $srd.resourceGroup
  $mine = @(if ($key) { $allBots | Where-Object { (Get-GroupKey $_.resourceGroup) -eq $key } })
  if ($mine.Count -eq 0) { $noBot += $n; continue }
  foreach ($b in $mine) {
    $bn = $b.name.ToLower()
    $targets[$bn] = if ($targets.Contains($bn)) { $targets[$bn] + ", $n" } else { $n }
  }
}
foreach ($bn in $botNames) {
  if (-not $botByName.ContainsKey($bn)) { $notFound += $bn; continue }
  if (-not $targets.Contains($bn)) { $targets[$bn] = '(given directly)' }
}

$plan = foreach ($bn in $targets.Keys) {
  $f = $botByName[$bn]
  $existing = @($f.ips | ForEach-Object { $_.value })
  $peCount  = [int]$f.pe
  if     ($f.pna -eq 'Disabled')    { $action = 'IGNORED'; $note = 'private-endpoint only (public network access disabled)' }
  elseif ($existing.Count -eq 0)    { $action = 'IGNORED'; $note = "private-endpoint only ($peCount endpoint(s), no IP rules)" }
  elseif ($existing -contains $Ip)  { $action = 'ALREADY'; $note = 'IP already allowed' }
  elseif ($f.def -eq 'Allow')       { $action = 'IGNORED'; $note = 'firewall default is Allow (open to all networks)' }
  else                              { $action = 'ADD';     $note = "$($existing.Count) IP rules now" }
  [pscustomobject]@{ Name = $f.name; For = $targets[$bn]; Action = $action; Note = $note; F = $f }
}
$plan = @($plan)

$userSkipped = @()
$toAdd  = @($plan | Where-Object { $_.Action -eq 'ADD' })
$ok     = 0
$failed = @()

function Show-Report {
  $already = @($plan | Where-Object { $_.Action -eq 'ALREADY' })
  $ignored = @($plan | Where-Object { $_.Action -eq 'IGNORED' })
  Write-Host ""
  Write-Host "========== BOT STORAGE REPORT for IP $Ip =========="
  if ($DryRun) { Write-Host 'DRY RUN - no changes were made.' }
  $addLabel = if ($DryRun) { 'Would add' } else { 'Added' }
  $addCount = if ($DryRun) { $toAdd.Count } else { $ok }
  Write-Host ("{0,-16} {1}" -f $addLabel, $addCount)
  Write-Host ("{0,-16} {1}" -f 'Already', $already.Count)
  Write-Host ("{0,-16} {1}" -f 'Ignored', $ignored.Count)
  Write-Host ("{0,-16} {1}" -f 'Skipped by you', $userSkipped.Count)
  Write-Host ("{0,-16} {1}" -f 'No bot storage', $noBot.Count)
  Write-Host ("{0,-16} {1}" -f 'Not found', $notFound.Count)
  Write-Host ("{0,-16} {1}" -f 'Failed', $failed.Count)
  if ($toAdd.Count)    { Write-Host ""; Write-Host ($addLabel + ':');  $toAdd   | Select-Object Name, For | Format-Table -AutoSize | Out-String | Write-Host }
  if ($userSkipped.Count) { Write-Host ""; Write-Host 'Skipped by you:'; $userSkipped | ForEach-Object { Write-Host ("  - {0}" -f $_.Name) } }
  if ($ignored.Count)  { Write-Host ""; Write-Host 'Ignored:';          $ignored | Select-Object Name, For, Note | Format-Table -AutoSize | Out-String | Write-Host }
  if ($noBot.Count)    { Write-Host ""; Write-Host 'SRD locations with no bot storage found:'; $noBot | ForEach-Object { "  $_" } | Write-Host }
  if ($notFound.Count) { Write-Host ""; Write-Host 'Not found:';        $notFound | ForEach-Object { "  $_" } | Write-Host }
  if ($failed.Count)   { Write-Host ""; Write-Host 'Failed:';           $failed | Format-Table -AutoSize -Wrap | Out-String | Write-Host }
  if (-not $DryRun -and $ok) { Write-Host 'Firewall changes can take 1-2 minutes to apply. Then press Refresh in the dashboard.' }
}

function Show-Preview {
  $already = @($plan | Where-Object { $_.Action -eq 'ALREADY' })
  $ignored = @($plan | Where-Object { $_.Action -eq 'IGNORED' })
  Write-Host ""
  Write-Host "========== PREVIEW - what happens if you answer Y =========="
  Write-Host "IP address: $Ip"
  Write-Host ""
  Write-Host ("WILL ADD this IP to {0} bot storage account(s):" -f $toAdd.Count)
  if ($toAdd.Count) { for ($i = 0; $i -lt $toAdd.Count; $i++) { Write-Host ("  {0,3}. {1,-28} for {2} ({3})" -f ($i + 1), $toAdd[$i].Name, $toAdd[$i].For, $toAdd[$i].Note) } } else { Write-Host '  (none)' }
  Write-Host ""
  Write-Host ("NO CHANGE - IP already allowed on {0} account(s):" -f $already.Count)
  $already | ForEach-Object { Write-Host ("  = {0,-28} for {1}" -f $_.Name, $_.For) }
  Write-Host ""
  Write-Host ("SKIPPED - {0} account(s) will NOT be touched:" -f $ignored.Count)
  $ignored | ForEach-Object { Write-Host ("  - {0,-28} for {1}: {2}" -f $_.Name, $_.For, $_.Note) }
  if ($noBot.Count) {
    Write-Host ""
    Write-Host ("NO BOT STORAGE FOUND for {0} SRD location(s):" -f $noBot.Count)
    $noBot | ForEach-Object { Write-Host ("  ? {0}" -f $_) }
  }
  if ($notFound.Count) {
    Write-Host ""
    Write-Host ("NOT FOUND - {0} name(s):" -f $notFound.Count)
    $notFound | ForEach-Object { Write-Host ("  ? {0}" -f $_) }
  }
  Write-Host ""
  Write-Host 'Each ADD only appends this one IP to the existing allow list. Nothing else changes: the firewall'
  Write-Host 'default (Deny), public network access, existing IPs and private endpoints stay exactly as they are.'
  Write-Host ""
}

Show-Preview

if ($toAdd.Count -eq 0 -or $DryRun) { Show-Report; return }

# --- Optional: skip some of the accounts listed above (by their number) ---
$userSkipped = @()
function ConvertTo-SkipIndexes([string]$text, [int]$max) {
  $set = New-Object System.Collections.Generic.SortedSet[int]
  foreach ($tok in ($text -split '[,\s]+' | Where-Object { $_ })) {
    if ($tok -match '^(\d+)-(\d+)$') { $a = [int]$Matches[1]; $b = [int]$Matches[2]; if ($a -gt $b) { $a, $b = $b, $a } }
    elseif ($tok -match '^\d+$')     { $a = [int]$tok; $b = $a }
    else { throw "'$tok' is not a number or a range like 3-6." }
    if ($a -lt 1 -or $b -gt $max) { throw "'$tok' is outside 1-$max." }
    $a..$b | ForEach-Object { [void]$set.Add($_) }
  }
  return @($set)
}

$skipIdx = @()
if ($Skip -and $Skip.Count) {
  $skipIdx = ConvertTo-SkipIndexes ($Skip -join ',') $toAdd.Count
}
elseif (-not $Yes) {
  while ($true) {
    $raw = Read-Host "Numbers to SKIP, e.g. 4 or 2,5 or 3-6  (Enter = skip none, q = cancel)"
    if ($raw -match '^\s*(q|quit|cancel)\s*$') { Write-Host 'Cancelled. No changes made.'; return }
    if ([string]::IsNullOrWhiteSpace($raw)) { break }
    try { $skipIdx = ConvertTo-SkipIndexes $raw $toAdd.Count; break }
    catch { Write-Host "  $($_.Exception.Message) Try again." }
  }
}
if ($skipIdx.Count) {
  $userSkipped = @($skipIdx | ForEach-Object { $toAdd[$_ - 1] })
  $toAdd = @(for ($i = 0; $i -lt $toAdd.Count; $i++) { if ($skipIdx -notcontains ($i + 1)) { $toAdd[$i] } })
  Write-Host ""
  Write-Host ("Skipping {0} account(s) as requested:" -f $userSkipped.Count)
  $userSkipped | ForEach-Object { Write-Host ("  - {0}" -f $_.Name) }
  Write-Host ""
  if ($toAdd.Count -eq 0) { Write-Host 'Nothing left to add.'; Show-Report; return }
  Write-Host ("The IP will now be added to {0} account(s):" -f $toAdd.Count)
  $toAdd | ForEach-Object { Write-Host ("  + {0}" -f $_.Name) }
  Write-Host ""
}

if (-not $Yes) {
  $ans = Read-Host "Add $Ip to the firewall of $($toAdd.Count) bot storage account(s)? This changes network security settings. (y/N)"
  if ($ans -notmatch '^(y|yes)$') { Write-Host 'Cancelled. No changes made.'; return }
}

# --- 4. Apply ---
foreach ($p in $toAdd) {
  $f = $p.F
  Write-Host -NoNewline ("{0,-28} " -f $p.Name)
  $out = az storage account network-rule add --account-name $f.name --resource-group $f.resourceGroup `
           --subscription $f.subscriptionId --ip-address $Ip -o none 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Host 'added'; $ok++ }
  else {
    Write-Host 'FAILED'
    $failed += [pscustomobject]@{ Name = $f.name; Error = (($out | Out-String).Trim() -split "`n")[0] }
  }
}

Show-Report
