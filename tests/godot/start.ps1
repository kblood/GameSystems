# Interactive bottle-liquid test in Godot (no VR). Usage: pwsh start.ps1 [wine|beer|soda|whiskey|jar|flask]
param([string]$bottle = 'flask')
$godot = 'C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64.exe'
$con   = 'C:\Devstuff\GameDev\NightfallContractsGodot\.tools\godot\editor\Godot_v4.7.2-stable_win64_console.exe'
Copy-Item "$PSScriptRoot\..\..\shaders\godot\bottle_liquid.*", "$PSScriptRoot\..\..\shaders\godot\bottle_glass.*" $PSScriptRoot -Force
Copy-Item "$PSScriptRoot\..\..\export\bottle_*" $PSScriptRoot -Force
& $con --headless --path $PSScriptRoot --import 2>&1 | Out-Null
Start-Process $godot -ArgumentList '--path', "`"$PSScriptRoot`"", '--rendering-driver', 'vulkan', '--', $bottle
