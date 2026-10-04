#!/bin/bash
# usage: shots.sh outdir bottle...
cd /c/Tools/BlenderShared/tests/godot_bubbles
G="/c/Devstuff/GameDev/NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe"
o=$1; shift; rm -rf $o; mkdir -p $o
for b in "$@"; do timeout 150 "$G" --path . --rendering-driver vulkan -- $b --shots "$(pwd -W)/$o" > $o/log_$b.txt 2>&1; grep -E "ERROR|error|SHOTS" $o/log_$b.txt | head -5; done
