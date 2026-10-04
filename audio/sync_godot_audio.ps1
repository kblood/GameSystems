# Copies generated wavs + catalog + helper into a Godot project: pwsh audio\sync_godot_audio.ps1 [projectDir]
param([string]$proj = "$PSScriptRoot\..\tests\godot_audio")
New-Item -ItemType Directory -Force "$proj\audio\wav","$proj\audio\godot" | Out-Null
Copy-Item "$PSScriptRoot\wav\*.wav" "$proj\audio\wav" -Force
Copy-Item "$PSScriptRoot\catalog.json" "$proj\audio" -Force
Copy-Item "$PSScriptRoot\godot\bottle_audio.gd" "$proj\audio\godot" -Force
