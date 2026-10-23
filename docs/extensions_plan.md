# Plan: fælles extensions for flasker, greb, avatar og karakterer

Status (2026-10-10): **trin 1, 2, 3, 5 og 8 færdige**; **trin 4: kode færdig, afventer headset-test** (se "Status pr. trin" nederst); trin 6: kode færdig, demo skifter med `?character=vrm`, men grebene består ikke validatoren på VRM-testmodellen (se trin 6); **trin 7: kode færdig, afventer headset-test** (se trin 7); **trin 9: kode færdig, afventer headset-test** (Contracts kører `bottles` på sin egen physics-adapter; se trin 9).
Relateret: [grab_findings.md](grab_findings.md) — 27 verificerede fejl/forbedringer i det nuværende grebssystem (sektion "Gør nu" skal med i trin 1–3).

## Mål

1. Flaskesystemet, grebssystemet, avatar-systemet og karaktersystemet bliver hver sin **extension** (three.js), som både
   `GameSystems/webxr-demo` og `NightfallContractsWebXR-interaction` (Contracts) bruger — samme kode, ét sted.
2. Avatar-systemet virker med **enhver humanoid karakter** med standard humanoid-knogler inkl. fingre (CharacterCreator,
   VRM, Mixamo, …). Karakteren er sin egen extension.
3. Greb tilpasser sig karakterens hånd automatisk (**lukning-til-kontakt**), så der ikke skal refittes pr. karakter.
4. En **Grasp Studio**-app til Quest 3 hand tracking, hvor greb, hånd-poser og hånd-animationer optages manuelt.
5. Billige systemer med **kvalitetsniveauer** der kan skiftes (brugerens generelle krav).

## Nuværende tilstand (fakta at bygge på)

| Del | Hvor | Bemærkning |
|---|---|---|
| Flaskesystem (three) | `GameSystems/webxr-demo/src/{factory,breakage,pour,damage,audio,surfaces,physics}.js` + `GameSystems/shaders/three`, `designs/three` (siden trin 8: `extensions/bottles`) | Bundet til cannon-es (fx `factory.js:99` tjekker `CANNON.Body.KINEMATIC`) — løst i trin 8. Godot-versionen (`gameplay/godot`) er uden for denne plan. |
| Grebssystem | Contracts `src/interaction/` | `baked_grasps.js` + `.data.json`, `grasp_validator.js`, `catalog.js` (form + signed distance), `physics.js` (egen solver ~400 linjer, tunet til Jolt-værdier), `held_drive.js`, `throw_release.js`, `grab.js`, `props.js`. Eneste eksterne afhængighed: `handFromGrip/gripFromHand` fra pluginet. |
| Avatar + karakter | Contracts `packages/character-plugin` (`@nightfall/character-plugin`, fork af CharacterCreatorXR, MIT) | VRIK m.m. i `src/ik/*`; CharacterCreator-specifikt i `src/avatar.js`, `clothing.js`, `materials.js`; synket fra `../CharacterCreator` til `vendor/cc` + `assets` (genererede filer, rediger ikke). |
| Standardskelet | `character-plugin/vendor/cc/animation/canonical.js`, `humanoid.js`, `qmath.js` | VRM 1.0 humanoid-navne inkl. 30 fingerled. `createHumanoid(mesh, { map })` binder en vilkårlig rig via navnetabel (i dag `MPFB_GAME_ENGINE`); manglende led foldes ind i nærmeste. Poser er parent-relative deltaer i karakterrammen (+X venstre, +Y op, +Z frem). |
| Fingre | `character-plugin/src/ik/fingers.js`, `rigdata.js` | Finger state `{yaw, dyaw, pitch, bend1, bend2}`: pitch/bend er **absolutte** vinkler i en håndramme beregnet af knoglepositioner (`chainAngles`, `handFrame`) → hvilekrumning er allerede håndteret. Kun yaw/spredning er relativ til hvile. Tommelens akse er en fast antagelse (`THUMB_AXIS.tilt` 60°). `fingerStateFromJoints` (XR-håndled → rækker), `syntheticJoints` (rækker → fingerspids-positioner), `limitFingerState`, One Euro i `filters.js`. |
| Demoens avatar | `webxr-demo/src/avatar.js` + `interaction.js`, `main.js` | Vendor-kopi via `scripts/sync-helpers.mjs` til `src/vendor/contracts` + `public/avatar-assets` (gitignored; `predev`/`pretest`/`build` kører sync). |
| Grebs-lab | Contracts `tools/lab/*`, `tools/fit_baked_thumbs.mjs`, `tools/apply_grasp_fit.mjs` | Puppeteer + SwiftShader, CPU-skinnede vertices mod SDF. Fitteren læser `build/scratch/baked_before.json` (ikke i git). |

Validering i dag: Contracts `npm test` (283), `npm run test:hands`, `npm run test:browser`; demo `npm test` (13), `npm run build`.

## Arkitektur

```
GameSystems/extensions/
  host/            extension-kontrakt, event-bus, kvalitetsniveauer, physics-adapter-interface
  humanoid/        standardskelet: canonical.js, qmath.js, humanoid.js, bone-maps (mpfb, vrm, mixamo), skelet-tjek
  character-cc/    CharacterCreator-karakter (krop, tøj, hår, cloth, øjne, morphs, assets-sync)
  character-vrm/   VRM-karakter via three-vrm (bevis for at kontrakten er generisk)
  avatar/          VRIK, kalibrering, gang, førsteperson, fingermapping, hånd-poser og hånd-animationer
  grasp/           bagte greb + data, validator, lukning-til-kontakt, held-drive, kast, item-katalog (SDF)
  bottles/         flaskefabrik, væske, hældning, brud, lyd (three)
  adapters/        physics-cannon.js (demo), Contracts' adapter ligger i Contracts
apps/grasp-studio/ Quest 3-optager (bruger humanoid, avatar, character-*, grasp)
```

Afhængigheder (kun via public API): `avatar → humanoid + én character-*`, `grasp → (avatar valgfri, kun til håndposering)`,
`bottles → host.physics`. Ingen extension importerer en andens interne filer.

Distribution: som i dag med `shaders/three` — hvert spil har en sync-script der kopierer extensions ind, så hvert spil
stadig kan bygges alene. Kilden til sandhed er GameSystems.

### Extension-kontrakt (host)

```js
extension = { id, requires: ['grasp'], quality: ['off', 'low', 'high'], init(ctx), update(dt), dispose() }

ctx = {
  THREE, scene, renderer, camera, quality, assetURL(path),
  physics: { addBody(shape, mass, pose), pose(b), hold(b, target), release(b, vel, spin), onContact(cb), remove(b) },
  emit(event, data), on(event, cb),          // grab, release, broken, xrStart, xrEnd, disconnect, handTrackingChanged
  get(extensionId),                          // public API af en anden extension
}
```

Kerne-spillet sender events; extensions reagerer. Det løser i sig selv grab_findings 1.1 (`broken` → slip hånd),
1.2 (`disconnect` → slip flaske) og 1.7 (demoen kører uden avatar når den mangler — extensions indlæses med dynamisk `import()`).

### Karakter-kontrakt

Kontrakten er kode: `extensions/humanoid/contract.js` (`validateCharacter`, `assertCharacter`). Den ligger i humanoid, fordi
både avatar og alle providers allerede afhænger af den: en provider kan teste sig selv uden at importere avatar, og
avatar tjekker hver karakter, den får (`createCharacterPlugin` kaster en `TypeError`, der nævner alle mangler).

```js
character = {
  // påkrævet
  root,                                 // Object3D, karakterens ramme (+X venstre, +Y op, +Z frem)
  humanoid,                             // { bones } fra createHumanoid(mesh, { map })
  restHeads(), applyPose(pose), dispose(),
  // valgfrit (typetjekkes kun hvis de findes)
  meshes, headBone, capabilities: { fingers, eyes, cloth, morphs }, quality, bodyShape: { male, bust },
  handProfile, eyeOffset(), resetPose(), onRestChange(cb), setFirstPerson(on), tick(dt, physics, { gaze, frozen }),
  resetSecondary(), setQuality(tier),
}
```

Providers i dag: `character-cc` og `character-vrm`. Tests: `webxr-demo/tests/character-contract.test.js` (kontrakten, VRM,
afvisning i avatar; CC dækkes af browser-smokes) og `webxr-demo/tests/extension-boundaries.test.js` (hver extensions
runtime-importer holder sig til sine erklærede afhængigheder; avatar/grasp importerer aldrig et karaktersystem).

Skelet-tjek ved indlæsning: mangler fingerled → avataren kører med stive "vante"-hænder og advarer; knoer langt fra
forventet håndgeometri (typisk ved auto-rigs) → advarsel. Kvalitet: fuld krop / kun hænder og arme / slået fra.

### Grasp: lukning-til-kontakt

Bagte (eller optagede) greb leverer håndledsplacering i genstandens rum + målform for fingrene. Når der gribes, lukkes
hver finger langs sin form, indtil spidsen/leddene rører genstandens SDF (`catalog.js signedDistance`), med positioner fra
`syntheticJoints` og karakterens `restHeads`. Håndledets afstand skaleres med håndlængde. Resultatet clampes til
led-grænser (validatorens `clampRows`). Kvalitetsniveauer:
- `low`: bagte vinkler direkte (clampet),
- `mid`: lukning-til-kontakt én gang ved greb,
- `high`: kontakt-tjek hver frame (fingre følger når genstanden glider).

Det erstatter hudmarginer (`SKIN_MARGIN`) og refit pr. karakter. Siden trin 10 afhænger lukningen kun af karakterens
**håndprofil** (målt fra meshet, kan overstyres og justeres i runtime), ikke af CC-referencehånden.

### Hånd-poser og -animationer (i `avatar`)

Ét format: frames af `{ t, wrist: {pos, quat}, rows: {Thumb..Little: [dyaw, pitch, bend1, bend2]} }`, relativt til
genstanden (greb) eller hånden/kroppen (gestus). Retargeter til enhver karakter fordi vinklerne er i håndrammen.
- Poser: knytnæve, peg, pinch, thumbs up, afslappet, åben, pistolgreb. Controller-brugere blender mellem dem via
  grip/trigger i stedet for syntetiske kurver (`fingerStateFromCurls`).
- Animationer: greb (åben → tilnærmelse → lukket, erstatter lineær lerp), slip, hældning, gestus.
- Pipeline: One Euro-filter → nøgleramme-reduktion → validator pr. frame.

### Grasp Studio (Quest 3)

- Vælg genstand + side (højre/venstre, krop/hals). Genstanden er **virtuel** (ingen fysisk flaske; fingre ikke skjult).
- Feedback mens man holder: fingerspidser lyser ved kontakt, røde ved gennemtrængning; avatarens hånd vist ved siden af,
  allerede lukket-til-kontakt; tracking-sikkerhed vist.
- Optag: auto-capture når hånden har holdt stille ~1 s med synlig nedtælling (frames midles). Alternativer at teste:
  pinch med den anden hånd; controller i den anden hånd (uvist om Quest-browseren tracker hånd + controller samtidig i WebXR).
- Efter optagelse: validator + score; gem / kassér / markér som standard; automatisk spejling til anden hånd.
- Animationstilstand: start/stop med samme mekanisme, gemmes i animationsformatet.
- Gem direkte i projektet via lille dev-server-endpoint; Quest forbindes med `adb reverse` (localhost = secure context,
  se quest-adb-skill).

## Rækkefølge (hvert trin holder alle tests grønne)

| # | Trin | Indhold | Færdig når |
|---|---|---|---|
| 1 ✅ | Extension-host i demoen | `extensions/host`, cannon-adapter, avatar som dynamisk extension, events; ret grab_findings 1.1, 1.2, 1.6, 1.7, 1.8, 1.9 | demo virker med og uden avatar, også uden Contracts ved siden af; `npm test`/`build` grønne |
| 2 ✅ | `grasp` ud i GameSystems | flyt `baked_grasps`, data, validator, catalog, held_drive, throw_release (+ lab/fit-værktøjer, `baked_before.json` ind i repoet); Contracts synker tilbage; ret 1.3 (standardposer), 1.4 (runtime-clamp), 1.10 | Contracts `npm test` + `test:hands` uændret grønne; demo og Contracts bruger identiske filer |
| 3 ✅ | Lukning-til-kontakt | i `grasp`, med kvalitetsniveauer; tests mod lab-målinger | greb ser ens ud på CC-hånd uden `SKIN_MARGIN`; validator-gates bestået |
| 4 | Grasp Studio v1 | én genstand, auto-capture, score, gem til data | et nyt greb optaget på Quest dukker op i demoen |
| 5 ✅ | Del pluginet op | `humanoid`, `avatar`, `character-cc` — først inde i Contracts, derefter flyt til GameSystems | Contracts `npm test` + `test:hands` + `test:browser` grønne |
| 6 (kode ✅) | `character-vrm` | three-vrm-provider + CC0 testmodel; kør grebs-lab på den | demo kan skifte karakter med `?character=vrm` (grebskriteriet flyttet til trin 10) |
| 7 (kode ✅) | Hånd-poser og -animationer | format, afspilning, controller-blend; studio-animationstilstand | controller-hænder bruger optagede poser |
| 8 ✅ | `bottles` på physics-adapteren | fjern direkte cannon-brug | demo uændret |
| 9 (kode ✅) | Contracts får `bottles` | Contracts' physics-adapter; erstat procedurale flasker; brud/skår flyttes fra Contracts' solver til adapter-events | Contracts-tests grønne; flasker med væske/hældning i spillet |
| 10 (kode ✅) | Håndprofil + profilstyret lukning | håndmål pr. karakter (`avatar/handprofile.js`), justerbar profil, lukning der kun afhænger af profilen, afgrænset søgning pr. kvalitet | flaske/dåse-greb består validatoren på både CC og VRM (Jimmy) |

Trin 2 bør også tage grab_findings 1.5 (held-drive rotation) og 2.x-punkterne med, når filerne alligevel flyttes.

## Status pr. trin

### Trin 1 — færdigt (2026-10-09)

- `extensions/host/`: `host.js` (`createHost`: load via dynamisk `import()`/factory/objekt, `requires`, livscyklus
  loading → ready → disposed/cancelled/failed, fejl i `init`/`update`/listeners logges og fjerner kun den extension,
  `ctx.on`-lyttere fjernes ved dispose), `events.js` (event-bus, `CORE_EVENTS`), `quality.js` (globalt niveau 0–3 →
  extensionens tiers ved oprunding, så niveau 0 = `off`; `setTier(id, tier)` pinner; `off` = ingen `update()`),
  `physics.js` (adapter-interface + `assertPhysicsAdapter`), `index.js` (public API).
- `extensions/adapters/physics-cannon.js`: interfacet på en `CANNON.World` + `step(dt)` (fast trin, afviser negativ/ikke-endelig tid før world-state ændres, nul er no-op, udskudte removals,
  kontakter leveres efter trinnet). Demoens `PhysicsWorld` bruger den til hold/release/remove/step og giver den videre som
  `ctx.physics`. Flaskerne bruger stadig cannon direkte (trin 8).
- Demo: `src/avatar.js` er en extension (`default` = factory, tiers `off/low/high`), indlæst i `main.js` med
  `host.load(() => import('./avatar.js'))`. Kernen sender `grab`, `release`, `broken`, `xrStart`, `xrEnd`, `disconnect`,
  `handTrackingChanged`. `interaction.avatar` er avatarens api, når den er indlæst og ikke `off`; controller-modellerne
  følger det. Contracts-moduler går kun via `src/contracts.js`; et lille vite-plugin bytter den til
  `src/contracts-missing.js`, når de ikke er synket (build + kørsel uden avatar).
- Rettet: grab_findings 1.1, 1.2, 1.6, 1.7, 1.8, 1.9 (markeret i grab_findings.md).
- Distribution valgt: **sync-script som `shaders/three`** — `scripts/sync-helpers.mjs` kopierer `extensions/host` og
  `extensions/adapters` til `webxr-demo/src/vendor/extensions` (gitignored, kun ændrede filer skrives, forældede slettes).
  Grunden: demoen bruger allerede den model, og adapteren importerer `cannon-es`, som kun kan resolves fra demoens
  `node_modules`. Contracts bør gøre det samme i trin 2.
- Tests: demo `npm test` 36 (13 → 36; nye: `host.test.js`, `physics-adapter.test.js`, `interaction-events.test.js`,
  `sync.test.js`, udvidet `avatar-grasp.test.js`). Uden Contracts: 30 bestået, 6 sprunget over. `npm run build` grøn med
  og uden Contracts (prøvet i en kopi uden søskende-repo; avatar-chunk 4 kB stub, demoen kører, ingen 404).
- Afvigelser: (a) avatar-tiers `low`/`high` vælges ved indlæsning; senere skift slår kun til/fra (genskabelse er 2.8).
  (b) Kvalitetsniveau `minimal` slår nu avataren fra (plan 2.1's tier-ide taget med). (c) Allowlisten (1.8) tager også
  standard-undertøjet med (`clothing_briefs.glb`), fordi pluginet altid tilføjer det — fundet manglede det. (d) Den
  valgfri del af 1.1 (`shoot()` springer egen flaske over) er ikke lavet. (e) Contracts er ikke rørt.

### Trin 2 — færdigt (2026-10-09)

- `extensions/grasp/` er kilden til sandhed: `baked_grasps.js` + `.data.json`, `grasp_validator.js`, `catalog.js`,
  `held_drive.js`, `throw_release.js`, nye `math.js` (små vektor/quat-hjælpere), `contact.js` (den generiske del af
  Contracts' `hand_contact`: tolerancer, `kindGeometry`, `contactMetrics`) og `index.js` (public API).
  `tools/`: `fit_baked_thumbs.mjs`, `apply_grasp_fit.mjs`, `lab/` (grebs-lab), `data/baked_before.json` (tracket),
  `scratch/` (fitter-output, gitignored).
- Distribution: demoen mirrorer extensionens top-level-filer (ikke `tools/`) til `src/vendor/extensions/grasp`
  (gitignored) og synker ikke længere `src/interaction` fra Contracts (forældet `vendor/contracts/interaction` slettes).
  Contracts: `npm run sync:extensions` (`tools/sync_extensions.mjs`, kun ændrede filer, `--check`) kopierer til
  `src/extensions/grasp` + `SYNCED.json` (sha256 pr. fil). Kopierne er **committede** (ikke gitignored), så spillet
  kører og tester uden GameSystems ved siden af; `tests/extensions-sync.test.mjs` og demoens `tests/grasp.test.js`
  tjekker at demo, Contracts og GameSystems er byte-identiske. `AGENTS.md` og `LICENSE-NOTES.md` opdateret.
- Kvalitet: `setGraspQuality('raw' | 'clamped')` (default `clamped`); clampede open/closed-rækker og `withSkinMargin`
  memoiseres pr. pose (WeakMap), så runtime-clampen koster intet pr. frame. `CLAMP_EXEMPT = ['mug']`: mug clampes
  ikke før mug-refittet (3.1) — clampet tommel (pitch 100 → 65) sank 27 mm ind i kruset i `test:hands`. Demoens `avatar.js` bruger nu bibliotekets
  `fingerState` i stedet for sin egen clamp-kopi.
- Rettet: grab_findings 1.3, 1.4, 1.5, 1.10, 2.10, 2.11, 2.12 (det meste), 2.13 (markeret i grab_findings.md).
- Held drive (1.5): målhastighed = dt-vægtet gennemsnit af de sidste `HAND_MOTION_SAMPLES = 2` samples,
  `v + ω × (targetCom − grebspunkt)`, `angular = ω`. Desuden fundet og rettet en fejl i `driveAcceleration`: den
  implicitte fjeder manglede `−v·dt`, så kroppen ramte målet én frame for tidligt og overshootede.
- Tests: Contracts `npm test` 283 → 291 (alle grønne); `test:hands` 33/33 PASS før og efter, alle målinger identiske; `test:interaction` 14/14 PASS (ingen baseline taget).
  Demo `npm test` 36 → 41 (ny `grasp.test.js`, `avatar-grasp.test.js` skrevet om til 2.10), `npm run build` grøn.
- Afvigelser: (a) `hand_contact.js` er delt: den generiske del ligger i `extensions/grasp/contact.js`, pistol/magasin-
  geometrien bliver i Contracts. (b) `convert_baked_grasps.mjs` bliver i Contracts (læser Godot-bagningen + Contracts'
  avatar) men skriver som standard til `extensions/grasp/tools/data/baked_before.json` og clamper med 2° slør (1.10).
  (c) 1.5's "< 5 mm overshoot" er fysisk umulig med driveens 90 m/s²-loft (≥ 5,5 mm alene); testen kræver < 30 mm
  (før: 79 mm). (d) Ingen npm-scripts `grasp:fit`/`grasp:apply` (GameSystems har ingen package.json; brug står i
  filhovederne; puppeteer lånes fra Contracts via `CONTRACTS_DIR`). (e) `baked_before.json` er ikke clampet for carton
  (historisk snapshot; apply-værktøjet clamper ikke, data-filen er clampet). (f) 1.4's grab-test kører `fingerState`
  over alle poses i stedet for `present()`. (g) 2.6 (deterministisk familie-refit) og 3.3 er ikke lavet; `--original`
  fra 2.12 heller ikke. (h) Ingen headset-afprøvning. (i) Mug er undtaget fra runtime-clampen (`CLAMP_EXEMPT`), ellers
  fejler `test:hands` mug/left (27 mm indtrængning, opposition 83°); 1.4 er dermed kun aktiv for de øvrige kinds.

### Trin 3 — færdigt (2026-10-09)

- Ny `extensions/grasp/closure.js`: `handGeometry(rest)` / `handFromRig(rig, side, {scale})`, `fingerChain` (FK, port af
  pluginets `fingers.js chainDirs` + `rigdata fingerAxes`; identisk med `syntheticJoints` til ~1e-17), `placeWrist`
  (håndled = bagt + (1 − k)·håndflade-anker, k = håndlængde / `REFERENCE_HAND.length` 0,203 m), `closeToContact`,
  `chainGaps`. Fingermodel: segmenter (midte + ende) mod SDF minus pad-radius (`PAD_RADIUS`, brøk af håndlængde,
  kalibreret i lab'et mod CC-huden). Hver finger starter i den bagte form (t = 1): for dybt (> `squeeze` 1 mm) → åbn langs
  formen til fri; inden for `touch` 2 mm → behold; ellers luk videre (op til t = 1,35, kun wraps) indtil kontakt. Distale
  led lukker videre efter et proksimalt led rører. Tommelens CMC går aldrig forbi bagningen. Clampes med `clampRows`.
- Kvalitet i `baked_grasps.js` (ét system, `runtimeRows` + `GRASP_QUALITY`): `raw | low | mid | high`, default `mid`,
  `'clamped'` er alias for `low`. `graspPose(pose, hand, {shape, local})`: `mid` lukker én gang pr. (hånd, pose, shape)
  (WeakMap-memo, ~0,1–0,3 ms i node); `high` lukker igen mod det viste håndled, når det har flyttet sig > 0,5 mm / 0,5°.
  Uden hånd eller shape: bagningen (= `low`). `SKIN_MARGIN`/`withSkinMargin` er fjernet.
- Injektion (ingen import af plugin-internals): Contracts `main.js` laver `handFromRig(player.rig, side, {scale: player.scale})`
  (pluginets offentlige felter) og giver den til `createPropScene({handGeometry})` → `createGrabSystem`; `grab.js` kalder
  `graspPose` ved greb og (ved `high`) i `present()`. Demoens `avatar.js` gør det samme (`handOf`, `graspFor(bottle, side, hand)`
  med flaskens skalerede silhuet `bottleShape`). Grasp kender kun et duck-typed rest-hånd-objekt; andre karakterer kalder
  `handGeometry()` direkte (trin 5/6).
- Lab: `tools/lab/closure_lab.mjs calibrate|report` (env `KINDS`, `ALL=1`, `CLOSURE='{…}'` til tuning; `lab.js` fik
  `restHand`, `handLocalPoints` og `groups` i `measure`). Report (alle poses, CC-hud, gates fra validatoren):

  | kind (poses) | før (trin 2: clamp + SKIN_MARGIN) ok / maks. indtr. | `low` | `mid` |
  |---|---|---|---|
  | bottle_beer (73) | 73 / 0,72 mm, opp ≥ 121° | 73 / 0,72 | 73 / 1,04, opp ≥ 121° |
  | bottle_wine (63) | 62 / 1,94 | 62 / 1,94 | 62 / 1,94 |
  | can (37) | 37 / 0,82, opp ≥ 145° | 37 / 0,82 | 37 / 0,81 |
  | carton (40) | 8 / 17,6 | 8 / 17,6 | **16** / 17,6 |
  | mug body (4) | indtr. 1,62, opp 123,4° | 1,62, 1 fingerspids | **0,85, opp 123,4°** |
  | mug handle (4) | 4,96 | 2,65 | **1,06** (tommel rører ikke) |

  Mug tæller 0 ok i alle kolonner, fordi led-flaget (tommel-pitch 100) altid fejler (kendt undtagelse).
- Tests: Contracts `npm test` 291 → 297 grønne (ny `tests/interaction-grasp-closure.test.mjs`: tommel-tilt = plugin,
  FK = `syntheticJoints`, `handFromRig`, `placeWrist`, kontakt uden dyb indtrængning ved skala 1/1,09/1,2, mug-tommel rå,
  kvalitetsniveauer; skin-margin-testen erstattet; validator-audit uden `margin`). `test:hands` 33/33 PASS (beer/left
  0,51 mm / 163,6°, uændret; can/left 0,80 → 0,41 mm / 147,8°; mug/left 1,28 → 0,91 mm / 123,8°; pistol/magasin
  uændret). `test:interaction` 14/14 PASS. Demo `npm test` 41 → 42 (ny wiring-test med syntetisk hånd), `build` grøn.
- Afvigelser:
  (a) **Mug forbliver `CLAMP_EXEMPT`.** Ingen tommel i range holder kruset på CC-huden. Clampet: 27,8 mm ind. Søgt i range:
  4,6–12 mm ind, fordi kapsel-modellen ikke fanger tommelballen. I `mid`/`high` lukkes mugs fire fingre i range, og
  tommelen (`EXEMPT_KEEP`) følger sin rå række. Marginens tommel-del (+10° bend1) er lagt ind i de 8 mug-poser i
  `baked_grasps.data.json` som en data-refit. Uden den: opposition 119,4° < 120 i `test:hands`.
  (b) Tommel-søgning (`CLOSURE.thumbSearch`) findes, men er **slået fra**. Den gav op til 10 mm indtrængning på beer-poser,
  fordi modellens tommel driver væk fra huden langt fra bagningen.
  (c) `flat`/`pinch` lukker ikke forbi bagningen (`overshoot` 0); de åbner kun. Lukning krøllede carton-fingerspidserne 4 mm ind.
  (d) En bagning, der er for dyb, og hvis åbne vej går dybere (tommelens tilgang svinger gennem genstanden), beholdes
  inden for `tolerate` 2 mm. Ellers markeres den `stuck`. Det fjernede 10 mm-tommelfejl på venstre wine/can.
  (e) `high` tjekker mod det viste håndled, ikke mod den rå controller. Det er ikke afprøvet i headset.
  (f) Lab'ets "før" genskaber den gamle margin lokalt (`LEGACY_MARGIN`) til sammenligning.
- Åbne punkter: carton-data (håndled bøjet 95°, håndflade −14,7 mm: placering/data, ikke fingre); mug-handle-tommel
  (kræver hook-profil, grab_findings 3.1 fase 2); ingen headset-test; Quest-CPU er nok ~3× node (≈ 1 ms pr. greb, `mid`).
- Til trin 4 (Grasp Studio): brug `closeToContact`/`chainGaps` som live-feedback (gap pr. segment, `touching`,
  `backedOff`/`stuck`) og gem kun håndled + målform; `placeWrist`/`REFERENCE_HAND` er reference for den optagende hånd
  (gem dens håndlængde med optagelsen). Til trin 5/6: avatar-extensionen skal levere en rest-hånd-provider
  (`handGeometry`-input: frame, wrist, fingre pts/len/rest.yaw, skala) og helst sin tommel-tilt; VRM skal kalibrere
  `PAD_RADIUS` med `closure_lab.mjs calibrate`.

### Trin 4 — kode færdig, afventer headset-test (2026-10-09)

- App: `apps/grasp-studio` (Vite 8.3.3, three 0.170.0; dev: iwer 2.5.0, puppeteer-core 25.12.0 — samme versioner som
  demo/Contracts). `npm run dev` lytter på 127.0.0.1:5180 (`strictPort`; `GRASP_STUDIO_PORT`), så Quest via
  `adb reverse tcp:5180 tcp:5180` får `http://localhost:5180` som secure context. README har de præcise Quest 3-trin.
- v1: `bottle_beer`, krop/hals, højre/venstre; virtuel flaske; WebXR-hand-tracking (25 led pr. hånd); fingerspidser
  hvid/grøn/rød (`chainGaps` på `closeToContact`-resultatet, kontakt ≤ 4 mm, rød > 3 mm inde); referencehånd/avatar-hånd
  50 cm til siden, lukket-til-kontakt; tracking-sikkerhed (fingerspids-jitter) på panelet; auto-capture efter 1 s stillhed
  med nedtælling (alle frames i vinduet midles); score + validator; gem / gem som standard / kassér / fortryd; automatisk
  spejling (item z → −z). Poke-panel i XR (anden hånds pegefinger), DOM-HUD på desktop, `?synthetic` syntetisk hånd.
- Data: **`extensions/grasp/recorded_grasps.json`** (`gamesystems.recorded-grasps.v1`) ved siden af bagningen; flettes ind
  af `baked_grasps.js` (`mergePoses`): optagne poser lægges til, en optaget standard tager standard-flaget fra den bagte
  pose med samme kind/side/grasp. `BAKED` urørt; nye eksporter `RECORDED`, `POSES`. Valgt så en optagelse aldrig kan
  ødelægge bagningen og kan fortrydes linje for linje. Gemt pr. pose: `wrist` (item-rum), `quat`, `angles` (målform),
  `open`, `handLength`, `recorded {at, source, score, frames, mirrored?}`, evt. `mirroredFrom`.
- `placeWrist`: poser med `handLength` flytter håndleddet langs håndfladen med `(hånd.length − handLength) /
  REFERENCE_HAND.length`; poser uden (alle bagte) bruger den gamle formel uændret.
- Ny grasp-kode: `record.js` (XR-led → håndramme/rækker = invers af `fingerChain`, ~1e-3° rundtur; `poseJoints` syntetiske
  led; `mirrorPose`; `scoreGrasp` = verdict + kontakt på referencehånden, score 100 − 20·fejl − 4·adv. − min(25, 2·cost);
  bagte beer/wine/can-poser scorer median 88/88/92), `reference_hand.json` (Contracts-rig, skala 1,094, længde 0,203 m;
  bygget af `tools/make_reference_hand.mjs`) så studie og tests kører uden Contracts.
- Endpoint: `apps/grasp-studio/server/grasp_store.mjs` (Vite-plugin på `/api/grasps`; kun samme maskine, JSON, ≤ 512 KB,
  atomisk skrivning i kø; `save`/`default`/`delete`). Skriver kilden i `extensions/grasp` (ikke studiets vendor-kopi).
- Sync: fælles `scripts/sync_lib.mjs`; demoens `scripts/sync-helpers.mjs` og studiets `scripts/sync.mjs` bruger den
  (samme adfærd som før i demoen).
- Kvalitet: minimal/lav/mellem/høj styrer pixel ratio + XR-framebuffer, live-lukning hver 3./hver frame og avatar-tvilling
  fra/low/fuld (host-extension). Live-feedback ≈ 0,3 ms/frame i node.
- Tests (ingen headset): studie `npm test` 12/12 (tracking-sikkerhed, stillhed, midling inkl. quaternion-fortegn,
  auto-capture-flow, live-feedback, fangst ≈ bagt pose (håndled < 0,5 mm, rækker < 1,5°), håndlængde, spejling,
  serialisering, endpoint mod temp-fil inkl. 403/400/samtidige gem, temp-kopi af grasp-extensionen indlæser optagelsen);
  `npm run test:browser` 10/10 (Chrome + IWER: ingen konsolfejl, avatar-tvilling, syntetisk optagelse → gem via endpoint
  → fortryd, kvalitetsskift, IWER-XR-session med hand input læser led og beregner feedback, panel synligt);
  `npm run build` grøn. Demo `npm test` 42 → 43 (ny `tests/recorded-grasp.test.js`: studiets endpoint → demoens
  grasp-kopi → optagelsen er standard og lukker), `build` grøn. Contracts `npm run sync:extensions` (7 filer),
  `npm test` 297/297, `test:hands` 33/33 PASS.
- Afvigelser: (a) score er en knoglemodel-tilnærmelse på referencehånden, ikke den skinnede CC-hånd; (b) tracking-
  sikkerhed er heuristisk (WebXR har ingen); (c) kun auto-capture (pinch/controller-udløser ikke lavet; hånd + controller
  samtidig ikke afprøvet); (d) ingen animationstilstand; (e) `avatar-config.js`/avatar-aktivlisten er kopieret fra demoen.
- Åbne punkter: alt i headset (håndsporing om en virtuel flaske, 1 s stillhed, poke-panel, fps pr. niveau, scorens
  troværdighed). Hals-greb har ingen bagte poser at sammenligne med.
- Til trin 5 (karakter-kontrakt): studiets avatar-tvilling (`src/avatar.js`) og demoens avatar bruger begge Contracts-
  pluginnets spiller direkte; skift begge til karakter-kontrakten. `studio.setAvatarHand(side => hand)` forventer en
  `handGeometry`-hånd (frame, wrist, fingre pts/len/rest.yaw, skala) — samme rest-hånd-provider som trin 3 bad om.
  `handLength` i optagelser er knoglelængderne summeret langs håndled → langfinger-spids (XR-led); en karakter skal angive sin på samme måde.

### Trin 5 — færdigt (2026-10-10)

- Tre extensions i `GameSystems/extensions` (flade filsæt, kun offentlige API'er via `index.js`; hver har `LICENSE-NOTES.md`
  og MIT-/CharacterCreatorXR-hoveder pr. fil):
  - `humanoid` (ingen afhængigheder, ingen three): `canonical.js`, `qmath.js`, `rig.js`, `humanoid.js` (kopier af CharacterCreator
    `dc664c07`, MIT), `bone_maps.js` (MPFB, VRM 1 = identitet, VRM 0-tommelnavne, `boneMapFromVRM`, Mixamo med vilkårligt
    præfiks, `detectBoneMap`), `skeleton_check.js` (`checkSkeleton`: manglende led, fingre full/partial/none → vante-hånd +
    advarsel; knoer for langt fra forventet håndled-afstand/spændvidde/retning → advarsel; `completeHands` syntetiserer
    fingerled til vante-hænder, ≤ 2 cm fra CC-hånden). Hvert joint-head valideres som præcis tre endelige koordinater;
    tomme, for korte, for lange eller ikke-endelige fingerpunkter tæller som manglende og erstattes i en vante-hånd.
    Syntese kræver stadig gyldige håndleds- og underarmsankre), `layers.js`.
  - `avatar` (afhænger af humanoid + én karakter-provider som parameter): VRIK, kalibrering, gang (clips), førsteperson,
    fingre/fingerInput/filtre, tracking/session, NPC-animation. `createCharacterPlugin({ scene, renderer, character, quality })`
    med kvalitetsniveauer `AVATAR_QUALITY = off | arms | full` (`low`/`high` → arms/full); `entity.setQuality()` skifter live
    ('arms': samme arm-/hånd-/finger-IK, billige ben uden clips/sway/sit/hop, ingen cloth/hår-kollision/øjenliv; 'off':
    skjult og ikke løst). `measureCharacter`, `entity.skeleton` (tjekrapport), `entity.restHand(side)` / `restHand(rig, side,
    scale)` = `handGeometry`-input med frame, wrist, fingre (pts/len/rest.yaw), `scale`, `handLength`, egen `thumbTilt`,
    `mitten`. Grasp `handGeometry(rest)` tager nu `scale`/`thumbTilt` fra rest-objektet.
  - `character-cc`: `avatar.js` (CC-karakteren bag karakter-kontrakten + CC-ekstra: parts, clothing, setSlider, cloth, eyeLife,
    onRestChange …), `clothing.js`, `materials.js`, `lifecycle.js`, `index.js` (`ccCharacters({ assetsURL, quality })`-provider,
    `qualityFor`), `sync_cc.mjs` (node-only generator af `vendor/cc` + `assets`).
- **CharacterCreator-sync bor i character-cc** (`sync_cc.mjs`): hvert spil genererer `<sin kopi>/character-cc/{vendor/cc,assets}`
  (gitignored, aldrig redigeret). Contracts' `npm run sync` (`tools/sync_assets.mjs`) er nu en wrapper om den synkede
  `sync_cc.mjs` + three-kopien. Demo og studie synker aldrig fra CharacterCreator, men kopierer Contracts' genererede
  `vendor/cc` + aktiv-allowlist (`sync_lib.syncCharacterAssets`), så de altid har samme MIT-snapshot.
  **Licens:** CharacterCreator er GPL-3.0-or-later fra 2026-10-03 (MIT til og med `0d78054`). Kopierne er regenereret fra en
  `git archive` af MIT-commit `dc664c07` (samme 63 filer som før; 6 adskiller sig kun i CRLF fra den gamle checkout).
  En sync mod den nuværende CharacterCreator-HEAD ville hente GPL-kode — kræver brugerens beslutning.
- Contracts: `npm run sync:extensions` synker grasp, humanoid, avatar, character-cc (lader undermapper i fred);
  `packages/character-plugin` er nu kun en facade (`src/index.js` = avatar + `ccCharacters`, samme offentlige API +
  `avatarQuality`); pluginnets tests er peget om til `src/extensions`. `main.js` bruger `handGeometry(player.restHand(side))`.
  AGENTS.md, README, LICENSE-NOTES og plugin-README opdateret.
- Demo og studie: synker de fem/seks extensions, importerer `avatar` direkte og CC-karakteren via `contracts.js`
  (`ccCharacters`; stub-tjek på `src/vendor/extensions/character-cc/vendor/cc/character.js`); low = 'arms', high = 'full',
  skifter live; `handOf` = `handGeometry(player.restHand(side))` (vante-hånd → bagt greb uden lukning).
- Tests: Contracts `npm test` 297 → 310 (ny `tests/character-extensions.test.mjs`: bone maps inkl. Mixamo/VRM, skelettjek og
  vante-hænder, rest-hånd = `handFromRig`, karakter-kontrakt med falsk provider, tiers full/arms/off, rig uden fingre kører,
  afhængighedsregel; + sync-tests for 3 nye extensions), `test:hands` 33/33, `test:browser` 33/33, `test:interaction` 14/14
  (som før). Demo `npm test` 43 → 50 (ny `tests/character-sync.test.js`), `build` grøn; studie `npm test` 12/12,
  `test:browser` 10/10, `build` grøn. `sync:extensions --check` rent.
- Afvigelser: opdelingen blev skrevet direkte i GameSystems (mens baseline kørte) og derefter synket ind i Contracts, i stedet
  for først at dele inde i Contracts. 'arms' tegner stadig hele kroppen (kun beregningen er billigere). Lifecycle-koden findes
  to steder (avatar: lille, character-cc: fuld), fordi avatar ikke må importere character-cc. Intet headset-test.

### Trin 6 — kode færdig (2026-10-10; brugerens beslutning: grebskriteriet er flyttet til trin 10, Håndprofil)

- Ny `extensions/character-vrm/` (flade filer): `character.js` (`createVRMCharacter(vrm, {quality})`, samme kontrakt som
  character-cc: `root, meshes, humanoid, restHeads(), applyPose(), resetPose(), headBone, capabilities, quality, dispose()`
  + `eyeOffset, setFirstPerson, setQuality, resetSecondary, tick`), `loader.js` (eneste three-vrm-import; `VRMLoaderPlugin`
  med `autoUpdateHumanBones:false`, `removeUnnecessaryVertices`/`combineSkeletons`), `index.js` (`vrmCharacters({assetsURL,
  url, model, quality})` → provider `{id:'vrm', quality, create}`; loaderen hentes dynamisk), `models.js`, `fetch_model.mjs`
  (download + størrelse/sha256-tjek, `--check`), `sync_vrm.mjs` (kopierer kun verificerede modeller til appens
  `public/vrm-assets/`), `LICENSE-NOTES.md`. Kun humanoid/avatars offentlige API: `createHumanoid` +
  `boneMapFromVRM(getRawBoneNode, {version: 1})` + `checkSkeleton`.
- Afhængigheder: npm `@pixiv/three-vrm` **3.5.5** (MIT, udgivet 2026-07-09; peer three >=0.137), fastlåst i demo og studio.
  Testmodel: "Jimmy" fra Polygonal Mind 100Avatars R1 (`initiative-opensource-release`, CC0 1.0; repoets License.md + VRM-meta
  `licenseName: CC0`), 1 599 132 B, sha256 `aca7f1d2…6be` — binær i gitignoret `extensions/character-vrm/assets/`, hentes
  med `node extensions/character-vrm/fetch_model.mjs`. VRoid-samples (ikke CC0 / login) og vrm-c-samples (VRM Public
  License) blev fravalgt.
- Kvalitet: `low` = ingen spring bones, ingen expressions/blink, ingen skygger; `high` = spring bones + blink + skygger.
  Demo: spillerens tier følger skin-upgrade (Mellem/Høj → high), NPC'er low. Node-constraints kører altid (billige).
- `eyeOffset()` returnerer øjnenes centrum relativt til karakterens rod, uafhængigt af rodens og forældrenes world-transform; metoden opdaterer selv de nødvendige world-matricer.
- VRM0/VRM1: three-vrm omdøber VRM0-tommelfingerknoglerne til 1.0-navne ved import, så bone-mappet bruger altid
  `version: 1` (med VRM0-navne ville tommelfingeren blive forskudt ét led). VRM0 vender −Z → roden drejes π.
- Tommelfinger-tilt: Jimmys hvile-fingre er strakte (tommelfinger-bøjning 0°), så bøjningsplanet kan ikke måles fra
  leddene; 60° (`THUMB_AXIS.tilt`) beholdes. Avatarens `restHand` sætter altid `thumbTilt = THUMB_AXIS.tilt`.
- Demo: ny `src/character-select.js` (`?character=cc|vrm`, `?vrm=<url>`; begge providere indlæses lazy, så three-vrm er en
  separat chunk på 139 kB, `loader-*.js`); `avatar.js` ændret på én linje (import fra `./character-select.js`).
  `scripts/sync-helpers.mjs`: `character-vrm` i EXTENSIONS + `syncVRMAssets`. `.gitignore`: `public/vrm-assets/`. Studio:
  samme `character-select.js`, en importlinje i `src/avatar.js`, `scripts/sync.mjs`, `.gitignore`.
- Grebs-lab: `lab_page.mjs`/`index.html`/`lab.js` kan køre med `CHARACTER=vrm` (avatar-extensionen + character-vrm,
  three-vrm fra demoens node_modules, kalibreret til 1,62 m øjenhøjde som demoens auto-kalibrering → skala 1,247).
- Målinger (lab, standardposer, `closure_lab.mjs report`; CC = samme session):
  | | CC (hånd 0,203 m) | VRM Jimmy (hånd 0,317 m = 1,56×) |
  |---|---|---|
  | bottle_beer mid | 2/2 OK, pen 0,35 mm, opp 156° | 0/2, pen 1,5 mm, palm-gap 32–36 mm, 1 fingerspids, tommel rører ikke |
  | bottle_wine mid | 2/2 OK | 0/2 (samme mønster) |
  | can mid | 2/2 OK | 0/2 (samme mønster) |
  | mug mid | 0/2 (kendt) | 0/2, pen 22 mm |
  | carton mid | 0/2 (kendt) | 0/2, håndled bøjet 109° |
  `calibrate` (ALL=1) på VRM: kun tommelfingersegmenter når overfladen (Thumb `[-0.015, 0.003, 0.039]`; øvrige fingre
  null), så `PAD_RADIUS` kan ikke kalibreres for Jimmy. Referencehånd: længde 0,317, palm `[0, -0.0245, 0.0365]`.
  Forsøg med andre håndledsplaceringer (karakterens egen palm-anker; knoer-relativ placering; glid langs palmenormalen)
  giver palm-gap 1,5–7 mm, men så går tommelrod/-metacarpal 15–30 mm ind i flasken, og fingrene rører stadig ikke
  (bone-modellen passer med huden, ±1 cm). Årsag: tegneseriehånd (lang hånd, knoer 0,144 m fra håndleddet mod CC 0,113,
  tyk tommelrod) — de CC-fittede bakes + lukning langs bake-rækkerne generaliserer ikke til så andre proportioner.
- Tests: demo `npm test` 106/106 (ny `tests/character-vrm.test.js`, 8: sync-identitet, falsk VRM0/VRM1-binding + frame,
  kontrakt/pose/reset/first person/tiers/dispose, mitten uden fingre, `?character=vrm`, sha256, rigtig model gennem three-vrm
  i node + skeletcheck + rest hand, avatar poserer den rigtige VRM fra tracking + `closeToContact`); `build` grøn
  (`vrm-assets` i dist). Studio `npm test` 17/17, `test:browser` OK, `build` grøn. Contracts `npm test` 319/319,
  `test:hands` OK, `sync_extensions --check` OK (Contracts ikke rørt). Headless (vite preview :5233, `?character=vrm`):
  character-vrm-chunk + .vrm hentes, avatar `id: 'vrm'` med 52 humanoid-knogler, ingen konsolfejl.
- Åbent (til et senere trin): greb på karakterer med andre proportioner kræver (a) et palm-anker pr. karakter
  (`restHand().palm` / `placeWrist(pose, hand, reference)` med karakterens reference — rører `extensions/avatar` og
  demoens `avatar.js`, trin 7's filer) og (b) lukning der kan søge ud over bake-rækkerne/re-fit pr. karakter, eller en
  realistisk proportioneret CC0 VRM. Done-kriteriet "greb består validator" er derfor ikke opfyldt for Jimmy.

### Trin 7 — kode færdig, afventer headset-test (2026-10-10)

- Format + afspilning: `extensions/avatar/handposes.js`. Et klip er `{ id, kind: 'pose'|'animation', space: 'hand'|'item'|'grasp',
  duration?, loop?, side?, frames: [{ t, wrist: {pos, quat}, rows: {Thumb..Little: [dyaw, pitch, bend1, bend2]} }] }`, og en pose
  er et klip med én frame. `space: 'grasp'` er en skabelon for alle greb: framen har `mix` (0 = grebets åbne rækker, 1 = de
  lukkede, pr. finger) i stedet for `rows`, og håndleddet er en offset fra grebets håndled (`resolveClip` laver almindelige frames
  til et konkret greb). `sampleClip` er lineær + nlerp på `low`/`mid` og Catmull-Rom + slerp på `high`. Kubisk overshoot klampes
  til `LIMITS` udvidet til keyframes, så en keyframe altid gengives eksakt. Øvrige funktioner: `createHandAnimator`,
  `mirrorClip`, `buildLibrary` (en optagelse erstatter biblioteksklippet med samme id).
- Data: `hand_poses.json` genereres af `tools/make_hand_poses.mjs` (`--check` køres af Contracts' test).
  - 17 poser:
    - Fra Godot `finger_poses.gd` (MIT, NightfallContractsGodot; kun læst, samme rækkekonvention, så konverteringen er
      identisk): relaxed, open, pistol, trigger, support, magazine, insert, slide, object_wrap/neck/handle/pinch.
    - Fra `fingers.js`-kurverne: flat, fist.
    - Søgt på referencehånden: point (fist + Godots pistol-pegefinger), thumbs_up (tommel radialt ud) og pinch (spidser 12 mm
      fra hinanden).
  - 5 klip: grab, release, pour, wave, beckon.
  - Klampet til JS `HARD`/`LIMITS` (uændret): kun `trigger: Index.dyaw -20 -> -15` (Godot tillader -25).
  - `recorded_hand.json` er tom og skrives af studiet. Proveniens står i `LICENSE-NOTES.md`.
- Kvalitet (`HAND_POSE_QUALITY`, global `setHandPoseQuality`, pr. spiller `entity.setHandPoseQuality`, `?handposes=` i demo og
  Contracts):
  - `low`: de gamle kurver (`fingerStateFromCurls`), lineært greb og ingen slip-animation.
  - `mid`: dataposer; hver finger følger sin curl langs flat → fist, og grab/slip/hældning afspiller klip.
  - `high` (standard): grip blender relaxed → fist, trigger blender pegefingeren. Med touch-sensorer (låst pr. hånd når en rørt,
    utrykket knap ses) peger en urørt trigger, og en løftet tommel på holdt grip giver thumbs up (blødt, 0,08 s). Klippene
    interpoleres kubisk.
  - Rapporteret `curl` er input-curlen på alle niveauer, så eksisterende curl-tests og forbrugere er uændrede.
  - Relaxed-hånden ved tabt tracking er bibliotekets `relaxed` på `mid`/`high` (curl = `RELAXED_CURLS`).
- Integration:
  - `fingerInput.js`: `evaluateSource(..., {quality, gesture, dt})`, `controllerFingerState` og `relaxedFingerState`;
    `fallbackCurls` giver nu også rå trigger/grip/touch.
  - Avatarens spiller: `playGesture(side, id)`/`stopGesture` (fade 0,15 s). Slip-klippet spiller når et værts-override
    (`record.fingers[side]`) forsvinder (`mid`/`high`).
  - Demo `avatar.js`: `grabFingerState(runtimeRows(pose), close)` erstatter den lineære `fingerState`; holdt flaske følger
    `pourFingerState` efter flaskens hældning; XR-snapshots har nu `touched`/`pressed`.
  - Contracts:
    - `grab.js present()` bruger `grabFingerState`.
    - `main.js`: pistol (pistol → trigger efter aftrækket), støttehånd og magasin bruger dataposerne på `mid`/`high`.
    - Facaden eksporterer hånd-pose-API'et.
- Grasp Studio:
  - Tilstande Greb / Animation / Gestus (panelrække 3; statuslinjerne er rykket ned, og panelet er 0,30 m højt) og et navnevalg.
  - `capture.js createAnimationCapture`: hold stille → optagelsen starter; bevæg; hold stille → den stopper. Stille-halen
    trimmes, og optagelsen afbrydes ved tabt tracking eller efter maks. 15 s.
  - Gestus bruger auto-capture uden on-item-krav.
  - Begge kører `processRecording`: One Euro → RDP-keyframe-reduktion (2°/3 mm) → grasp `validateRows`/`clampRows` pr. keyframe.
    Derefter review med spejl, og klippet gemmes via `/api/hand` (`server/hand_store.mjs` → `extensions/avatar/recorded_hand.json`;
    `GRASP_STUDIO_HAND_OUT` til tests).
- Tests (før → efter):
  - Contracts:
    - `npm test` 319/319 grøn (+9 i `tests/hand-poses.test.mjs`).
    - `test:hands`, `test:browser`, `test:interaction` og `sync_extensions --check` er grønne.
    - `test:interaction` timede ud i baseline-kørslerne under SwiftShader; på hardware-GPU er den grøn, 14/14.
  - Demo:
    - `npm test` 106/106 med de andre trins tests (+2 i `tests/hand-poses.test.js`), og `build` er grøn.
  - Studio:
    - `npm test` 17/17 (+5 i `tests/hand.test.js`).
    - `test:browser` 10 → 13/13: gestus-optagelse → `/api/hand` → fortryd.
    - `build` er grøn.
- Afvigelser:
  - (a) avatar må ikke importere grasp (afhængighedsreglen). Pipelinen tager derfor grasps `clampRows`/`validateRows` som
    parametre (studiet sender dem med), og runtime-klampen er avatarens egen `LIMITS` (= `HARD`).
  - (b) Gestus-klip i hånd-rum styrer kun fingrene på spilleren, ikke håndleddet (tracking ejer håndleddet).
  - (c) Grab-klippet er forfattet, ikke optaget. Optag `grab`/`release`/`pour` i studiet for at erstatte det.
  - (d) Desktop har ingen touch-data, så der er ingen gestus der.
- Kræver headset-test:
  - Controller-hænder på Quest (peg ved urørt trigger, thumbs up, relaxed ved hvile, overgange uden pop).
  - Grab/slip/hældning på flasker og props.
  - Pistol, støttehånd og magasin med dataposer.
  - Studiets animations- og gestustilstand med rigtig hånd-tracking (start/stop-følsomhed, trim, panelets 4. række).
  - Om det kubiske overshoot ser naturligt ud.

### Trin 8 — færdigt (2026-10-10)

- Ny `extensions/bottles/` (flade filer, offentligt API i `index.js`): `system.js` (`createBottleSystem`), `bodies.js`
  (`BottleBodies`: flaske-/skår-legemer på adapteren, pose-sync, sammenlægning af stød pr. flaske pr. trin), `factory.js`,
  `breakage.js`, `pour.js`, `damage.js`, `surfaces.js`, `audio.js` (`BottleAudio`), `quality.js`, samt `bottle_liquid.js`,
  `liquid_lut_v2.js`, `bottle_design.js` **flyttet** fra `shaders/three`/`designs/three` (de gamle stier er nu
  `export *`-shims, så test-siderne og `tests/containers_lut_test.mjs` virker uændret). Ingen fysikmotor importeres.
- Extension: `host.load(bottlesExtension, { catalog, assetURL, surfaces, audio? })` → api `{ factory, pour, breakage, bodies,
  audio, bottles, tier, settings, spawn, adopt, remove, reset, shoot, shatter, ledger, setQuality, step, dispose }`. Ingen
  `update()`: systemet steppes fra `ctx.physics.onStep` (efter fysiktrinnet og dets kontakter, samme rækkefølge som før:
  sync → stød → væske/masse → hældning → brud/debris). Sender `broken { bottle }` før flasken fjernes. `bottle.entry` er
  adapter-handlen; spillet holder/slipper via sin adapter. `adopt({ root, liquid, asset, breakInfo, fill, position })` tager en
  model spillet selv har bygget (procedurale flasker i trin 9, tests).
- Kvalitet (`BOTTLE_TIERS` = `minimal | low | mid | high`, 1:1 med demoens niveau 0–3; `host.setTier('bottles', …)` pinner):
  skygger, bobler, slosh, synlige stråler, hver n'te dråbe tegnet, hver n'te skår spawnet (1/2/3), debris-loft (250/250/120/60),
  dråber pr. sprøjt (36/36/20/12), dråber i luften (4096/4096/1200/400; over loftet lægges volumen i nyeste dråbe), tegnede pytter
  (256/256/32/16; volumen bliver i regnskabet), skademærker pr. flaske (8/8/5/3). `mid`/`high` = demoens hidtidige lofter.
  Fysik, skade og volumen afhænger aldrig af niveauet.
- Adapter-interfacet (`host/physics.js`, `PHYSICS_METHODS`) udvidet: `velocity`, `setMass`, `isHeld`, `onStep`; `addBody`-options
  `velocity`, `spin`, `contacts` (false = ingen rapporter), `sleepTimeLimit`, `group`/`mask`; kontaktrapporter med `localPoint`,
  `localNormal`, `velocity`, `spin`, `otherMass`, `impulse` (valgfri felter afledes af bottles hvis de mangler); hold/release/setMass
  på fjernede handles ignoreres. Cannon-adapteren implementerer det hele + world-options `allowSleep`/`friction`/`restitution`.
- Demo: `src/{factory,breakage,pour,damage,audio,surfaces}.js` slettet; `physics.js` er nu en tynd `PhysicsWorld` om
  cannon-adapteren (rummets statiske kasser via `addBody`, uden cannon-import); `main.js` indlæser bottles via host og lytter på
  `broken` → `interaction.dropBottle` (før avatarens lytter); sync-listen har `bottles`, og de gamle `src/vendor/{bottle_liquid,
  liquid_lut_v2,bottle_design}.js` slettes af sync. `interaction.js`, `avatar.js` og `scripts/sync_lib.mjs` er ikke rørt.
- Tests: demo `npm test` 50 → 65 fra dette trin (før: 50/50; ved afslutning 66/67 inkl. 2 nye tests fra trin 7 — den ene fejl er `avatar: the Contracts game uses the same files`,
  fordi trin 7 lige har lagt `handposes.js`, `hand_poses.json`, `recorded_hand.json` i `extensions/avatar`, endnu ikke synket til
  Contracts). Nye: `tests/bottles.test.js` (12: extensionen på en motorfri `tests/fake-physics.js`-adapter — legeme, pose-sync,
  masse fra fyld, brud → `broken` + fjernelse + sprøjt + balanceret regnskab, afledte kontaktfelter, revne, holdt flaske ignorerer
  stød, tiers/pinning/lofter, færre skår på low, dispose; + grep: `cannon-es`/`CANNON.` kun i `adapters/physics-cannon.js` over
  `extensions`, `webxr-demo/{src,tests,scripts}`, `apps`; + bottles-kilden nævner ingen motor), 3 nye adapter-tests (rækkefølge
  kontakter → onStep, rapportfelter, velocity/setMass mens holdt/contacts:false/fjernede handles, demoverdenens materiale).
  `effects.test.js` peger på extensionen. `npm run build` grøn. Browser (Vite på 5211, skjult rude, loopet drevet manuelt): 29
  flasker, ingen konsolfejl, greb (kinematisk), hældning 151 ml → pyt, kast → brud + `broken`, skud gennem flaske og rude, skår,
  kvalitetsskift, nulstil; volumenregnskab balancerer (|fejl| < 1e-11 ml).
- Afvigelser: (a) bottles har ingen `off`-tier (flaskerne er spillets indhold; laveste = `minimal`). (b) Designs indlæses stadig
  altid i `high` (design-tiers `_low`/`_minimal` findes, men copy-assets tager dem ikke med). (c) Energien ved knusning bruger
  flaskens sporede masse i stedet for cannon-legemets (samme værdi; 0 mens holdt, som før). (d) `impulse` fra cannon er et estimat
  (fart × reduceret masse) — cannon giver ingen impuls i `collide`. (e) Kontaktlyttere på flasker er nu adapterens (alle
  rapporter over 0,45 m/s), rummets kasser og skår har `contacts: false` (billigere end før for skår). (f) Ingen headset-test.
- Til trin 9 (Contracts): sync `host` + `bottles` (bottles importerer `../host/index.js`); skriv Contracts' adapter mod
  `PHYSICS_METHODS` (alle 10 kræves) — `onStep` kaldes efter hvert solver-trin efter kontaktrapporterne, rapporter skal mindst have
  `a, speed, point, normal, surface, otherMass`; solverens brud/skår skal ud af solveren og blive til kontaktrapporter, så
  `bottles` afgør brud (damage.js). Grupper: flasker 4, skår 2 (maske 1|4), statisk verden 1. Procedurale flasker → `adopt()` eller
  catalog-`spawn()`; `assetURL` skal pege på GameSystems-aktiver (export/, audio/ogg). Kør `tests/fake-physics.js`-mønstret mod
  Contracts-adapteren som kontrakttest.
- Til G2 (`gs_bottles`): samme navne i snake_case — `spawn/adopt/remove/reset/shoot/shatter/ledger/set_quality`, event `broken`
  `{bottle}`, tiers `minimal/low/mid/high` med tallene i `quality.js` (gør dem til JSON i G3 hvis begge skal læse samme fil),
  `GSPhysicsAdapter` med de 10 metoder (`on_step` ≈ `_physics_process`, `velocity`, `set_mass`, `is_held`), samme rapportfelter.
- Væskefarve (2026-10-10): ny `liquid_color.js` — farve som Beer-Lambert-absorbans `a = -ln(farve gennem uRefPath)`; flasker
  (`b.absorbance`, fra `uLiquidColor`/`info.color`), dråber, stråler og pytter bærer kildens absorbans (ikke længere faste
  `0xb57835`/`0x87502c`). Pyt = tyndt lag: `T = farve^(2·dybde/refPath)`, dybde = ml/areal (lysere og mere gennemsigtig end
  flasken). Blanding = ml-vægtet absorbans (subtraktiv: rød+blå = mørk lilla) i pytter, sammenvoksende pytter, flaske→flaske
  (opdaterer `uLiquidColor`) og `refill(b, ml, absorbans)`. Tier-flag `puddleGradient` (mid/high: vertexfarve+alpha tyk midte →
  tynd kant; minimal/low: én flad farve pr. pyt). Dråbe-/strålematerialer caches pr. kvantiseret absorbans (maks 48). Ledger urørt.
  Tests: `webxr-demo/tests/liquid-color.test.js` (5).

### Trin 9 — kode færdig, afventer headset-test (2026-10-10)

- Contracts synker nu `host` + `bottles` (`tools/sync_extensions.mjs`: `EXTENSIONS` += `host`, `bottles`; `adapters` behøves
  ikke). Samme script kopierer flaske-aktiverne spillet bruger (`BOTTLE_ASSETS` = `bottle_beer`, `bottle_wine`: GLB,
  `*.liquid_v2.json`, `*_break.json`, `*_shards.glb`, lydene i `BOTTLE_SOUNDS` fra `audio/ogg/`, et `catalog.json`-udsnit) til
  `assets/gamesystems/<samme sti>` (855 KB, MIT, egen `SYNCED.json` med hashes); `--check` dækker også aktiverne. Spillet kører
  dermed alene (`assetURL(path)` → `assets/gamesystems/<path>`), og `npm run stage` tager dem med.
- GameSystems-ændringer (bagudkompatible): `adopt()`/`spawn()` tager `body: { shape, options }` (spillets kollisionsform + ekstra
  `addBody`-options; `userData` flettes, `surface` og gruppe 4 bevares) og `color` (sRGB-array eller `0xRRGGBB` → flaskens
  absorbans via `setBottleLiquidColor`, så dråber/stråler/pytter/blanding følger den). `spawn(id, design, fill, position, open,
  extra)` sender `extra` videre (`extra.breakInfo` flettes over `*_break.json`). Demo-test af begge.
- Contracts' adapter `src/interaction/physics_adapter.js` (`createPhysicsAdapter(world)`): alle 10 `PHYSICS_METHODS` på spillets
  egen solver. `addBody`: masse 0 → statisk AABB i solveren (`surface` fra `userData`); `contacts:false` + lille kasse (≤ 0,2 m)
  → let debris (den gamle skår-integrator: ballistisk, spin, lander på gulv/bordplader, stopper ved vægge); ellers et solver-legeme
  (cylinder/kasse/kugle→cylinder/sammensat → katalogform; katalogens `lathe`/`parts` går direkte igennem). `pose`/`velocity` er
  legemets origo (ikke massemidtpunktet), `release` omregner. `step(dt)` (spillets): solver-trin → kontaktrapporter → debris →
  `onStep`-lyttere.
- Solveren (`src/interaction/physics.js`) knuser ikke længere noget: `breakBody`, skår, `SHARD_COUNT`, `breakable` er væk.
  Legemer med `contacts: true` giver rapporter (`drainContacts()`) med alle interfacets felter (`a, b, speed, point, normal,
  localPoint, localNormal, velocity, spin, otherMass, impulse, surface`) over 0,45 m/s; pr. legemepar pr. substep samles
  kontaktpunkterne (fart = største tilnærmelse, punkt/normal = tilnærmelsesvægtet middel — ellers vandt flaskens bund altid ved
  fladt nedslag og intet knustes), og pr. trin beholdes det kraftigste substep. Statiske kasser og bordet har `surface` (bord =
  `wood`, gulv/niveau = `concrete`), krus/dåse/karton `stone`/`metal`/`plastic`. `setMass`, `addStatic` (returnerer kassen),
  `removeStatic` er nye.
- Flasker: `src/interaction/props.js` laver host + bottles på adapteren og `spawn()`'er øl og vin fra katalogets GLB'er (væske-
  shader, LUT, åbne → kan hældes) med `bottleOptions(kind)` fra ny `src/interaction/bottles.js`: kollisionsform = katalogets
  lathe-silhuet (samme som grebene er bagt på), `color` = `CATALOG[kind].liquid` (øl `0xd88a14`, vin `0x5a0d1c`), og
  brud-kalibrering `{ v_n: GLASS_BREAK_CONTACT_SPEED (2,5), surface: 'concrete', fill: katalogets fyld }`. Flaskens solver-legeme
  er extensionens adapter-handle, så `grab.js`, kugler, hover-omrids og `snapshot()` virker uændret. `host.on('broken')` sætter
  `body.broken` (grab slipper) og logger `break`. Kugle → `applyBulletImpact(..., { shatter })` → `api.shatter()` (skår skubbes
  langs skuddet, sprøjt i flaskens farve). Pytter: bordet + usynlige kasse-proxyer for gulvet og niveaukasser inden for 8 m.
  Krus/dåse/karton er stadig procedurale solver-legemer. `props.ready` (flaskerne indlæses asynkront) afventes i `main.js` før
  `__ready`; `reset()` rydder og spawner igen.
- Kvalitet: Contracts havde intet globalt niveau; nu `?quality=0..3` (eller `minimal|low|mid|high`, standard 3) →
  `host.setQuality`, `?bottles=<tier>` pinner, `__game.setQuality(level)` i testtilstand. (`?handposes=` er uændret separat.)
- Tests: Contracts `npm test` 319 → 339 (alle grønne). Nye: `tests/interaction-physics-adapter.test.mjs` (14: kontrakttest efter
  `fake-physics.js`-mønstret men med rigtig solver — alle 10 metoder, formoversættelse, origo-pose/-hastighed, statisk AABB +
  `surface`, rapportfelter/rækkefølge (rapporter før `onStep`)/ét pr. par pr. trin/samlet kontaktpunkt, legeme-legeme
  (`otherMass`, reduceret-masse-impuls, stille ved hvile), debris, hold/release/setMass/remove, fjernelse fra lytter; flasker
  adopteret med spillets silhuet/farve/kalibrering, farven i dråber og vin-pyt, regnskab balancerer, fald 1,6 m knuser / 2 m/s
  på træ gør ikke), `tests/helpers/bottle_world.mjs` (node-scene med rigtig `*_break.json` og skår-GLB som data:-URL), 2
  aktiv-sync-tests. Omskrevet til extensionen: kast 2/3/4/6 m/s mod gulv/væg (2 → kun revne, ≥ 3 → knust + skår), skud på øl/vin
  (knust, alle annoncerede skår spawner som debris, ≥ 60 % langs skuddet), holdt flaske skudt, controller-kast 3/4 m/s mod væg.
  `test:hands` 33/33, `test:interaction` 14 → 16/16 (nye: begge flasker er GameSystems-flasker i tier high; vinen sprøjter i
  pytter og regnskabet balancerer; skår-tjekket venter nu på den asynkrone skår-GLB), `test:browser` 33/33, `npm run stage` grøn (aktiverne med i `build/site`),
  `sync_extensions --check` rent. Demo `npm test` 123/123 (+4 herfra: adopt `body`/`color`; ny `tests/contracts-sync.test.js`:
  Contracts' `host`/`bottles` = GameSystems-filerne, Contracts' flaske-aktiver = GameSystems' bytes/katalog).
- Afvigelser: (a) En holdt flaske knuses ikke længere ved at slå den mod noget (extensionen ignorerer stød mens `isHeld`); skudt
  knuses den stadig. (b) `velocity()` på et holdt legeme er den rigtige hastighed (Contracts driver holdte legemer dynamisk), ikke
  0 som cannon. (c) Debris har ingen legeme-legeme-kollision; statiske former bliver AABB; kugle ≈ cylinder; `orientation` i
  former ignoreres. (d) Flaskemassen kommer nu fra extensionens profil (glas + væske efter fyld): øl 0,627 kg (før 0,55), vin
  0,825 kg (før 0,74). (e) Skud går via Contracts' egen raycast (katalogsilhuet) + `api.shatter`, ikke `api.shoot` — skud knuser
  altid (som før), ingen hul/lækage fra skud. (f) Under arbejdet ændrede en anden agent `bottles/pour.js`/`system.js`
  (`consumePuddleVolume`, `bottles:reset`); de er synket med.
- Åbne punkter / headset-test: væske-shaderen, gennemsigtigt glas og pytter i headsettet (ydelse på Quest ved tier high vs. mid),
  hældning fra en holdt åben flaske (flaskerne står åbne), om 2,5 m/s-kalibreringen føles rigtig ved rigtige kast, om brud ved
  slag med holdt flaske savnes, hover-omridset om GLB'ens Glass-mesh, lyden (HTML-audio, ikke spillets AudioContext).

### Trin 10 (Håndprofil) — kode færdig, afventer headset-test (2026-10-10)

Mål: greb der virker uanset håndstørrelse (VRM-testmodellen Jimmy har en hånd 1,56× CC-hånden: palm-gap 31–37 mm, én
fingerspids, tommelrod i flasken). Hele lukningen afhænger nu kun af en **håndprofil**, ikke af CC-referencehånden.

**Profilformat** (`extensions/avatar/handprofile.js`, `HAND_PROFILE_FORMAT = 'gamesystems.hand-profile.v1'`): et lille, fladt
dataobjekt i håndens egen ramme (origo i håndleddet, +x radial/tommelside for begge hænder, +y dorsal, +z distal; meter i
karakterens hvile-rig, verdensstørrelse = × `restHand().scale`):

| felt | betydning |
|---|---|
| `format, side, source` | `'measured'` (fra hud) / `'rig'` (ingen hud: proportionale standarder) / `'…+override'` |
| `length`, `knuckle` | håndled → langfingerspids; håndled → langfingerkno |
| `palmWidth`, `palmThickness` | bredde over knoerne; tykkelse midt i håndfladen (hud) |
| `palmCenter [3]`, `palmNormal [3]`, `palmPatch [[3]]` | håndfladens kontaktcentrum, normal ud af håndfladen, ≤ 12 palmare hudpunkter (3×4-gitter, kun fast vægtede vertices) |
| `thumbRoot`, `thenarPatch [[3]]` | tommelrod-/thenar-tykkelse (85-percentil); ≤ 6 thenar-hudpunkter (proksimale tommel-metacarpal) |
| `palmOffset` | korrektion for posed hud (m, standard 0; lab'ens `calibrate`): håndfladen holdes på `palmGap + palmOffset` |
| `thumbTilt` | tommelens bøjningsplan (rad) |
| `bases`, `spread`, `segments` `{Thumb..Little}` | knoer, hvile-spredning (rad), segmentlængder |
| `girth`, `pad` `{Thumb..Little: [3]}` | medianradius pr. segment; kontaktradius = `PAD_CONTACT` (0,75 fingre / 0,55 tommel) × median fleksor-rækkevidde |

- **Måling** (rene funktioner, avatar importerer ikke grasp): `handskin.js handSkinPoints(character, side)` læser
  hvile-hudens vertices pr. dominerende hånd-/fingerknogle (én gang pr. karakter og efter rest-ændring);
  `measureHandProfile(rest, points)` → profilen; uden hud `rigHandProfile` (CC-proportioner). Lav-poly-segmenter (Jimmy:
  ringe kun ved leddene) samples bredere; håndfladepatch kun af vertices med vægt ≥ 0,8 (knoområdet løfter sig ved krum).
- **Overstyring**: `applyHandProfile(profile, override)` — felter erstattes (pr.-finger-objekter flettes), plus `size`
  (alle længder/positioner) og `girth` (tykkelser); flad eller `{ left, right }`. Kilder i rækkefølge: karakterens egen
  (`character.handProfile`, fx `character-vrm/models.js` jimmy: lab-kalibreret `pad` + `palmOffset`), provider-option
  (`ccCharacters({handProfile})`, `vrmCharacters({handProfile})`), plugin-option (`createCharacterPlugin({handProfile})`,
  også Contracts' facade), spiller-option (`createPlayer({handProfile})`), runtime `entity.setHandProfile(override, side?)`
  (null rydder). `entity.handProfile(side)`, `entity.measuredHandProfile(side)`, `entity.handProfileVersion` (bumpes ved
  hver ændring; demo/studio/Contracts bruger den i cache-nøglen for `handGeometry`, så næste greb lukker på den nye profil).
  `restHand(side)` er bagudkompatibel og har nu `profile`.
- **Lukning** (`grasp/closure.js`): `handGeometry` bygges fra profilen (pad pr. segment i stedet for `PAD_RADIUS`, thenar
  som kollisionspunkter der drejer med tommelrækken). `placePalm`: profilens palm-centrum på bake'ets palm-anker
  (`palmAnchor`: bake-håndled + referencehåndens palm, kun som bake-proveniens), glid langs palmenormalen til
  `palmGap` (4 mm) + `palmOffset`, ryk tilbage hvis thenar er inde. Kvalitetsniveauer: `raw/low` ingen søgning (én ekstra
  tommel-CMC-søgning hvis tommelen sidder fast eller ikke når), `mid`/`high`: afgrænset søgning (`SEARCH`: lateral, langs,
  pitch, twist, normal; mid 27 kandidater, high 162) inden for HARD-grænserne, bedst `gradeGrasp`-score vinder, nærmeste
  først, stopper ved fuld score (4 spidser + tommel + opposition ≥ 140°) — CC-standardgreb koster derfor 1 lukning.
  Tommelregler: en søgt tommel scorer 4 lavere; en bake-formet tommel inden for 3 mm beholdes (søgt CMC driver fra huden);
  tommel ud over t = 1,4 straffes. Pris (node, desktop): måling 1–6 ms pr. karakter; lukning 0,3–1 ms; mid ≤ 30 ms og
  high ≤ 160 ms i værste fald (én gang pr. greb, memoiseret).
- **Grebs-lab**: `closure_lab.mjs report|calibrate` med `CHARACTER=cc|vrm`, `SEARCH=mid|high|none`, `PROFILE='{...}'`
  (runtime-override via `__lab.setHandProfile`), `IDS=` (pose-id-delstrenge), `FACES=1` (trekant-sampling af huden).
  `calibrate` måler effektiv pad pr. segment og `palmOffset` fra posed hud og udskriver en færdig override.
- **Lab før → efter** (standardposer, mid; pen = hud inde i mm, palm = palm-gap mm):
  | | CC før | CC efter | VRM før | VRM efter (med models.js-profil) |
  |---|---|---|---|---|
  | bottle_beer R/L | OK/OK, pen 0,35/0,35, palm 3,9/5,1 | OK/OK, pen 0,60/1,86, palm 3,6/3,3 | FAIL/FAIL, palm 36/32, 1 spids | OK/OK, pen 2,2/1,0, palm 1,6/4,3, 3+T |
  | bottle_wine R/L | OK/OK, pen 0,51/0,37 | OK/OK, pen 1,11/1,14 | FAIL/FAIL, palm 37/31 | OK/OK, pen 1,2/1,1, 3–4+T |
  | can R/L | OK/OK, pen 0,35/0,39 | OK/OK, pen 0,76/1,00 | FAIL/FAIL, palm 37/31 | OK/OK, pen 1,2/0,9, 3+T |
  | mug R/L | FAIL (tommel rører ikke), pen 1,1, palm 0,1 | FAIL (samme), pen 1,25, palm 2,2 | FAIL, pen 22/17 | FAIL, pen 3,2/17,9 |
  | carton R/L | FAIL (håndled 95°) | FAIL (samme) | FAIL (håndled 109°) | FAIL (håndled 104°) |
  Kun målt profil (uden models.js-override, mellemversion): VRM palm-gap 7–9 mm, 1–4 spidser, tommel rører ikke → Jimmy
  kræver den kalibrerede override (lav-poly LBS: fingerhuden trækkes ind ved bøjning mere end målingen kan se).
  Profiljustering i lab'en (CC): `PROFILE='{"size":1.15}'` → lukningen tror på en 0,228 m hånd: bone-modellen griber
  (score 24, palm 4 mm), men den rigtige 0,198 m hud går 16–19 mm ind → lukningen følger profilen, og en profil der ikke
  passer til meshet giver forkerte greb. `PROFILE='{"girth":1.3}'` → fingrene stopper ~0,5 mm tidligere, pen 0–0,6 mm,
  tommelen stopper 6–8 mm fra flasken (rører ikke). Enhedstesten viser det modsatte tilfælde: en 1,3×/1,4×-girth hånd med
  sin egen profil får ≥ 3 spidser uden gennemtrængning, mens den lille hånds greb går ind i den store hånd.
- Tests: ny `webxr-demo/tests/hand-profile.test.js` (6: måling af syntetisk hånd med kendte mål, overrides, profil-afhængig
  lukning på større/tykkere hånd, `placePalm`/tiers, entity `handProfile`/`setHandProfile`/version, søgningens stop).
  Demo `npm test` 147 → 153/153 (inkl. de 6 nye; 147 var før-tallet i denne session med andre agenters tests), studio 17/17,
  Contracts `npm test` 339/339, `test:hands` OK (33 PASS), `test:browser` OK, `test:interaction` OK.
  Contracts `tests/interaction-grasp-closure.test.mjs`: tommelen skal nu være inden for gradeGrasp's 3 mm (før 2 mm).
- Åbent / headset-test: mug (CLAMP_EXEMPT beholder rå tommel; VRM venstre 17,9 mm), carton (bake-håndled 95–109°),
  enkelte ikke-standard CC-beer-bakes (r180 højre krop 3,9 mm, hals 6,5–7,4 mm tommel-proksimal: median-pad
  undervurderer tommelens side), Jimmys venstre/højre-asymmetri (separat override pr. side), auto-profil alene er ikke nok
  på lav-poly VRM. Headset: VRM-greb i demoen (`?character=vrm`), runtime `setHandProfile` under spil, Quest-pris for mid.

### Lydsystem (`audio`) — kode færdig, afventer headset-test (2026-10-23)

- Ny extension `extensions/audio` (Web Audio voice-pool 16/32/48 pr. tier, HRTF på high, kontaktlyd efter materialepar og slagstyrke,
  loops, akustik-dæmpning via `acoustics.path`) + 160 nye lyde i `audio/` (contact-lyde for 7 materialer, hånd, fodtrin, slide, knirk).
  Opt-in: demoen `?audio`; bottles' `audio`-option kan bruge `createBottleAudioAdapter`. Se [audio_system.md](audio_system.md).
- Åbent: Quest (HRTF, AudioContext-unlock, pris), Contracts-kobling (`interaction/grab.js`) ikke lavet.

## Afklaringer og risici

- **Contracts `AGENTS.md`** siger "standalone game" og "character logic stays in packages/character-plugin". Brugeren har
  besluttet extension-retningen (denne plan); opdatér `AGENTS.md` i trin 2 (grasp) og trin 5 (karakter) så reglerne
  beskriver sync fra GameSystems. Samme fil kræver at subagenter bruger `openai-codex/gpt-6.1-sol`; det kan ikke vælges i
  Claude Code — sig det til brugeren i stedet for at skifte model i stilhed.
- Rediger aldrig genererede filer (`src/extensions/*` i Contracts, `character-cc/{vendor,assets}`, `vendor/three`, demoens `src/vendor`,
  `public/avatar-assets`). Skriv aldrig til `../CharacterCreator*`. Behold licens-attribution (MIT, CharacterCreatorXR).
- VRM-testmodel kræver download — få brugerens godkendelse af kilde og fil først.
- Quest hand tracking: kvalitet med hånd om en virtuel genstand og hånd+controller samtidig er ikke afprøvet.
- Ingen af ændringerne er afprøvet i et rigtigt headset endnu; IWER/puppeteer beviser ikke headset-adfærd.
- Tommelens akse (60°) er en antagelse; overvej at lade karakteren levere den, hvis en rig ser forkert ud.
- `GameSystems` er git-repo, men `webxr-demo` er usporet; Contracts er eget git-repo med ucommittede ændringer fra
  grebsrefittet (se grab_findings og `git status`). Commit/branch først når brugeren beder om det.

## Headset-test

Alle afventende Quest 3-tests (trin 4, 6, 7, 9 og 10) køres fra én side: bogmærket https://dionysus.dk/webxr/GameSystems/
→ LAN-hubben `https://<pc-ip>:8443/` (`tools/headset-lab`, start med skrivebordsgenvejen "GameSystems testlab"; ingen adb).
Svar gemmes i `docs/headset_results.jsonl`. Se [headset_testlab.md](headset_testlab.md).
