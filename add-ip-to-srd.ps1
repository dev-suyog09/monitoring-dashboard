# Add your public IP to the storage firewall (Networking > Firewall > IP rules) of one or more SRD storage accounts.
#
# Rules:
#   - Only the accounts you name are touched.
#   - Private-endpoint-only accounts are IGNORED: private endpoints and NO IP rules (or public access disabled).
#   - Accounts that already have IP rules get the IP added, even if they also have private endpoints.
#   - If the IP is already on the list, nothing is changed.
# A report at the end shows how many were added / already present / ignored / not found / failed.
#
# Interactive:   powershell -ExecutionPolicy Bypass -File .\add-ip-to-srd.ps1
# Non-interactive / dry run:
#   .\add-ip-to-srd.ps1 -Accounts adcprduaensasrd01,nedprdeuwsasrd01 -Ip 96.45.38.161 -DryRun
#   .\add-ip-to-srd.ps1 -Accounts adcprduaensasrd01 -Ip 96.45.38.161 -Yes
#
# Needs: Azure CLI, `az login`, and write access (Owner / Contributor / Storage Account Contributor) on the accounts.
param(
  [string[]]$Accounts,   # SRD storage account names (one or several)
  [string]$Ip,           # IPv4 address to allow
  [switch]$DryRun,       # show what would change, change nothing
  [switch]$Yes,          # skip the confirmation prompt
  [int[]]$Skip     # numbers (from the preview list) to skip, e.g. -Skip 4,7
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw "Azure CLI ('az') not found on PATH." }
az account show --query name -o tsv 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Not logged in. Run 'az login' first." }

# --- 1. Which SRD accounts? (single name or comma-separated list) ---
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

# --- 3. Look the accounts up (subscription + resource group + current rules + private endpoints) ---
$quoted = ($names | ForEach-Object { "'$_'" }) -join ','
$query = "resources | where type =~ 'microsoft.storage/storageAccounts' and name in~ ($quoted) " +
         "| project name, subscriptionId, resourceGroup, pna=tostring(properties.publicNetworkAccess), " +
         "def=tostring(properties.networkAcls.defaultAction), ips=properties.networkAcls.ipRules, " +
         "pe=array_length(properties.privateEndpointConnections)"
$found = @(az graph query -q $query --first 1000 --query data -o json | ConvertFrom-Json)
$byName = @{}; foreach ($f in $found) { $byName[$f.name.ToLower()] = $f }

$plan = foreach ($n in $names) {
  $f = $byName[$n]
  if (-not $f) { [pscustomobject]@{ Name = $n; Action = 'NOT FOUND'; Note = 'not in any subscription you can see'; F = $null }; continue }
  $existing = @($f.ips | ForEach-Object { $_.value })
  $peCount  = [int]$f.pe
  if     ($f.pna -eq 'Disabled')    { $action = 'IGNORED'; $note = 'private-endpoint only (public network access disabled)' }
  elseif ($existing.Count -eq 0)    { $action = 'IGNORED'; $note = "private-endpoint only ($peCount endpoint(s), no IP rules)" }
  elseif ($existing -contains $Ip)  { $action = 'ALREADY'; $note = 'IP already allowed' }
  elseif ($f.def -eq 'Allow')       { $action = 'IGNORED'; $note = 'firewall default is Allow (open to all networks)' }
  else                              { $action = 'ADD';     $note = "$($existing.Count) IP rules now" }
  [pscustomobject]@{ Name = $n; Action = $action; Note = $note; F = $f }
}

$userSkipped = @()
$toAdd  = @($plan | Where-Object { $_.Action -eq 'ADD' })
$ok     = 0
$failed = @()

function Show-Report {
  $already = @($plan | Where-Object { $_.Action -eq 'ALREADY' })
  $ignored = @($plan | Where-Object { $_.Action -eq 'IGNORED' })
  $missing = @($plan | Where-Object { $_.Action -eq 'NOT FOUND' })
  Write-Host ""
  Write-Host "========== REPORT for IP $Ip =========="
  if ($DryRun) { Write-Host 'DRY RUN - no changes were made.' }
  $addLabel = if ($DryRun) { 'Would add' } else { 'Added' }
  $addCount = if ($DryRun) { $toAdd.Count } else { $ok }
  Write-Host ("{0,-10} {1}" -f $addLabel, $addCount)
  Write-Host ("{0,-10} {1}" -f 'Already', $already.Count)
  Write-Host ("{0,-10} {1}" -f 'Ignored', $ignored.Count)
  Write-Host ("{0,-10} {1}" -f 'Skipped by you', $userSkipped.Count)
  Write-Host ("{0,-10} {1}" -f 'Not found', $missing.Count)
  Write-Host ("{0,-10} {1}" -f 'Failed', $failed.Count)
  if ($toAdd.Count)  { Write-Host ""; Write-Host ($addLabel + ':');   $toAdd  | Select-Object Name | Format-Table -AutoSize | Out-String | Write-Host }
  if ($userSkipped.Count) { Write-Host ""; Write-Host 'Skipped by you:'; $userSkipped | ForEach-Object { Write-Host ("  - {0}" -f $_.Name) } }
  if ($ignored.Count) { Write-Host ""; Write-Host 'Ignored:'; $ignored | Select-Object Name, Note | Format-Table -AutoSize | Out-String | Write-Host }
  if ($missing.Count) { Write-Host ""; Write-Host 'Not found:'; $missing | Select-Object Name | Format-Table -AutoSize | Out-String | Write-Host }
  if ($failed.Count)  { Write-Host ""; Write-Host 'Failed:';  $failed  | Format-Table -AutoSize -Wrap | Out-String | Write-Host }
  if (-not $DryRun -and $ok) { Write-Host 'Firewall changes can take 1-2 minutes to apply. Then press Refresh in the dashboard.' }
}

function Show-Preview {
  $already = @($plan | Where-Object { $_.Action -eq 'ALREADY' })
  $ignored = @($plan | Where-Object { $_.Action -eq 'IGNORED' })
  $missing = @($plan | Where-Object { $_.Action -eq 'NOT FOUND' })
  Write-Host ""
  Write-Host "========== PREVIEW - what happens if you answer Y =========="
  Write-Host "IP address: $Ip"
  Write-Host ""
  Write-Host ("WILL ADD this IP to {0} account(s):" -f $toAdd.Count)
  if ($toAdd.Count) { for ($i = 0; $i -lt $toAdd.Count; $i++) { Write-Host ("  {0,3}. {1,-28} ({2})" -f ($i + 1), $toAdd[$i].Name, $toAdd[$i].Note) } } else { Write-Host '  (none)' }
  Write-Host ""
  Write-Host ("NO CHANGE - IP already allowed on {0} account(s):" -f $already.Count)
  $already | ForEach-Object { Write-Host ("  = {0}" -f $_.Name) }
  Write-Host ""
  Write-Host ("SKIPPED - {0} account(s) will NOT be touched:" -f $ignored.Count)
  $ignored | ForEach-Object { Write-Host ("  - {0,-28} {1}" -f $_.Name, $_.Note) }
  if ($missing.Count) {
    Write-Host ""
    Write-Host ("NOT FOUND - {0} name(s):" -f $missing.Count)
    $missing | ForEach-Object { Write-Host ("  ? {0}" -f $_.Name) }
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
  $ans = Read-Host "Add $Ip to the firewall of $($toAdd.Count) account(s)? This changes network security settings. (y/N)"
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
