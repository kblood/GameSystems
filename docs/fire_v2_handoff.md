# Brand v2 — samspil med den anden væske-agent

2026-10-10. Nye filer: `extensions/thermal/fire.js`, `extensions/pools/*`, `extensions/smoke/index.js`.
Thermal/index.js bevarer det gamle public API og eksporterer den udvidede kerne.

Ændringer i flaskernes kode er additive:

- `PourSystem.burnedMl`, `consumePuddleVolume(ml, {surfaceId, position})` og udvidet `ledger()`.
- `createBottleSystem.consumePuddleVolume` videresender til PourSystem.
- `bottles:reset` giver den vedvarende pool-owner mulighed for at nulstille.
- Farveblanding, absorbance, shader og `_mergePuddles` er bevaret.
- `liquid_components.js` og additive `flight.components` / `liquid:deposit.components` bevarer ml pr. væsketype,
  også når en lav quality-tier samler dråber. Flasker bruger `liquidComposition` som fraktioner efter blanding.

`pools` observerer `liquid:deposit` med deklareret væsketype. `connectBottlePools` kobler faktisk forbrændt volumen
til flaskernes ledger; render-budgettet ejer ikke længere gameplay-pytternes levetid. De logiske pytter kan gemmes som JSON.
Dette er én pool-owner pr. flaske-runtime; læg ikke den observerede pool-volumen oven i flaskernes world ledger.

`unknown`/`mixed` bliver ikke gættet som diesel eller vand. Deklarér dunkens `bottle.liquidKind='diesel'` i værten.
Poolblandinger og nye mixed-dråber bevarer deres komponenter. Gamle snapshots, som kun siger `mixed`, gætter ikke brændstof.

Brændstofpytternes tal er gameplay-profiler. Rummets ilt/røg er reservoirs, ikke CFD. Røggrafikken er en separat
instanced, budgetbegrænset visualisering og ændrer ikke brandudfald ved kvalitetsskift.

## Forbedringsrunde — historisk snapshot (2026-10-10)

Nye public API'er/fields: `thermal.replaceObjects`, `thermal.hasObject`, `bottles.sourceKey`,
`bottles.removePuddleVolume`, `ledger.removedMl`, `pools.sources`, `pools.has` og `sourceVolumes` på pool-events.
Helpers i pools: `snapshot.js` og `provenance.js`. Farve-/shader-/absorbance-koden er fortsat bevaret.
Brændstof, kilder og fjernelse bogføres separat. Snapshot-validering og termisk configure er atomiske.
Spredningsgrafen bruger stabil id-rækkefølge frem for objekternes indlæsningsrækkefølge.

Kontrol efter standardsynkronisering af de genererede Contracts-filer fandt følgende håndregressioner:

- `GameSystems/webxr-demo/tests/character-vrm.test.js:162`: real-model-grebet gav `left: deepest pad -7.894750922718333 mm inside`
  mod grænsen på 4 mm. Samlet suite: 146/147.
- `NightfallContractsWebXR-interaction/tests/interaction-grasp-closure.test.mjs:58`: `bottle_beer/left x1.00 Thumb touches (2.3 mm)`.
  Samlet suite: 338/339.

Ved disse checks blev `closure.js` og `handprofile.js` ændret af det samtidige håndarbejde.
Brand-/pool-testene bestod (63/63 målrettede checks), og begge demo-browserkontroller bestod (13 brand, 12 system).
Dette er fund til håndarbejdet; denne runde har ikke rettet de igangværende hånd-/grasp-kilder.

## Checkpoint-runde 2026-10-10

Nye moduler: `checkpoint/index.js`, `checkpoint/fire-scene.js`, `host/state.js`, `thermal/state.js`, `bottles/state.js`.
Public `capture/prepareRestore/restore` findes på thermal, mechanics og bottles; pools har `prepareRestore`
og kan koble sig til en samlet thermal-plan. Ledger- og farve-/absorbance-adfærd består.
Flights og strømme kan genskabes uden nye deposition-events. Antallet af logiske flights bevares ved lavere quality,
mens renderingens cap/stride anvendes straks. Pane/debris-state kræver en særskilt state-owner og afvises af kilde-checkpoints.

Brand-labbens tidligere session-only-pool-save er erstattet af en fuld checkpoint-composition og JSON-fil/browserlager.
Kontroller ved handoff 2026-10-10 (historisk snapshot): 170/170 GameSystems, 339/339 Contracts,
8 checkpoint-browser-, 13 brand- og 12 systemscenarier. Nyere løbende kontroller føres i
`docs/improvement_backlog.md` og systemernes aktuelle implementeringsguider.

Pool-admission ved fuldt budget er nu rettet: 40 af 60 ml bevares som hvilende logiske poster,
mens termiske noder og grafik stadig begrænses. Se [pool_budget.md](pool_budget.md) for API og integration.
