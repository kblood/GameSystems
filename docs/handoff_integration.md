# Handoff: integration demo (all four agents' work merged)

Status: assembled, imported once, `-- --rest` and `-- --shots demo\out` run. Files touched: demo/{sync.ps1,main.gd}, gameplay/common/bottle_factory.gd, docs/integration.md, this file.

## What changed
- `sync.ps1`: all catalog designs (every tier that exists + liquid.json + base shards/broken/break.json renamed to the design), `bottle_pour.gd` (already covered by the gameplay\godot glob), container break data (renamed bottle_<n>*).
- `BottleFactory`: containers now return BreakableBottle (profile comes from `*_break.json`, no generic profile, no set_from_mesh); `variant_path` falls back to the next higher tier when a design has no tier GLB (container designs / later v2 designs are HIGH only).
- `main.gd`: pour bar scene, `U` uncap, `_run_bar_shots` (wine into tumbler, tipped tumbler + puddle, brick at tumbler, bullet at mug, brick at v2 design).
- `bottle_pour.gd:415` parse error was already fixed upstream (typed `period`).

## Verified
- `--rest`: all 24 spawned bodies (incl. 4 containers + 3 container designs) sleep, max v 0.
- Screenshots viewed (demo/out): 06 bar still life, 07 wine into tumbler (stream, level 33% then 100%, 76 -> 233 ml), 09 tipped tumbler + puddle (1.4 ml left), 10 brick shatters tumbler (EVENT broke shatter), 11 bullet makes mug leak, 12 designed v2 bordeaux shatters, 01c designed labels, 02 tilted held bottle.
- Tier cycle 1-4 produces no load errors after the fallback fix.

## Not verified
- Interactive hand play (G grab, U, wheel tilt) was not exercised by a human; shots drive bodies by script.
- Lower-tier looks of container / newer v2 designs (fall back to HIGH); sound; tank and jerrycan pouring; colour mixing; three.js with these assets in the demo.
