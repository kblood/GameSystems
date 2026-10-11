#requires -Version 7
# Deploys the headset lab's cloud entry page (cloud/) to https://dionysus.dk/webxr/GameSystems/ with the same SSH setup
# and atomic staging swap as webxr-demo/deploy.ps1. The live lan.json (written by the lab server, publish.mjs) is
# carried over into the new version. -VerifyOnly checks the live page only.
[CmdletBinding()]
param([switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$Name = 'GameSystems'
$BaseUrl = 'https://dionysus.dk/webxr'
$HostName = '35.228.204.127'
$User = 'kaspersolesen'
$Key = 'C:\Devstuff\GCloud\caldor_nopass'
$Port = 22
$RemoteBase = '/var/www/html/webxr'
$LiveUrl = "$BaseUrl/$Name/"
$source = Join-Path $PSScriptRoot 'cloud'

function Test-Live {
  $ok = $true
  try {
    $page = Invoke-WebRequest -Method Get -Uri $LiveUrl -TimeoutSec 30
    Write-Host ("    GET  {0,-50} {1} {2}" -f $LiveUrl, $page.StatusCode, ($page.Headers['Content-Type'] -join ','))
    if ($page.Content -notmatch 'GameSystems testlab') { Write-Warning 'The live page does not look like the testlab entry page.'; $ok = $false }
    $head = Invoke-WebRequest -Method Head -Uri $LiveUrl -TimeoutSec 30
    Write-Host ("    HEAD {0,-50} {1}" -f $LiveUrl, $head.StatusCode)
  } catch { Write-Warning "GET/HEAD $LiveUrl failed: $($_.Exception.Message)"; $ok = $false }
  try {
    $lan = Invoke-WebRequest -Method Get -Uri "${LiveUrl}lan.json" -TimeoutSec 30
    Write-Host ("    GET  {0,-50} {1} {2}" -f "${LiveUrl}lan.json", $lan.StatusCode, $lan.Content.Trim() -replace '\s+', ' ')
  } catch { Write-Host "    lan.json: not published yet (the lab server writes it on start)" }
  return $ok
}

if ($VerifyOnly) { if (Test-Live) { exit 0 } else { exit 1 } }
if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }
if (-not (Test-Path (Join-Path $source 'index.html'))) { throw "Missing $source\index.html" }

$id = "$(Get-Date -Format 'yyyyMMddHHmmss')-$PID"
$archive = Join-Path ([IO.Path]::GetTempPath()) "gamesystems-hub-$id.tgz"
$remoteArchive = "/tmp/$Name-hub.$id.tgz"
$staging = "$RemoteBase/.$Name.upload.$id"
$backup = "$RemoteBase/.$Name.backup.$id"
$live = "$RemoteBase/$Name"
$target = "$User@$HostName"
$hadPrevious = $false
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$sshOptions = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=8')

try {
  $exists = & ssh.exe @sshOptions -p $Port $target "if [ -e '$live' ]; then printf yes; else printf no; fi"
  if ($LASTEXITCODE -ne 0) { throw 'Could not check the current remote destination.' }
  $hadPrevious = (($exists -join '').Trim() -eq 'yes')

  & $tar -czf $archive -C $source .
  if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
  Write-Host "Uploading $source to $LiveUrl"

  & ssh.exe @sshOptions -p $Port $target "set -e; sudo mkdir -p '$RemoteBase'; sudo rm -rf '$staging'; sudo mkdir -p '$staging'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare remote staging directory.' }
  & scp.exe @sshOptions -P $Port $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

  # Keep the lab's lan.json across deploys (it is written by the lab server, not part of cloud/).
  $swap = "set -e; sudo tar -xzf '$remoteArchive' -C '$staging'; rm -f '$remoteArchive'; " +
          "if [ -f '$live/lan.json' ]; then sudo cp -p '$live/lan.json' '$staging/lan.json'; fi; " +
          "sudo chown -R www-data:www-data '$staging'; sudo find '$staging' -type d -exec chmod 755 {} +; sudo find '$staging' -type f -exec chmod 644 {} +; " +
          "if [ -e '$live' ]; then sudo mv '$live' '$backup'; fi; sudo mv '$staging' '$live'"
  & ssh.exe @sshOptions -p $Port $target $swap
  if ($LASTEXITCODE -ne 0) { throw 'Remote extraction or atomic swap failed.' }

  if (-not (Test-Live)) { throw 'The deployed page did not pass HTTP verification.' }
  & ssh.exe @sshOptions -p $Port $target "sudo rm -rf '$backup'"
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Deployment is live, but the prior-version backup could not be removed.' }
  Write-Host "Live: $LiveUrl" -ForegroundColor Green
} catch {
  if ($hadPrevious) {
    $rollback = "if [ -e '$backup' ]; then sudo rm -rf '$live'; sudo mv '$backup' '$live'; fi; sudo rm -rf '$staging'; rm -f '$remoteArchive'"
  } else {
    $rollback = "sudo rm -rf '$live'; sudo rm -rf '$staging'; rm -f '$remoteArchive'"
  }
  & ssh.exe @sshOptions -p $Port $target $rollback 2>$null
  throw
} finally {
  if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
}
