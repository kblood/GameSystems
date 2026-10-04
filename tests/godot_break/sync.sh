#!/bin/bash
# Copy gameplay scripts, liquid shaders and bottle assets (incl. shards/broken/break.json when present) into this project, re-import.
D="$(cd "$(dirname "$0")" && pwd)"; R="$D/../.."
cp -f "$R"/gameplay/godot/*.gd "$D/"
cp -f "$R"/shaders/godot/bottle_liquid.* "$R"/shaders/godot/bottle_glass.gdshader "$D/"
cp -f "$R"/export/bottle_* "$D/"
G="/c/Devstuff/GameDev/NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe"
"$G" --headless --path "$D" --import 2>&1 | grep -E "ERROR|SCRIPT|Parse" | head -30
