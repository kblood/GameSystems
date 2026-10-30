# Flammekaster og brandgrafik — `extensions/flamethrower` og `extensions/fire-fx`

2026-10-26. To nye, selvstændige extensions til Three.js/WebXR. Zombiespillet importerer dem; denne runde rører
ikke spillets side, `zombie.html` eller den eksisterende brandsimulation (`extensions/thermal/fire.js`).

Opdatering 2026-10-29: zombiespillet er flyttet ud af GameSystems til sit eget projekt, `ZombieGame`
(`../../ZombieGame`, dokumentation i [../../ZombieGame/docs/zombie_game.md](../../ZombieGame/docs/zombie_game.md)).
Det kopierer `flamethrower` og `fire-fx` ind med sin egen `tools/sync.mjs` og ændrer dem ikke. `webxr-demo/zombie.html`
i GameSystems er zombielabbet (`src/zombie-lab.js`), ikke spillet, og bruger ingen af de to extensions.

- **flamethrower** er våbnet: tank, aftrækker, vågeblus/tænding og dysekegle. Hvert frame giver det en flammekegle
  `{ origin, direction, length, radius, dt, active }`. Spillet bestemmer selv skade og antændelse ud fra keglen;
  våbnet påvirker ikke verden.
- **fire-fx** er kun grafik: flammer, gløder/gnister/flammepust, en fælles pulje af punktlys og brandmærker
  (scorch decals). Det simulerer ikke brand. Thermal ejer brandudfaldet, og spillet afbilder sine brændende objekter
  på `addFlame/moveFlame/removeFlame`.

Begge mapper importerer ikke three.js. `THREE` gives som parameter, og begge står derfor i `PURE` i
`webxr-demo/tests/extension-boundaries.test.js` (DEPS: `[]`, ingen PACKAGES). Flammekasteren kender ikke fire-fx
som modul; den får en fire-fx-instans som `fx`.

## Flammekaster

### API

```js
import { createFlamethrower, coneExposure } from '.../extensions/flamethrower/index.js';

const ft = createFlamethrower({ THREE, scene, fx, tank: 6000, range: 5, spreadDeg: 16, flowMlPerSecond: 150,
  backfire: false, model: gltf.scene /* valgfri */, parent: controllerGrip /* valgfri */, onEvent: (type, detail) => {} });
// => { object, mountPoint, nozzle, core, setTrigger(on), refuel(ml), update(dt, aim), flameCone(), state(),
//      douse(), relight(), dispose() }
```

| Option | Betydning |
|---|---|
| `THREE` | three.js-navnerummet (påkrævet) |
| `scene` / `parent` | hvor `object` tilføjes; `parent` (fx en controller-grip) vinder over `scene` |
| `fx` | en `createFireFX`-instans; `null` giver kun model og vågeblusglød |
| `tank` | kapacitet i ml, eller `{ capacityMl, fuelMl }` |
| `range`, `spreadDeg`, `flowMlPerSecond` | genveje til `nozzle.*` i config |
| `backfire` | slår tilbageslag ved tom tank til (standard fra) |
| `model` | GLB-scene i stedet for den procedurale model |
| `config` | et helt config-lag (se tunables); genvejene ovenfor vinder |
| `seed` | frø for sputter- og tilbageslagsterninger (deterministisk) |
| `onEvent` | `'ignite' \| 'extinguish' \| 'empty' \| 'dry-fire' \| 'refuel' \| 'pilot-lit' \| 'pilot-out' \| 'backfire'` |
| `id` | præfiks for fire-fx-flamme-id'er (standard `flamethrower<n>`) |

- `update(dt, aim?)`: `aim = { origin, direction }` i verdenskoordinater (arrays eller `Vector3`). Uden `aim` skydes
  langs dysens lokale −Z. Returnerer keglen.
- `flameCone()`: samme kegleobjekt hvert frame (ingen allokering): `{ origin:[3], direction:[3] (enhed), length, radius
  (ved enden), baseRadius (ved dysen), dt, active, intensity (0..1) }`. Kopiér det, hvis det skal gemmes.
- `refuel(ml)` returnerer de ml, der faktisk kom i tanken; resten bliver hos kalderen (dunken).
  `createCanister(ml)` og `tank.transferFrom(canister)` findes også.
- `state()` er et nyt snapshot til HUD og gemning: brændstof, vågeblus, `firing`, `spraying` (ventil åben uden
  flamme), `sputtering`, `pressure`, keglens mål, tilbageslag og totaler (`burnedMl`, `unlitMl`, `drainedMl`, ...).
- `douse()` slukker vågeblusset (vand); det tænder igen efter `pilot.relightSeconds`. `relight()` springer ventetiden over.
- Hjælpere til spillets træfprøve: `coneExposure(cone, p)` (0..intensity, falder til 0,5 mod enden og mod kanten),
  `pointInCone`, `coneBounds` (omsluttende kugle til broad phase), `coneRadiusAt`.

Spillet anvender skade og antændelse, fx:

```js
const cone = ft.update(dt);
if (cone.active) for (const z of zombiesNear(coneBounds(cone))) {
  const e = coneExposure(cone, z.position);
  if (e > 0) { z.damage(e * DPS * cone.dt); thermal.addHeat(z.thermalId, e * HEAT_W * cone.dt); }
}
```

### Regler pr. frame

- Ventil åben = aftrækker holdt og brændstof i tanken. Tanken tømmes med `flowMlPerSecond`.
- Flammen brænder, når ventilen har været åben i `igniteDelay` og vågeblusset er tændt. Brændstof før tænding
  (og alt brændstof uden vågeblus) bogføres som `unlitMl`; spillet kan lave en pyt af det.
- Under `sputter.belowMl` falder trykket mod `minPressure` med seeded sputter; flammen bliver kortere.
- Længden går mod `range × tryk` på `rampSeconds` og falder til 0 på `fadeSeconds` efter slip. Keglen er aktiv,
  så længe halen er længere end `minLength`.
- Tilbageslag (opt-in): aftrækker holdt, vågeblus tændt og tom (eller sputtende) tank giver en seeded terning.
  Ved træf sendes `'backfire'` med `{ origin, radius }`; spillet skader spilleren. Vågeblusset slukkes, og
  `cooldownSeconds` begrænser hyppigheden.

### Tunables (`DEFAULT_FLAMETHROWER_CONFIG`)

| Sektion | Felter (standard) |
|---|---|
| `tank` | `capacityMl` 6000, `startMl` null (= fuld) |
| `nozzle` | `range` 5 m, `spreadDeg` 16, `flowMlPerSecond` 150, `baseRadius` 0,03 m, `rampSeconds` 0,3, `fadeSeconds` 0,2, `minLength` 0,15 m |
| `pilot` | `enabled` true, `startLit` true, `igniteDelay` 0,08 s, `relightSeconds` 1,2 s |
| `sputter` | `belowMl` 300, `minPressure` 0,25 |
| `backfire` | `enabled` false, `chancePerSecond` 0,5, `radius` 0,9 m, `cooldownSeconds` 2 |
| `visual` | `sparksPerSecond` 90 (flammepust til fire-fx), `pilotSize` 0,035 m |

`resolveFlamethrowerConfig(...lag)` fletter lag og kaster én `TypeError`, som navngiver alle fejl.
Med standarderne varer en fuld tank 40 sekunders skydning.

### Model

- Våbnet peger langs lokal −Z. `object` er roden, som spillet sætter på hånden. Den procedurale model har grebet i
  origo (7 meshes, ca. 0,75 m: greb, krop, tank, forgreb, løb, dyse, vågeblus). `mountPoint` er en markør ved grebet.
- GLB: noder findes på navn (versalufølsomt). Dyse `/nozzle|muzzle|tip|barrel_end/`, greb `/grip|mount|handle/`,
  vågeblus `/pilot/` (vises kun, når den er tændt). Mangler dysen, placeres den midt på bounding boxens −Z-flade.
  GLB-objektet klones og disposes ikke; det tilhører kalderen. Blender-agenten bør navngive en `Nozzle`- og en
  `Grip`-node, med −Z som skudretning.
- Med `fx` vises vågeblusset som en lille fire-fx-flamme. Strålen er flammepust (`spark(..., { kind: 'puff' })`),
  som flyver keglens længde og spredes med keglens vinkel.

## Brandgrafik (fire-fx)

### API

```js
import { createFireFX } from '.../extensions/fire-fx/index.js';
const fx = createFireFX({ THREE, scene, camera, quality: 'high', budget: { particles: 2000, lights: 4, flames: 96, scorches: 64 } });
// => { addFlame({ id, position, normal, size, intensity }), moveFlame(id, position, size?, intensity?), removeFlame(id),
//      spark(position, direction, count, opts?), scorch(position, normal, radius), setQuality(tier), update(dt, time),
//      stats(), dispose(), objects, quality }
```

- `addFlame` returnerer `false`, når `budget.flames` flammer allerede findes (hårdt loft); et kendt id opdateres.
  `size` er bredden i m (højden er 1,6 × size). Flammen stiger altid langs verdens op-akse; `normal` skubber kun basen.
- `moveFlame` allokerer ikke; `size` og `intensity` er valgfrie (tilføjet ud over den bestilte signatur).
- `spark(position, direction, count, opts?)`: `opts = { kind: 'spark' | 'ember' | 'puff', speed, spread, life, size }`.
  Genbrug ét opts-objekt pr. kalder. `count` skaleres med tierens `sparkScale` og loftes ved 64 pr. kald.
- `scorch` stempler et brandmærke på fladen; de ældste erstattes, når tierens loft er nået.
- `update(dt, time)`: frustum-tjek på flammernes omsluttende kugler, lysvalg, gløder fra synlige flammer,
  partikeltrin og upload. `time` er valgfri (ellers summeres dt).
- `camera`: i XR gives den kamera, som rendereren opdaterer. Én frustum bruges til begge øjne med margin
  (`cullMargin` 1,25 + 0,05 m).
- Tiers: `'low' | 'medium' | 'high'`; host-navnene `'minimal'` og `'mid'` accepteres som `low`/`medium`.

### Indhold

- **Flammeshader** (ShaderMaterial, additiv): cylindrisk billboard, fbm-værdistøj, der ruller opad (opadgående
  turbulens), sidelæns tunger, dråbeform, farverampe mørkerød kant → orange → hvidgul kerne, flimmer og blød
  kantfade. Flammer uden rigtigt lys får en blød glorie i shaderen (falsk lys).
- **Partikler**: én InstancedMesh med fast kapacitet og typed arrays (struct of arrays). En ring genbruger det ældste
  slot, når puljen er fuld. Tre slags: glød (opdrift), gnist (tyngde) og flammepust (vokser, høj drag).
- **Lyspulje**: højst 4 PointLights, oprettet én gang. De klareste/nærmeste synlige flammer får dem
  (`intensity × size / (1 + afstand²)`). Ubrugte lys får intensitet 0 i stedet for at blive skjult, så antallet af lys
  og dermed de oplyste shaders ikke skifter fra frame til frame. Kun `setQuality` ændrer synligheden (én recompile).
- **Brandmærker**: én InstancedMesh af quads på fladen med en procedural, brændt ringshader (ingen canvas), afgrænset ring.

### Budgetter

Alt allokeres ved oprettelse i budgettets størrelse (standard = high, aldrig over `FIRE_FX_LIMITS`). En tier sænker
kun det levende/tegnede antal inden for allokeringen; `setQuality` allokerer aldrig.

| Tier | Partikler | Lys | Tegnede flammer | Brandmærker | Oktaver | Gløder/s pr. flamme (1 m) | Gnistandel |
|---|---|---|---|---|---|---|---|
| low | 400 | 1 | 24 | 16 | 2 | 6 | 0,35 |
| medium | 1000 | 2 | 48 | 32 | 3 | 12 | 0,6 |
| high | 2000 | 4 | 96 | 64 | 4 | 20 | 1 |
| hårde lofter | 2000 | 4 | 128 (registrerede) | 128 | — | — | 64 gnister pr. kald |

**Draw calls:** højst 3 pr. view (flammer, partikler, brandmærker), uanset antal; stereo-XR uden multiview fordobler
det. Lys giver ingen draw calls, men koster pr. fragment i alle oplyste materialer. Målet for Quest 3 er højst 200 draw
calls og 2000 levende partikler på high; fire-fx bruger 3 og 2000. `stats()` giver `drawCalls`, `instances`
(flammer/partikler/brandmærker/total), `flames`, `particles` (live/limit/capacity/spawned/recycled/dropped),
`lights`, `scorches` og `budget`.

Lokal node-måling (ikke headset): 40 flammer, en skydende flammekaster og 10 gnister pr. frame gav ca. 0,05 ms CPU pr.
frame for begge systemer tilsammen, omkring 920 levende partikler og 2 draw calls. Heapen voksede ca. 20 bytes pr. frame,
sandsynligvis V8's boxing af tal i closures, ikke objekter eller arrays.

## Rent vs. three

| Fil | Indhold | three |
|---|---|---|
| `flamethrower/config.js, tank.js, trigger.js, pilot.js, nozzle.js, weapon.js` | tunables, tank/dunk, aftrækker, vågeblus, kegle og træfhjælpere, tilstandsmaskine | nej |
| `flamethrower/three-layer.js`, `createFlamethrower` i `index.js` | procedural model, GLB-adoption, dysesigte, fire-fx-kobling | `THREE` som parameter |
| `fire-fx/quality.js, pool.js, flames.js, shaders.js` | tiers og budgetter, partikelring, flammeregister, lysvalg, brandmærkering, GLSL-strenge | nej |
| `fire-fx/three-layer.js` | `createFireFX` | `THREE` som parameter |

## Test

- `webxr-demo/tests/flamethrower.test.js` (12): config, tank og dunk, aftrækker, vågeblus, keglegeometri og eksponering,
  tømning, ramp og fade, sputter, tom tank og dry-fire, tænding uden vågeblus, seeded tilbageslag, samt three-laget
  med rigtig three.js i node: procedural model, GLB-noder, sigte fra dysen og fire-fx-kobling.
- `webxr-demo/tests/fire-fx.test.js` (10): tiers og aliaser, budgetlofter, puljegenbrug, flammeregister, lysvalg,
  brandmærkering, og `createFireFX` i node: instans- og draw-call-tal, frustum-tjek, lysloft, lofter under spam,
  ingen genallokering, `setQuality` og dispose.
- `extension-boundaries.test.js`: begge mapper er i DEPS og PURE.

## Kendte huller

- Shaderne er ikke kompileret på en rigtig GPU. Ingen side i GameSystems bruger fire-fx, og her findes ingen headless
  browser-smoke (`scripts/fire-fx-smoke.mjs` er ikke skrevet). ZombieGame's smoke (`scripts/zombie-game-smoke.mjs`)
  kører spillet med flammekaster og fire-fx i headless Chrome med SwiftShader (software-WebGL) uden sidefejl; det er
  den eneste GLSL-kompilering indtil nu.
- Spillet bruger flammekasteren med egne værdier: tank 4000 ml, rækkevidde 5 m, spredning 18°, 120 ml/s
  (`ZombieGame/src/zombie-game/flamer.js` `FLAME`). Det fletter GLB'en pr. materiale før `createFlamethrower` og
  holder den første `/pilot/`-node ude af fletningen, så vågeblus-noden stadig kan vises og skjules.
- fire-fx har ingen måde at rydde brandmærker og partikler på; i spillet overlever de en genstart (ZombieGame T39,
  `clear()` er foreslået, ikke godkendt).
- Intet er målt på Quest 3. Draw calls og partikeltal er talt, ikke GPU-tid, fill rate eller overdraw. Additive
  flammer og pust tæt på kameraet kan blive fill-rate-dyre; sænk tier eller `sparksPerSecond`, hvis det sker.
- Flammerne er lodrette billboards. En vandret flammestråle laves af pust-partikler, ikke af en egentlig
  stråle-mesh. Flammerne roterer kun om op-aksen, så de ser tynde ud set lige oppefra.
- Frustum-tjekket bruger ét kamera; i XR dækker marginen begge øjne, men en flamme helt ude i kanten af ét øje kan
  blive tegnet unødigt eller, ved meget små flammer, skåret fra.
- Brandmærker følger ikke bevægelige overflader og har ingen dybdeprojektion; de er flade quads med polygon offset.
- Vågeblusset er ikke koblet til vand eller thermal: spillet kalder selv `douse()`. Fuel uden flamme (`unlitMl`)
  bliver ikke automatisk til en pyt.
- Flammekasteren har ingen setter for brændstof (kun `refuel`), så spillets checkpoint kan hæve, men ikke sænke det
  (ZombieGame T41, `setFuel(ml)` er foreslået, ikke godkendt).
- `webxr-demo/scripts/sync-helpers.mjs` har nu `'flamethrower'` og `'fire-fx'` på `EXTENSIONS`-listen.
