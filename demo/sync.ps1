# Copies the bottle library into this Godot project. The library stays the source of truth; do not edit the copies.
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File demo\sync.ps1 [-Import]
param([switch]$Import)
$ErrorActionPreference = "Stop"
$D = $PSScriptRoot
$R = (Resolve-Path "$D\..").Path
function CopyTo($src, $dst) { New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $src $dst -Force }
function MkDir($p) { New-Item -ItemType Directory -Force $p | Out-Null }

# scripts + shaders (res:// root: BottleLiquid preloads res://bottle_liquid.gdshader)
MkDir "$D\lib"
foreach ($f in "bottle_liquid.gd","bottle_liquid.gdshader","bottle_glass.gdshader","liquid_lut_v2.gd") { CopyTo "$R\shaders\godot\$f" "$D\$f" }
foreach ($f in Get-ChildItem "$R\gameplay\godot\*.gd") { CopyTo $f.FullName "$D\lib\$($f.Name)" }
CopyTo "$R\designs\godot\bottle_design.gd" "$D\lib\bottle_design.gd"
CopyTo "$R\audio\godot\bottle_audio.gd" "$D\lib\bottle_audio.gd"
foreach ($f in Get-ChildItem "$R\gameplay\common\*.gd") { CopyTo $f.FullName "$D\lib\$($f.Name)" }
# glass system (scripts + glass_pane.gdshader must stay together: GlassSystem/GlassPane load the shader next to the script)
MkDir "$D\lib\glass"
foreach ($f in Get-ChildItem "$R\gameplay\glass\godot\*" -Include *.gd,*.gdshader) { CopyTo $f.FullName "$D\lib\glass\$($f.Name)" }
CopyTo "$R\catalog.json" "$D\assets\catalog.json"

# audio (BottleAudio loads <name>_NN.wav)
MkDir "$D\audio\wav"
Copy-Item "$R\audio\wav\*.wav" "$D\audio\wav" -Force

# v1 bottles: <dir>/bottle_<n>.glb + sidecars + shards/broken/break
$A = "$D\assets"
foreach ($n in "beer","flask","jar","soda","whiskey","wine") {
  foreach ($f in Get-ChildItem "$R\export\bottle_$n*" -File) { CopyTo $f.FullName "$A\v1\$($f.Name)" }
}
# v2 bottles (+ lod1/lod2, liquid sidecar, profile)
foreach ($f in Get-ChildItem "$R\export\v2\*" -File) { CopyTo $f.FullName "$A\v2\$($f.Name)" }
# containers: renamed container_<n>* -> bottle_<n>* so BreakableBottle's "bottle_<name>.glb" convention applies
foreach ($f in Get-ChildItem "$R\export\container_*" -File) { CopyTo $f.FullName "$A\container\$($f.Name -replace '^container_','bottle_')" }
# designs: ALL catalog designs. bottle_<design>.glb (+tiers _medium/_low/_minimal where built, liquid.json); the base asset's
# shards/broken/break.json are copied under the design name so BreakableBottle (asset_dir=designs/, name=<design>) finds them.
$cat = Get-Content "$R\catalog.json" -Raw | ConvertFrom-Json
foreach ($e in ($cat.assets | Where-Object { $_.family -eq "bottle_design" })) {
  $dz = $e.id -replace '^design_',''
  foreach ($t in "","_medium","_low","_minimal") {
    if (Test-Path "$R\export\designs\$dz$t.glb") { CopyTo "$R\export\designs\$dz$t.glb" "$A\designs\bottle_$dz$t.glb" }
  }
  if (Test-Path "$R\export\designs\$dz.liquid.json") { CopyTo "$R\export\designs\$dz.liquid.json" "$A\designs\bottle_$dz.liquid.json" }
  $base = [string]$e.base
  if ($base -like 'bottle_v2_*') { $bp = "$R\export\v2\$base" }
  elseif ($base -like 'container_*') { $bp = "$R\export\$base" }
  else { $bp = "$R\export\$base" }
  foreach ($s in "_shards.glb","_broken.glb","_break.json") { if (Test-Path "$bp$s") { CopyTo "$bp$s" "$A\designs\bottle_$dz$s" } }
}
if ($Import) {
  $G = "C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe"
  & $G --headless --path $D --import 2>&1 | Select-String "ERROR|SCRIPT|Parse" | Select-Object -First 30
}
"synced to $D"
