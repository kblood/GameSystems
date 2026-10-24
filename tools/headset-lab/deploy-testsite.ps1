#requires -Version 7
# Builds and deploys the static headset test site (make-test-site.mjs -> build/testsite/) to
# https://dionysus.dk/webxr/GameSystemsTest/ with the same SSH setup and atomic staging swap (one backup kept until the
# new version verifies) as deploy-hub.ps1. It never touches /webxr/GameSystems/ (cloud page, lan.json) or the old app folders.
#   -SkipBuild   upload the existing build/testsite without rebuilding the apps
#   -VerifyOnly  only checks the live site (index + every link on it)
# The builds run `vite build` directly (no `npm run sync`, so nothing is synced from CharacterCreator) and stage Contracts
# with its own tools/stage_site.mjs.
[CmdletBinding()]
param([switch]$VerifyOnly, [switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$Name = 'GameSystemsTest'
$BaseUrl = 'https://dionysus.dk/webxr'
$HostName = '35.228.204.127'
$User = 'kaspersolesen'
$Key = 'C:\Devstuff\GCloud\caldor_nopass'
$Port = 22
$RemoteBase = '/var/www/html/webxr'
$LiveUrl = "$BaseUrl/$Name/"
$gs = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$contracts = if ($env:CONTRACTS_DIR) { $env:CONTRACTS_DIR } else { Join-Path $gs '..\NightfallContractsWebXR-interaction' }
$source = Join-Path $PSScriptRoot 'build\testsite'

function Test-Live {
  $ok = $true
  try {
    $page = Invoke-WebRequest -Method Get -Uri $LiveUrl -TimeoutSec 30
    Write-Host ("    GET  {0,-60} {1} {2}" -f $LiveUrl, $page.StatusCode, ($page.Headers['Content-Type'] -join ','))
    if ($page.Content -notmatch 'GameSystems testsuite') { Write-Warning 'The live page does not look like the test suite.'; $ok = $false }
    $hrefs = [regex]::Matches($page.Content, 'class="go" href="([^"]+)"') | ForEach-Object { [System.Net.WebUtility]::HtmlDecode($_.Groups[1].Value) } | Sort-Object -Unique
    foreach ($h in $hrefs) {
      $url = [Uri]::new([Uri]$LiveUrl, $h)
      try { $r = Invoke-WebRequest -Method Get -Uri $url -TimeoutSec 60; Write-Host ("    GET  {0,-60} {1}" -f $url.PathAndQuery, $r.StatusCode) }
      catch { Write-Warning "GET $url failed: $($_.Exception.Message)"; $ok = $false }
    }
  } catch { Write-Warning "Live verification failed: $($_.Exception.Message)"; $ok = $false }
  return $ok
}

if ($VerifyOnly) { if (Test-Live) { exit 0 } else { exit 1 } }
if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }

if (-not $SkipBuild) {
  foreach ($app in @((Join-Path $gs 'webxr-demo'), (Join-Path $gs 'apps\grasp-studio'))) {
    Push-Location $app
    try {
      npx vite build
      if ($LASTEXITCODE -ne 0) { throw "vite build failed in $app (exit $LASTEXITCODE)" }
      if ($app -like '*webxr-demo') { node scripts/copy-assets.mjs; if ($LASTEXITCODE -ne 0) { throw 'copy-assets failed' } }
    } finally { Pop-Location }
  }
  Push-Location $contracts
  try { node tools/stage_site.mjs; if ($LASTEXITCODE -ne 0) { throw 'stage_site failed' } } finally { Pop-Location }
  node (Join-Path $PSScriptRoot 'make-test-site.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'make-test-site failed' }
}
if (-not (Test-Path (Join-Path $source 'index.html'))) { throw "Missing $source\index.html (run without -SkipBuild)" }

$id = "$(Get-Date -Format 'yyyyMMddHHmmss')-$PID"
$archive = Join-Path ([IO.Path]::GetTempPath()) "gamesystems-testsite-$id.tgz"
$remoteArchive = "/tmp/$Name.$id.tgz"
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
  $files = Get-ChildItem $source -Recurse -File
  $sizeMb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "Built $($files.Count) files ($sizeMb MB). Uploading to $LiveUrl"

  & ssh.exe @sshOptions -p $Port $target "set -e; sudo mkdir -p '$RemoteBase'; sudo rm -rf '$staging'; sudo mkdir -p '$staging'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare remote staging directory.' }
  & scp.exe @sshOptions -P $Port $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

  $swap = "set -e; sudo tar -xzf '$remoteArchive' -C '$staging'; rm -f '$remoteArchive'; " +
          "sudo chown -R www-data:www-data '$staging'; sudo find '$staging' -type d -exec chmod 755 {} +; sudo find '$staging' -type f -exec chmod 644 {} +; " +
          "if [ -e '$live' ]; then sudo mv '$live' '$backup'; fi; sudo mv '$staging' '$live'"
  & ssh.exe @sshOptions -p $Port $target $swap
  if ($LASTEXITCODE -ne 0) { throw 'Remote extraction or atomic swap failed.' }

  if (-not (Test-Live)) { throw 'The deployed site did not pass HTTP verification.' }
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
