#requires -Version 7
[CmdletBinding()]
param([switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$Name = 'flaskedemo'
$BaseUrl = 'https://dionysus.dk/webxr'
$HostName = '35.228.204.127'
$User = 'kaspersolesen'
$Key = 'C:\Devstuff\GCloud\caldor_nopass'
$Port = 22
$RemoteBase = '/var/www/html/webxr'
$LiveUrl = "$BaseUrl/$Name/"
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

function Test-Live {
  $ok = $true
  $indexUrl = "$LiveUrl`index.html"
  try {
    $index = Invoke-WebRequest -Method Get -Uri $indexUrl -TimeoutSec 30
    Write-Host ("    {0,-54} {1} {2}" -f $indexUrl, $index.StatusCode, ($index.Headers['Content-Type'] -join ','))
    $match = [regex]::Match($index.Content, 'src="([^"]+\.js)"')
    if (-not $match.Success) { throw 'Could not find the built JS entry in index.html.' }
    $paths = @(
      $match.Groups[1].Value,
      'assets/catalog.json',
      'assets/export/bottle_wine.glb',
      'assets/export/v2/bottle_longneck.liquid.json',
      'assets/export/v2/bottle_bordeaux_shards.glb',
      'assets/export/container_tumbler.liquid.json',
      'assets/audio/ogg/glass_shatter_large_01.ogg'
    )
    foreach ($path in $paths) {
      $url = [Uri]::new([Uri]$LiveUrl, $path)
      try {
        $r = Invoke-WebRequest -Method Head -Uri $url -TimeoutSec 30
        Write-Host ("    {0,-54} {1} {2}" -f $url.AbsoluteUri, $r.StatusCode, ($r.Headers['Content-Length'] -join ','))
      } catch { Write-Warning "HEAD $url failed: $($_.Exception.Message)"; $ok = $false }
    }
    $listing = Invoke-WebRequest -Uri "$BaseUrl/" -TimeoutSec 30
    if ($listing.Content -notmatch 'href="flaskedemo/"') { Write-Warning 'The /webxr/ directory listing does not show flaskedemo/.'; $ok = $false }
  } catch { Write-Warning "Live verification failed: $($_.Exception.Message)"; $ok = $false }
  return $ok
}

if ($VerifyOnly) {
  if (Test-Live) { exit 0 } else { exit 1 }
}
if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }

Push-Location $root
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'Build produced no dist/index.html.' }

$id = "$(Get-Date -Format 'yyyyMMddHHmmss')-$PID"
$archive = Join-Path $root "dist-$id.tgz"
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

  & $tar -czf $archive -C $dist .
  if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
  $files = Get-ChildItem $dist -Recurse -File
  $sizeMb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "Built $($files.Count) files ($sizeMb MB). Uploading to $LiveUrl"

  $prepare = "set -e; sudo mkdir -p '$RemoteBase'; sudo rm -rf '$staging'; sudo mkdir -p '$staging'"
  & ssh.exe @sshOptions -p $Port $target $prepare
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare remote staging directory.' }
  & scp.exe @sshOptions -P $Port $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

  $swap = "set -e; sudo tar -xzf '$remoteArchive' -C '$staging'; rm -f '$remoteArchive'; sudo chown -R www-data:www-data '$staging'; " +
          "if [ -e '$live' ]; then sudo mv '$live' '$backup'; fi; sudo mv '$staging' '$live'"
  & ssh.exe @sshOptions -p $Port $target $swap
  if ($LASTEXITCODE -ne 0) { throw 'Remote extraction or atomic swap failed.' }

  if (-not (Test-Live)) { throw 'The deployed files did not pass HTTP verification.' }
  $cleanup = "sudo rm -rf '$backup'"
  & ssh.exe @sshOptions -p $Port $target $cleanup
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
