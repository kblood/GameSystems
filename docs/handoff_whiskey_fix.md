# Handoff: whiskey Liquid winding fix

- Cause: lathe() in scripts/bottles.py relies on bmesh recalc_face_normals, which picked inward orientation for the whiskey Liquid (signed volume -532.6 ml).
- Fix: in lathe(), for full revolutions compute signed volume after recalc and reverse_faces if negative (generic, no-op for already-correct meshes).
- Rebuilt only whiskey: export/bottle_whiskey.glb, export/bottle_whiskey.liquid.json (byte-identical to before), src/bottle_whiskey.blend. catalog.json is rewritten by the build script (same entries expected).
- Signed Liquid volume after (ml, capacity_ml): wine 886.0 (868), beer 493.0 (494.3), soda 667.3 (668.7), whiskey +532.6 (533.9), jar 566.9 (568.0), flask 1097.4 (1100.2). Before: only whiskey was negative (-532.6).
- Glass/Cap volumes positive and unchanged for all bottles. Other 5 bottles NOT rebuilt (flip is a no-op for them, so output would be identical); not verified byte-for-byte.
- Godot: scratch project tests/godot_whiskeyfix (flip_faces forced false) imported and ran; reported flip=false vol=+0.000533 m3. Screenshots in tests/godot_whiskeyfix/out. NOT YET VIEWED by me: amber vs maroon check is left (e.g. whiskey_close_calm_t0.png).
- fracture.py: imports B.lathe, so it inherits the fix on next run, and it reads liquid.json (unchanged). It does not read winding itself (uses abs volumes). Existing bottle_whiskey_shards.glb / _broken.glb were built with the old lathe, so their Liquid may still be inverted until fracture.py is re-run; not checked (broken glb files for whiskey were not located by a quick path test).
- Left: view screenshot; optionally re-run fracture.py for whiskey; then flip_faces auto-detect in shaders/godot/bottle_liquid.gd becomes a harmless safety net.
- Wine mesh volume (886) vs capacity_ml (868) differs 2%; unrelated, not touched.
