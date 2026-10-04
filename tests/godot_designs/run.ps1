# usage: pwsh run.ps1 [-Shots] [-V2 | -Containers] [-NoImport]   copies shaders + runtime helper + built designs into this Godot project, imports, then runs.
#   -V2          only designs/v2_*        (shots -> tests/out/godot_designs_v2)
#   -Containers  only designs/container_* (shots -> tests/out/godot_designs_cont)
#   -V2 -Containers  both                 (shots -> tests/out/godot_designs_v2)
param([switch]$Shots, [switch]$V2, [switch]$Containers, [switch]$NoImport)
$godot = 'C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe'
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
# bottle_liquid.gd needs liquid_lut_v2.gd (class LiquidLutV2) since the LUT v2 runtime landed
Copy-Item "$root\shaders\godot\bottle_liquid.*","$root\shaders\godot\liquid_lut_v2.gd","$root\shaders\godot\bottle_glass.gdshader","$root\designs\godot\bottle_design.gd" $PSScriptRoot -Force
New-Item -ItemType Directory -Force "$PSScriptRoot\designs","$PSScriptRoot\labels" | Out-Null
Copy-Item "$root\export\designs\*.glb","$root\export\designs\*.json" "$PSScriptRoot\designs" -Force
Copy-Item "$root\labels\*.png" "$PSScriptRoot\labels" -Force
Copy-Item "$root\labels\user" "$PSScriptRoot\labels" -Recurse -Force
if (-not $NoImport) { & $godot --headless --path $PSScriptRoot --import 2>&1 | Select-String 'ERROR|SCRIPT' | Select-Object -First 8 }
$sel = @(); if ($V2) { $sel += '--v2' }; if ($Containers) { $sel += '--containers' }
$out = if ($V2) { "$root\tests\out\godot_designs_v2" } elseif ($Containers) { "$root\tests\out\godot_designs_cont" } else { "$root\tests\out\godot_designs" }
# --quit-after: safety net so a script error can never hang the run (the shots need ~30 frames per view)
if ($Shots) { & $godot --path $PSScriptRoot --rendering-driver vulkan --quit-after 12000 -- @sel --shots $out 2>&1 | Select-String 'SHOTS|swap|glass|ERROR|SCRIPT' | Select-Object -First 60 }
else { & $godot --path $PSScriptRoot --rendering-driver vulkan -- @sel }
