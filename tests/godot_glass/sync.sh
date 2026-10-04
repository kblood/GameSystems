#!/bin/bash
# Copy the glass library into this project (res://glass/) and re-import. Never edit files in res://glass/ directly.
D="$(cd "$(dirname "$0")" && pwd)"; R="$D/../.."
mkdir -p "$D/glass"
cp -f "$R"/gameplay/glass/godot/*.gd "$R"/gameplay/glass/godot/*.gdshader "$R"/gameplay/glass/godot/*.json "$D/glass/" 2>/dev/null
cp -f "$R"/export/glass/*.glb "$D/glass/" 2>/dev/null
G="/c/Devstuff/GameDev/NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe"
timeout 120 "$G" --headless --path "$D" --import 2>&1 | grep -E "ERROR|SCRIPT|Parse" | head -30
