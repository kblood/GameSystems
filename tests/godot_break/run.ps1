# usage: pwsh run.ps1 [bottle]   (needs the NightfallContractsGodot portable Godot)
param([string]$bottle = 'flask')
$godot = 'C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe'
Copy-Item "$PSScriptRoot\..\..\shaders\godot\bottle_liquid.*" $PSScriptRoot -Force
Copy-Item "$PSScriptRoot\..\..\export\bottle_*" $PSScriptRoot -Force
& $godot --headless --path $PSScriptRoot --editor --quit-after 3 2>&1 | Select-String 'ERROR|SCRIPT' | Select-Object -First 5
& $godot --path $PSScriptRoot --rendering-driver vulkan -- $bottle "$PSScriptRoot\out" 2>&1 | Select-String 'SHOTS|ERROR|SCRIPT' | Select-Object -First 10
