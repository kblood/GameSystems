# Pour / empty system (Godot, phase 1)

Source: `godot/addons/gs_bottles/bottle_pour.gd` (`GSBottlePour`). Bottle factories add this
child to spawned bodies and expose it through meta `"pour"`; hosts may also attach it directly.
Containers that are closed (capped bottles) pour nothing; they start pouring as soon as they are open
(`ctl.cap_open = true`, Cap node hidden/removed, or `info.open` containers: tumbler, mug, flasks, jerrycan, tank).

## Volume drain (truth is `body.fill`)
Per physics tick, in liquid-node space with `u` = world up:
- lowest lip height `s_lo = mouth_centre.u - r * sin(angle(mouth_axis, u))`; level `d = lut.offset(u, fill)`.
- excess above the lip = `fill - lut.fill_at(u, s_lo)` (x capacity_ml from the liquid sidecar).
- rate = weir/orifice sum over 16 strips of the submerged mouth disc: `Q = cd * sum(w * sqrt(2 g h) dx)`, cd 0.62.
- glug limit when the mouth is fully submerged: `Q <= glug_k * A * sqrt(g * 2r)` (glug_k 0.9; the stream radius pulses).
- removed per tick: `min(excess, Q dt, volume)`. Stops at the rim; inverted it drains until empty (last film < 0.15 ml goes at once).
- `BottleLiquid.drain_driven = true` makes the liquid draw the real volume (`lut.offset`) instead of the old visual-only
  `lut.spill` clamp (which drew inverted uncapped bottles as empty). Without a pour node the old behaviour is unchanged.

## Stream, receivers, puddles
- Each tick's volume is one parcel (pos, vel, ml, colour, authored liquid kind) leaving the low lip with velocity `Q / A_jet` along the mouth
  axis plus the rigid-body velocity at that point. Parcels integrate ballistically (SoA arrays, swap-remove).
- Receivers: other open `GSBottlePour` containers with upward mouths (n.y >= 0.2), and enabled host-owned
  `GSPourReceiver` openings. Both are limited to the same `World3D`; bottle mouths are culled within
  3 m of the source body, while external openings are culled within 3 m of each airborne segment. The
  nearest front-to-back mouth crossing before the first solid hit wins, independent of registration order.
  Bottle mouths use 0.97 r; external openings use their authored local disc. Bottle
  `receive(ml, colour, source, kind)` raises fill by the accepted dose/capacity and wakes body/liquid.
  Nearly empty (< 0.5 ml) bottles adopt colour; only genuinely empty bottles adopt a new known liquid
  kind. Different kinds become unknown. Bottle capacity overflow leaves over its low rim in another
  typed parcel. External openings accept a bounded amount; unaccepted volume continues flying.
  `poured_into(receiver_body_or_endpoint, ml)` reports bottle-owned doses or external accepted doses.
- One ray per parcel per tick (masks 1|2|8) establishes solid ordering; hit = `GSBottleBreakManager.add_puddle` (+ every 3rd hit up to 20% as 2
  splash droplets via `emit_droplet`). Steep hits drop to the floor below.
- Ledger: `poured_ml`, `received_ml`, `delivered_ml`, `spilled_ml`, statics `world_puddle_ml`, `world_lost_ml`,
  `in_flight_ml()`. Transport volume is accounted for in a receiver, physical spill or explicit loss;
  pending overflow remains owned until emitted or settled. Break emits pending overflow when mouth
  geometry survives; unavailable geometry or source removal records it as outgoing/lost exactly once.
  Native puddles currently retain volume/colour only: fuel identity and fire coupling are still pending.
- Visual (HIGH): one 10x40 tube mesh bent along `p0 + v0 t + g t^2/2` in the vertex shader (radius from flow
  continuity `sqrt(Q / (pi v))`, twist-free frame, small travelling waves, glug pulse). Opaque (transparent tube
  self-sorts badly). Tail falls away after the stream stops.

## Cost
`_physics_process` runs only while the body/liquid is awake, pouring, or parcels/overflow are in flight. Sleeping or
capped and at rest: 0 (verified: 3 resting containers, 0 pour nodes processing). Pouring: one LUT lookup pair, 16-strip
sum, one ray per parcel (~ 15-30 parcels for a 0.3 s flight) and one receivers scan per tick.
The same-world/3 m segment cull keeps distant external openings out of each parcel's geometry checks,
without changing airborne transport when the source container is carried or dropped elsewhere.

## Tiers
`quality` (3 high .. 0 minimal) is a per-pour ceiling. The active stream uses the lower of that value and the
liquid shader's current distance tier. Cached tube meshes use 10×40, 8×28, 6×18 and 4×10 ring/side profiles;
all tiers retain the parabolic tube, exact per-tick parcel volume, receiver hits and puddle accounting. The
volume-carrying landing splash cadence stays constant across tiers so visual LOD cannot change where liquid ends up.
Quality changes tube geometry while preserving liquid transfer and puddle volume.

## Typed external openings (native Godot)

`gs_bottles/GSPourReceiver` is a `Node3D` opening with a local disc `radius`,
front-facing `normal` and host-owned `accept_ml(ml, liquid_kind, source)` callback.
The callback transfers liquid into its backing store and returns the exact
accepted millilitres. Add the receiver at an authored mouth/filler marker;
removal unregisters it automatically. The receiver owns no tank or car.

`GSBottlePour.liquid_kind` defaults to `unknown`; hosts explicitly author
`petrol`, `water`, etc. Existing bottle styles, shaders and colours do not imply
fuel identity. Each emitted parcel captures its kind. Empty bottle receivers
adopt an incoming kind; unlike or unknown contents become `unknown`. Rim
overflow preserves the incoming kind independently of the retained contents.

Parcels select the nearest opening before the nearest solid ray hit, only within
their source's `World3D`. Partial/rejected receipts leave remaining volume flying
until it lands or reaches the lost-volume ledger. Broken sources still advance
previously emitted parcels; removal settles remaining volume exactly once,
including removal from a receiver callback. Virtual openings create no airborne
puddle. Source physics contract (22 checks):

`godot --headless --path GameSystems/godot --script res://addons/gs_bottles/tests/gs_pour_receiver_tests.gd`.

The checks cover identity, partial transfer/spill, nearest-hit/wall ordering,
scaled discs, backface/cross-world rejection and callback interruption.

## Tests
`tests/pour_proj/pour_test.gd` (`-- --numeric` headless, `-- --shots <dir>` windowed). Results 2026-10-04: all 10 checks
pass; screenshots in `tests/out/pour/`.

## Stream geometry tests (tests/streamtest_proj/stream_test.gd)
`godot --headless --path tests/streamtest_proj res://stream_test.tscn -- --numeric [--no6] [--ids a,b]` (`--probe` prints stream numbers,
`--shots <dir>` windowed). Containers: wine, beer, whiskey, v2 bordeaux, tumbler, mug, hipflask, jerrycan_fuel, pet500_orange, pet2l_cola;
tilts 100/130/160/180 deg (0.8 fill, held, 1.5 s pour then upright). Result 2026-10-04: 330 checks, 0 fails.
1. p0 inside the mouth disc (radial <= mouth_radius, <= 2.1 mm off the mouth plane).
2. tube radius at t0 <= mouth_radius (new `stream_radius_at(t)`, same formula as the shader, shader now clamps to r_max = mouth radius);
   steady unplugged flow r0 / sqrt(wet/pi) in 0.8..1.25 (measured 1.01 jerrycan; plugged/glug cases are exempt, r0 = 83 % of mouth).
3. radius non-increasing along the fall.
4. parabola landing == parcel landing (< 1 cm, measured 0.0 mm); landed volume == drained volume (< 2 %, measured 0.00 %).
5. stream visible whenever flow > 0, hidden within t_land (+1 tick) after the flow stops, never visible before the first flow.
6. steady tilt at threshold, +0.5, +1, +2 deg: at most 1 stream start per second (measured 1 start, 0 re-starts; thresholds 40-83 deg).
7. tube continuous: t0 = 0, t1 >= landing time once the stream has developed, ring spacing <= 5 cm (chord sag 0.1 mm), radius >= 0.7 mm.
8. animates: a tracked parcel advances along its parabola every tick; shader carries TIME terms (travelling waves, streaks).
9. splash beads (MultiMesh droplets) never fatter than the tube at the landing point.
Bugs found and fixed in bottle_pour.gd: `flow_ml_s` kept its last value when the container emptied or closed (stale flow, stream checks
read garbage); splash droplets were up to 9 mm balls next to a 3 mm PET stream and appeared when the stream landed right at the
mouth (now capped to 0.6 x tube radius, none for parcel age < 0.08 s, rest of the volume goes to the puddle); shader tube radius could
exceed the mouth radius (r_max was a fixed 14 mm, now the mouth radius, final clamp after pulse/waves). Wide mouths (tumbler, mug)
dump 0.8 fill in ~0.1 s (2000 ml/s) at 130 deg: physically plausible, stream checks then run on few ticks.
Note: the "row of beads" report could not be reproduced as a tube defect (tube is one continuous mesh); the beads were landing splash droplets.
