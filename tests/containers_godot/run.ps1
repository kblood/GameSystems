# usage: pwsh run.ps1   (needs the portable Godot used by the other tests)
$godot = 'C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe'
$r = "$PSScriptRoot\..\.."
Copy-Item "$r\shaders\godot\liquid_lut_v2.gd" $PSScriptRoot -Force
Copy-Item "$r\tests\out\containers_lut_cases.json" $PSScriptRoot -Force
Copy-Item "$r\export\container_*.liquid.json", "$r\export\bottle_*.liquid_v2.json" $PSScriptRoot -Force
& $godot --headless --path $PSScriptRoot --import --quit 2>&1 | Out-Null
& $godot --headless --path $PSScriptRoot -s test.gd 2>&1 | Select-String 'GD cases|ERROR|SCRIPT'
