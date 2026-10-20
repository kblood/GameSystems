# Gore system (extensions/gore)

Shoot-apart zombies in the spirit of House of the Dead for any character that implements the humanoid character
contract (`extensions/humanoid/contract.js`). Built and tested on MakeHuman / CharacterCreator characters
(`character-cc`). Demo: `webxr-demo/zombie.html` (Zombielab).

The mesh splitting happens **offline**. `tools/bake_gibs.mjs` splits the body, garments and hair of a topology along
authored seams into region pieces with closed, skinned stump caps, and writes one compact data file pair. At runtime,
severing a region only changes draw ranges (geometry groups), shows the stump cap and spawns the pre-made gib with a
physics body. No triangles are cut, no vertices are created.

## Usage

```js
import { createGoreWorld, loadGibs, tearCloth } from './vendor/extensions/gore/index.js';

const world = createGoreWorld({
  THREE, scene,
  physics: physicsAdapter,          // host physics adapter (addBody/pose/remove), e.g. adapters/physics-cannon.js
  gibs: await loadGibs(),           // the bundled MakeHuman / CharacterCreator bake
  config: { goreLevel: 'high' },    // global layer
  floorY: 0,
  walls: [{ normal: [0, 0, 1], d: 9.9 }],  // optional planes for wall splats: n·p + d = 0
});

const zombie = world.attach(character, {
  config: { regions: { head: { health: 80 } } },  // per-character layer
  uncover: true,                                  // show the skin CharacterCreator hides under (torn) clothes
});

// each frame, after posing the characters
world.update(dt);

// mouse / controller ray
const hit = world.shoot(origin, direction, { damage: 30 });
// hit: { zombie, region, point, normal, events: [{ type: 'damage' | 'sever' | 'death', ... }] } or null
```

**World API**

- `attach`, `shoot`, `update`
- `raycast(origin, dir)`: a hit test without damage
- `setConfig(globalLayer)`
- `on(cb)`: event stream
- `stats()`: zombies, gibs, draw calls, `lastSeverMs`, `severMs` (mean), `severs`, effects
- `effects`: the blood, decal and chunk pools
- `dispose()`

**Zombie API**

- Queries: `lost(id)`, `lostRegions()`, `mobility()` ('walk' | 'limp' | 'crawl' | 'none'), `speedFactor()`, `dead`, `regionCenter(id)`
- Actions: `hit({ region, damage, point, normal, direction })`, `sever(id, { force, direction })`, `kill()`, `reset()`
- `setConfig(layer)`, `drawCalls()`, `stats()`, `attachMs`, `baked`
- `dispose()`: gives the character back with its original geometry and materials

**Host extension:** `goreExtension(options)` has id `'gore'`, and its quality tiers are the gore levels.

The pure modules (`regions`, `config`, `damage`, `seams`, `bake_format`, `assemble`, `insides`) do not use three.js. The
extension only depends on `humanoid` and `host`, and never imports avatar, grasp or a character system. These rules are
enforced by `tests/extension-boundaries.test.js` and `tests/gore-runtime.test.js`.

## Regions

```
pelvis (root, cannot come off)
├─ chest (vital, waist cut)
│  ├─ neck (vital)
│  │  └─ head (vital)
│  │     ├─ jaw     (patch)
│  │     └─ cranium (patch, vital)
│  ├─ left/rightUpperArm → LowerArm → Hand
│  └─ chestLeft / chestRight (patches)
├─ left/rightUpperLeg → LowerLeg → Foot
└─ belly (patch)
```

**Limb seams** follow the skin weights: the cut lies where the region subtree's weight crosses 0.5, with an optional saw
pattern. They work on any rig weighted like MakeHuman.

**Patches** are ellipsoids on the skin, placed from the rest joints. The body keeps a hole with a flesh rim, through
which the procedural insides show. The gib has a closed back.

**Chained loss:** severing a region takes its whole subtree, so an upper arm takes the forearm and hand with it.

**Death** comes from:
- losing a vital region
- the head or cranium health reaching 0
- the summed damage reaching `totalHealth`

A dead zombie can still be shot apart.

**Mobility** is a pure query; the demo uses it to slow zombies down and to make them crawl:
- a foot gone: limp
- a leg gone at the knee or above: crawl

## Config reference

Configs are layered: defaults, then global (`createGoreWorld`/`setConfig`), then zombie type, then per character
(`attach({config})`/`zombie.setConfig`). Later layers win. `regions: { '*': {...} }` changes every region at once.
Invalid values throw a `TypeError` that lists every problem.

| Key | Default | Meaning |
|---|---|---|
| `goreLevel` | `'high'` | `off`: nothing comes off, no blood or insides, zombies still die. `low`: limbs, head and caps, 35 % blood, no insides, at most 8 gibs, 6 s gib lifetime, 16 decals, 3 wounds per zombie. `high`: everything. |
| `totalHealth` | 260 | Dies when the summed (scaled) damage reaches this. |
| `regions.<id>.health` | 20 to 140 | Hit points. Hands/feet 20, jaw 20, cranium 30, patches 35, neck 35, arms 40–45, head 45, upper legs 60, chest 140. |
| `regions.<id>.severable` | true (pelvis false) | false: the region is wounded but never comes off. |
| `regions.<id>.severAt` | 0 | Comes off when health ≤ severAt × health (0 = when used up). |
| `regions.<id>.damageScale` | 1 (head/cranium 2, neck/jaw 1.5, patches 0.9, chest 0.8) | Damage multiplier. |
| `regions.<id>.variant` | `'jagged'` (neck `'clean'`) | Baked seam variant: `clean` or `jagged`. Applied at attach; re-attach to change it. |
| `blood.color` | `#6b0a0a` | Spray, splats, cap and insides blood tint. |
| `blood.amount` | 1 | 0..2: scales particles and splats. |
| `blood.spurtSeconds` | 1.6 | A fresh stump keeps spurting for this long. |
| `insides.bones` / `organs` / `flesh` | true | Layers of the procedural insides: bone stubs, ribs, skull; lungs, heart, liver, guts, brain; cavity lining and spill. |
| `gibs.lifetime` | 14 s | Gibs fade out after this. |
| `gibs.max` | 24 | Gibs alive at once; the oldest go first. |
| `gibs.physics` | true | false: gibs fall with simple gravity, without a physics body. |
| `decals.max` | 64 | Floor and wall splats alive at once. |
| `decals.wounds` | 10 | Bullet wounds per zombie, following the bone. |
| `decals.floor` / `walls` | true | Where splats land. |
| `particles.max` | 600 | Blood spray pool, shared by all zombies. |
| `performance.freezeMorphs` | true | Bakes the slider morphs into the vertices at attach. This drops roughly 43 MB of morph texture per zombie, so it is cheap on Quest, but sliders cannot change afterwards. |
| `performance.meshHitTest` | true | Hits are tested against the skinned triangles. false: proxies only. |

Example: a tough type whose arms never come off, with clean cuts and green blood.

```js
world.attach(character, { config: {
  totalHealth: 500,
  blood: { color: '#2f6b0a' },
  regions: {
    '*': { variant: 'clean' },
    leftUpperArm: { severable: false },
    rightUpperArm: { severable: false },
  },
} });
```

## The bake (rebuild instructions)

```
node extensions/gore/tools/bake_gibs.mjs            # writes extensions/gore/data/makehuman_cc.gibs.{json,bin}
node extensions/gore/tools/bake_gibs.mjs --check    # bakes in memory, exit 1 when the committed data is stale
npm run sync   (in webxr-demo)                      # copies the extension and its data into src/vendor
```

**Defaults**
- `--assets webxr-demo/public/avatar-assets`: the synced CharacterCreator output, with `base_body.glb`, `base_body.joints.json`, every `clothing_*.glb` and `hair_*.glb`.
- `--out extensions/gore/data`
- `--name makehuman_cc`

**When to re-run:** after changing `seams.js` or `regions.js`, or when the CharacterCreator assets change topology.

**Topology matching:** at attach, every mesh is matched by vertex count and a position fingerprint. If the data no
longer matches, the runtime falls back to unsplit severing: bones collapse and a capsule gib is spawned.

**What it stores, per mesh:**
- the full source index
- the piece triangle list, with the source triangle of each piece triangle
- the pieces: region, core or seam-band side, variant
- stump caps: body side and gib side, per seam and variant
- new vertices as recipes: weighted sums of source vertices, plus a cap uv

Skin weights, normals, uvs and all 92 morph targets of a new vertex come from the same recipe, so one bake covers every
slider setting. The caps share their rim recipes with the cut, so they stay closed under any morph.

**Also stored:**
- the rest joints
- physics proxies: capsule/sphere sizes as ratios, which are re-fitted to the character at attach
- body measures used to fit the procedural insides

**Size and timing:** 13 meshes, about 70 KB JSON and 1.9 MB binary, baked in about 1.5 s. The output is deterministic,
and `tests/gore-bake.test.js` checks it against the committed files.

**Bake steps:**
1. Weld vertices by position.
2. Compute region weights from the skin.
3. Compute one signed field per seam and variant, removing small islands from jagged limb fields.
4. Assign each triangle to a region by descending the region tree.
5. Cut seam-band triangles per variant.
6. Trace the cut loops.
7. Build caps: rim, inner ring and centre. The gib side is reversed, and a patch's body side is a flesh rim.
8. Measure proxies and the body.

Face parts (eyes, brows, teeth, tongue) snap whole triangles to a side. The teeth and tongue split at the bite plane for
the jaw.

## Runtime cost

These numbers come from the node fixture and the headless smoke on the 3-zombie lab with software WebGL.

**Per zombie**
- Attach: about 40–90 ms, once per zombie. This builds the extended geometry and the insides, and freezes morphs.
- Sever: about 1–2 ms. This switches groups, builds the gib from shared attributes and adds a physics body.
- Draw calls: 12–13 while intact, about one per mesh. Each severed region adds one gib (about 1–2 calls per gib mesh), and stump caps add one call per mesh that has a visible cap.
- Typical counts in the smoke: 8–19 calls per damaged zombie.

**Shared by all zombies:** effects use 4 draw calls in total (particles, splats, wounds, chunks).

## Limitations and open points

- **Outfits:** changing a zombie's outfit or hair after `attach` is not supported. Call `zombie.dispose()`, change it, then attach again.
- **Morphs:** with `freezeMorphs` (the default), sliders are fixed at attach.
- **Jaw:** the jaw cut runs through the open mouth, so its gib keeps a few small open loop fragments. They are not visible in play and are documented in the bake output.
- **Clothing conflicts:** the shirt and jeans each have 2 triangles where the belly patch and the left upper-leg seam overlap (the first seam wins).
- **Insides:** the insides are stylised, fitted primitives (ellipsoids, tubes) rather than anatomical meshes. Third-party CC0 meshes could replace them per part; record any you add in `LICENSE-NOTES.md`.
- **Crawling:** the crawl is a stretch goal. The demo pitches the whole body to the floor; there is no arm-pull animation.
- **Other topologies:** a VRM or other non-MakeHuman character needs its own bake. Write a seam table if its regions differ. Unbaked characters still work with bone-collapse severing.
