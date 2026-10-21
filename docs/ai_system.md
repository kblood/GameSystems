# AI system (extensions/ai)

Shared NPC AI for VR games: perception, intent, movement, group coordination, and two brains on top (a zombie brain and
a guard brain, a JS port of the NightfallContractsGodot guard). The VR-specific rules (personal space, hit reactions,
no pinning) live here too; the general architecture is in [vr/npc_ai.md](vr/npc_ai.md).

Location: `extensions/ai/`. Pure JavaScript with no dependencies. `three.js` is only used in `three-adapters.js`, which
takes `THREE` as a parameter. `tests/extension-boundaries.test.js` enforces this.

## Quick start

```js
import { createAIWorld, createNavGrid, createZombieBrain, boxesFromObjects, createRaycast } from './extensions/ai/index.js';

const navmesh = createNavGrid({ boxes, agentRadius: 0.3 });           // boxes: [{ min:[x,y,z], max:[x,y,z] }]
const ai = createAIWorld({ navmesh, raycast: (a, b) => blocked, seed: 7 });   // raycast(a, b) -> true if blocked
const zombie = ai.addAgent(createZombieBrain({ aggression: 0.8 }), { position, yaw: 0 }, { id: 'zombie-0' });

ai.stimulus({ type: 'gunshot', position: muzzle });                  // heard on the next tick
ai.update(dt, { head, hands: [left, right], floorY: 0 });            // the host calls this every frame
zombie.intent.velocity; zombie.intent.face; zombie.intent.actions;  // read by the host; the host moves the body
ai.on('attack', e => player.damage(e.damage));
```

Agents output intent only. The host owns the body: it reads `intent`, moves the body (`stepBody` helps for a simple
body that slides along blocked cells), and posts physical events back. The AI never moves the player or the camera.

## World API

| Call | What it does |
| --- | --- |
| `createAIWorld({ navmesh, raycast, config, seed })` | The world. `config` overrides `WORLD_DEFAULTS`. |
| `addAgent(brain, body, { id })` | Adds a brain for a host body `{ position, yaw }`. One brain per agent. Returns the agent. |
| `update(dt, player)` | Advances the world. `player = { head, hands?: [l, r], floorY?, active? }`. Runs at most `maxTicksPerUpdate` fixed ticks. |
| `stimulus({ type, position, radius?, source?, occlude? })` | Posts a sound. Heard on the next tick. Types: `gunshot explosion impact voice footstep noise`. |
| `shotFired(from, to, { sound?, radius? })` | A gunshot: posts the stimulus and lets guards react to near misses (suppression). |
| `hit(agent, { region, point?, direction?, impulse?, damage?, bullet? })` | The hit hook. See below. |
| `setPhysicalState(agent, state)` | The physical state input. See below. |
| `on(type, fn)` | Subscribes to one event type (see the table below). |
| `reset()` | Every agent back to its spawn state; the squad and horde release their slots. |
| `stats()` | Counters: `ticks`, `rays`, `sightRays`, `maxRaysInTick`, `attackers`, `investigators`, `flankers`, `events`, `alive`, ... |

### Config (`WORLD_DEFAULTS`)

| Key | Default | Meaning |
| --- | --- | --- |
| `tickRate` | 30 | AI decisions per second. Slower than rendering. |
| `maxTicksPerUpdate` | 4 | A long frame catches up at most this many ticks. |
| `raysPerTick` | 12 | Sight-ray budget shared by all agents, round-robin. |
| `perceptionHold` | 0.25 s | A sight result stays valid while an agent waits for its slice. |
| `stimulusRadius` | gunshot 30, explosion 45, impact 9, voice 12, footstep 4, noise 6 | Default radius per type (m). |
| `playerFootsteps` | radius 4, minSpeed 0.7, interval 0.55 | The player's own fast steps are footstep stimuli. Teleports are not motion. |

## Hit hook and physical states (VR scope)

There are no canned flinch animations and no pose hacks. The AI exposes a hit hook and a physical-state input, and a
physical layer (IK reactions, an active ragdoll, or a placeholder timer) does the body work.

### Hit hook

```js
const e = ai.hit(agent, { region: 'leftUpperArm', point, direction, impulse: 2.7, damage: 30 });
// emits 'hit' with { agent, region, point, direction, impulse, damage, regionClass, stagger, killed, ... }
```

- `agent`: the agent the hit landed on.
- `region`: a region name. `regionClass(region)` gives `head | arm | leg | chest`; the guard maps it to `head | limb | body`
  (`guardZone`). Names such as `neck`, `jaw`, `hand`, `foot` are matched by pattern.
- `point`, `direction`: world-space `{x,y,z}` (or arrays). `direction` is the bullet or shove direction.
- `impulse`: N·s, the impulse delivered by the hit (the zombie lab passes 2.7 for a pistol shot).
- `damage`: optional. Overrides the zone damage. Without it the brain uses its own zone table.
- `bullet`: optional opaque reference, passed through to the event.

What the brain does with a hit: a zombie cancels a wind-up or a lunge (`attackCancelled` with reason `hit`); a guard
takes damage, staggers by region, and is alerted. Damage is an event only: the AI never hurts the player. The host
decides what a hit means for the body.

### Physical state

```js
ai.setPhysicalState(agent, 'destabilized');   // 'standing' | 'destabilized' | 'downed' | 'recovering' | 'inert'
```

| State | Brain behaviour |
| --- | --- |
| `standing` | Normal. |
| `destabilized` | Tactics and attacks pause (the intent is `paused`, speed 0). The host plays the stagger. |
| `downed` | Paused, on the floor. No attacks, no fire. |
| `recovering` | Still paused. The host gets up. |
| `inert` | Dead weight: the brain stops for good (the body is out of the fight). |

The guard matches `guard.gd`: a reload is interrupted by a non-standing state, and no shots are fired while down. The
brain resumes from where it was after `standing` (zombies walk back to their slot at 0.7x chase speed). Every change
emits a `physical` event (`{ agent, from, to }`) so the physical layer can respond.

The zombie lab drives these states from `extensions/hitreact`: an IK hit reaction (hit chain spring-damper, planted
feet, balance step, knockdown after repeated hits) and, opt-in with `?ragdoll=1`, an active ragdoll that takes over in
`downed` and `inert`. `?hitreact=0` falls back to the old timer placeholder (a 1.0 s fall, then 0.35 s recovering).

## Perception

Sight is a cone with range, occlusion through the injected raycast, and suspicion that builds while seen and decays
when not. Hearing is a stimulus bus: a sound sets the bearing (with a bounded error that grows with distance) and
memory, but it never produces a line-of-sight fact, so a guard can investigate a noise it cannot see but cannot shoot
through a wall.

`PERCEPTION_DEFAULTS` (abridged): `sightRange 23 m`, `viewHalfAngle 65 deg` (calm), `alertViewHalfAngle 87 deg`,
`focusHalfAngle 35 deg`, `peripheralRate 0.45`, `nearRange 7 m` (full rate inside), `minDistanceRate 0.25`,
`darkRate 0.35`, `memory 8 s` (last known position).

Sight rays are time-sliced: 12 per tick, round-robin across agents, with a 0.25 s hold while a result waits for its
slice. A test asserts that no tick spends more than the budget and that every agent still gets a turn.

## Intent

Each agent is a state machine (the brain's states) plus a utility scorer (`utility.js`) that picks between competing
goals. The scorer is deterministic under a seed: each agent gets `createRng(hashSeed(seed, id))`, so the same seed gives the same
decisions and paths, and another seed differs.

`agent.intent` is the output: `{ state, velocity, speed, gait, face, look, hasLook, aim, hasAim, telegraph, actions,
paused, ... }`. `actions` lists what happened since the last update: `{ type: 'fire' | 'reload' | 'windup' | 'lunge' |
'attack' }` with their origin, aim point and seed. The host turns them into effects.

## Navigation

`createNavGrid({ boxes, agentRadius, cell, margin, bounds })`: a 2D walkable grid (default cell 0.2 m) over the floor.
Boxes are obstacles, with `stepHeight 0.3` (low boxes are stepped over) and `headroom 1.7` (high boxes are walked
under). The grid is baked from `boxes` and exposes `findPath`, `closest`, `walkable`, `segmentClear`, `floorY`,
`version`. Adding a box re-bakes the grid and bumps `version`; agents then re-plan.

Why a grid and not a navmesh library (recast): the scene is a small set of axis-aligned boxes; a grid is exact for
them, has no WASM and no dependency (so it runs in node tests), and bakes in a few milliseconds. Recast would add a
build step and a dependency for no gain on this geometry. The grid is the reason the extension can stay pure. If a
game has sloped or multi-level floors, swap in a navmesh that exposes the same interface; the agents do not change.

Path following (`steering.js`): corners are reached within `arrive 0.15 m`; the agent slows inside `slowRadius 0.5 m`
of its goal; it re-plans every `pathRefresh 0.8 s` or when the goal moves `goalMoved 0.4 m`. Avoidance keeps
`separation 0.7 m` between agents and sidesteps a slower agent `avoidLookahead 1.0 m` ahead.

## Group coordination

- **Squad (guards):** at most `maxConcurrentShooters 2` shooters in a `shooterWindow 1.05 s` window, with a
  `minShotGap 0.22 s` between shots from different guards (turn-taking, no volleys). Investigators are capped at
  `investigatorsMax 2`. One flanker at a time (`flankersMax 1`). Guards report sightings to nearby squad mates.
- **Horde (zombies):** surround slots on a ring (`spacing 0.65 m`, up to `maxSlots 8`). At most `maxAttackers 2` attack
  at once. An escape lane (`escapeHalfAngle 40 deg`) stays open, so the horde never pins the player against a wall.
  Zombies without a slot wait on a ring (`waitRadius 2.1 m`).

## Personal space (VR)

Zombies never enter `personalSpace` (0.5 m) of the tracked head or `handSpace` (0.3 m) of a tracked hand. The rule is
enforced in steering, so a lunge also stops at the boundary. The AI never pushes the player, moves the camera, or
pins the player without an escape lane.

## The zombie brain

Wander near home, hear a sound and investigate it (`investigateFor 40 s` keeps the spot in memory while walking),
sense the player mostly by sound, chase along the navmesh on sight, and surround the player as a horde. An attack is a
wind-up telegraph (`windup 0.75 s`), then a lunge (`0.3 s`, `lungeSpeed 1.4 m/s`), then the hit (grab or bite). A hit
or a shove during the wind-up cancels the attack.

Gore mobility is read by `mobilityFromGore(gore)`: a crawler attacks low (`crawlRange 1.05 m`), a zombie with no arms
bites only, a headless zombie is dead. Stagger depends on the hit region.

`ZOMBIE_DEFAULTS` (abridged): `aggression 0.6`, `hearingRange 1` (multiplies every stimulus radius), `sightRange 7 m`
(standing; zombies mostly hear), `viewHalfAngle 55 deg`, `alertViewHalfAngle 80 deg`, `senseRadius 1.4 m`,
`detectionRate 2.4`, `memory 9 s`, `speed { wander 0.22, investigate 0.4, chase 0.55 } m/s`, `wanderRadius 2.5 m`,
`wanderPause [1.2, 3.5] s`, `eyeHeight 1.55 m` (crawl 0.35 m, `crawlSightScale 0.6`), `personalSpace 0.5 m`,
`handSpace 0.3 m`, `maxAttackers 2`, `hordeSpacing 0.65 m`. `attack` holds range (0.85 m, crawl 1.05 m), wind-up
(0.75 s), lunge (0.3 s at 1.4 m/s) and reach (0.5 m).

## The guard brain

A JS port of the Godot guard (NightfallContractsGodot `guard_brain.gd`, `guard_tactics.gd`, `guard_tuning.gd`): suspicion
and reaction, cover and peek (validated cover that hides a crouched guard from the player's head and lean offsets),
one flanker, retreat below `retreatHealth 40`, search for `searchDuration 10 s`, squad fire discipline, suppression by
near misses, a magazine and reloads, and hit zones (head, limb, body) with stagger.

`GUARD_DEFAULTS` (abridged): `reactionDelay 0.38 s`, `shotInterval 0.55 s`, `sightRange 23 m`, `reloadDuration 2.4 s`,
`health 100`, `magazine 12`, `reserves 36`, `telegraphTime 0.6 s`, `baseSpread 1.0 deg`, `spreadPerMeter 0.16`,
`motionSpread 2.0`, `suppressionSpread 4.0`, `aggression 0.5`. Crouch drop is 0.26 m, as in Godot, so cover must be at
least about 1.6 m tall to hide a crouched guard.

Difficulty presets (`GUARD_DIFFICULTY`): `easy` (reaction 0.7 s, telegraph 0.9 s, spread 1.8, shot interval 0.85 s),
`normal` (defaults), `hard` (reaction 0.25 s, telegraph 0.45 s, spread 0.7, shot interval 0.45 s). Explicit knobs beat
the preset. Every knob is clamped to its range (`RANGES`), as the original does.

The Nightfall adapter (`src/game/squad_logic.js`) maps this brain to the logic objects `enemies.js` uses; see
`?ai=squad` below.

## Events

| Event | Fields | When |
| --- | --- | --- |
| `state` | `agent, from, to` | A brain changes state |
| `spotted` | `agent, at` | A zombie first sees the player |
| `heard` | `agent, stimulus, loudness, at` | A stimulus reaches an agent |
| `telegraph` | `agent, kind, target, windup, at` | A zombie wind-up starts, or a guard starts aiming (the readable tell) |
| `attack` | the attack event (kind, damage, target) | An attack connects |
| `attackMissed` / `attackCancelled` | `agent`, reason | A lunge misses / a wind-up is cancelled (reason `hit`, ...) |
| `shoved` | `agent, hand, velocity` | A fast hand shove reached the zombie |
| `hit` | `agent, region, point, direction, impulse, damage, bullet` plus the brain's result | The hit hook fired |
| `physical` | `agent, from, to` | The physical state changed |
| `staggered` | `agent, zone` | A hit staggered the guard |
| `suppressed` | `agent, amount, from` | A near miss suppressed a guard |
| `death` | `agent` (guards add `zone`) | The agent died |
| `fire` | `agent, origin, aim, target, rounds, seed` | A guard fired |
| `reload` | `agent` | A guard started a reload |
| `callout` / `report` | `agent, kind, at` (report adds `delivered`) | Squad callouts and sighting reports |
| `note` | `agent, reason` | Debug notes (cover chosen, flank, retreat) |

## Debug overlay

`createAIDebug(THREE, scene, ai)` (in `three-adapters.js`, the world as the third argument) draws, per agent: the path lines, a state label, the sight
cone, slots and the escape lane. The zombie lab toggles it with `?aidebug=1`, the `aidebug` button, or the I key. The
overlay is for development and is off by default.

`boxesFromObjects(THREE, objects)` builds the obstacle list from meshes; `createRaycast(THREE, objects)` builds the
occlusion raycast. Both are adapters and are the only places three.js appears.

## Zombie lab

`webxr-demo/zombie.html` (`src/zombie-lab.js`): four zombies behind a barricade, crates as obstacles, gunshots heard by
the AI, a death and restart flow (`#death`, `#restart`; the VR trigger also restarts), and a damage vignette. The lab
exposes `window.__lab` (`ai`, `navmesh`, `zombies`, `player`, `shootRegion`, `aiStats`, `restart`, `toggleDebug`) for
the smoke test.

## Nightfall: guard brain behind `?ai=squad`

The Nightfall WebXR game keeps `enemy_logic.js` as the default. `?ai=squad` swaps in the squad brain:

- `parseAIMode(location.search)` returns `'squad'` only for `ai=squad`.
- `createEnemies({ ..., ai })` creates `createSquadLogic(world, world.enemySpawns)`. Each guard's logic object keeps the
  fields the renderer reads (`position`, `yaw`, `state`, `aimPoint`, `attentionPoint`, `moving`, `recoil`, `ammo`,
  `reloadTime`, `killed`, `health`, `id`, `lastSeenPosition`).
- The navigation grid is baked from `world.staticBoxes()`. Sight and cover rays use `world.lineOfSight`.
- Shots come out in the classic shape, so the posed-muzzle resolution is the same.
- Damage is `ai.hit` with the zone multiplier applied first, the same as the classic path.

The generated copy in `NightfallContractsWebXR-interaction/src/extensions/ai/` comes from `tools/sync_extensions.mjs`.

## Tests

| Suite | Count | What it covers |
| --- | --- | --- |
| `webxr-demo/tests/ai-perception.test.js` | 8 | Cone, occlusion, suspicion, hearing, sense radius, time-sliced rays |
| `webxr-demo/tests/ai-nav.test.js` | 5 | Grid paths, corners, low and high boxes, re-bake, movement around walls |
| `webxr-demo/tests/ai-zombie.test.js` | 10 | Roam, investigate, chase, telegraph, attack, shove cancel, horde slots and escape lane, personal space, gore hand-off, physical states, determinism |
| `webxr-demo/tests/ai-guard.test.js` | 9 | State machine, hearing, squad discipline, flanker, cover, hit zones, physical states, difficulty, determinism |
| `scripts/ai-smoke.mjs` (`npm run test:ai:browser`) | 9 checks | Headless browser: roam, gunshot, path around the barricade, telegraph and attack, legless crawl, death and restart, ray budget |
| Nightfall `tests/squad-logic.test.mjs` | 8 | The `?ai=squad` switch, squad logic fields, shots, seed, hearing, damage and reset |

Screenshots from the smoke test are in `webxr-demo/test-results/ai/`.

## Known gaps

- Physical states are an input only. Nightfall does not feed physical states yet; only the GameSystems lab does (hitreact).
- The grid is 2D (floor plan). Multi-level floors need a navmesh with the same interface.
- Quest performance is not measured. The code avoids per-frame allocation in hot loops and slices its rays, but the
  budget is a later task.
