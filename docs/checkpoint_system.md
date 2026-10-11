# Checkpoints — samlet gem/indlæsning af brandstationen

Tilføjelse: brandstationens fire-provider komponerer nu også `supply` og `flow`, så donorens ledger,
emitterkvittering og vandvisning valideres samlet. `sprinklers` registreres som separat provider.
Derudover registreres `electricity` og `pump`, så pumpebatteri, ledninger, afbryder, sikring og energikvittering gemmes samlet.
`pool-interest` gemmer også søgefasen og cursors; pools bevarer aktiv udskiftningsrækkefølge og latent varme-prioritet.
Fire-provider validerer også coatings' geometry samt skumtank, valgt medie og dosis; blanket forbliver hos thermal/pools.
Væskeblanding, tankens ledger, hovedtemperatur, udløsning, ventil og fixed-step-fase bevares.
Ældre gemninger uden disse providers afvises atomisk. Se [supply_sprinklers.md](supply_sprinklers.md).

2026-10-10. En selvstændig, engine-uafhængig `checkpoint`-extension samler de enkelte systemers state-API'er.
Systemerne ejer stadig deres egne data. Browserlager, filvalg og præsentation ligger hos applikationen.

## Den spilbare brandstation

Åbn `/fire.html` fra `GameSystems/webxr-demo`. **Gem brandstation** gemmer i browserlageret;
**Indlæs gemning** virker også efter nulstilling eller genåbning af siden. **Eksportér fil** og
**Åbn gemningsfil** flytter gemningen som JSON. **Pause** giver mulighed for at inspicere og gemme et bestemt øjeblik.

En gemning kan foretages under aktiv hældning. Den bevarer:

- Rum: iltreserve, varme, røg og dør-/vinduesåbninger.
- Termiske objekter: temperatur, brændstof, flammer, vådhed, skum, varmeforbindelser, fast-step-fase og resterende tid på spil-ladninger.
- Pytter: volumen, sammensætning, kilder, temperatur og forbrug; også tomme, endnu varme spor.
- Beholderen: beholdning, type/farve, blanding, pose, hastighed, hold-status og eventuelle lækagehuller.
- Dråber i luften samt hældestrømme og modtagne synlige pytter i kilderuntime.
- Mekanik: koordinat, hastighed og låsestatus.
- Applikation: vandreserve, igangværende hældning, pause, målstatus, valgt genstand, tidsskala og kvalitet.

Gemningen kan indlæses efter yderligere hældning. Den gamle begrænsning om samme beholdning er fjernet.
En ugyldig fil ændrer ikke den aktive scene. Ved en runtime-fejl under commit forsøger koordinatoren rollback;
en ufuldstændig rollback rapporteres som fejl, frem for som en vellykket indlæsning.

## Public API og kontrakt

```js
const checkpoints = await host.load(checkpointExtension, { sceneId: 'fire-station-v1' });
checkpoints.register('fire', createFireSceneProvider({
  thermal, pools, bottles, mechanics,
  application: {
    capture() { return applicationState; },
    prepareRestore(data, context) {
      // Valider hele ændringen. Forberedelse ændrer ikke live state.
      return {
        commit() { /* anvend validerede data synkront */ },
        notify() { /* opdatér UI og effekter efter alle commits */ },
      };
    },
  },
}));
const saved = checkpoints.capture();
const text = checkpoints.encode(saved);
checkpoints.restore(checkpoints.decode(text));
```

`createCheckpointSystem` kan bruges uden host eller rendering. Providers skal have `capture()` og
`prepareRestore(data)`. Planens `commit()` er obligatorisk; `notify()` og `dispose()` er valgfrie.
Capture, forberedelse og commit er synkrone. De deklarerede async-varianter afvises, og provider-kode må ikke
planlægge senere tilstandsændringer fra en restore-plan.

Koordinatoren validerer schema, scene-id, providers, JSON-data og bytebudget (standard 2 MiB), inden den anvender noget.
Den forbereder alle nye tilstande og rollback-planer før første commit. Observers aktiveres først efter et samlet commit.
En observer-fejl ændrer ikke et ellers vellykket restore; den rapporteres i `observerErrors`.
`checkpoint:restored` og `checkpoint:cleanup-error` giver signaler til værten.

`checkpoint/fire-scene.js` er composition gennem public API'er, ikke import af systemernes interne filer.
Den kontrollerer også, at pool-/thermal-data er enige, og at observeret kildevæske ikke overstiger kildens ledger.

## De enkelte ejere

| System | Snapshot / restore |
|---|---|
| thermal | `capture`, `prepareRestore`, `restore`; schema `gamesystems.thermal.v1` |
| pools | `save`, `prepareRestore`, `restore`; schema `gamesystems.pools.v1` |
| bottles | `capture`, `prepareRestore`, `restore`; schema `gamesystems.bottles.v1` |
| mechanics | `capture`, `prepareRestore`, `restore`; schema `gamesystems.mechanics.v1` |
| checkpoint | `capture`, `restore`, `encode`, `decode`; schema `gamesystems.checkpoint.v1` |

Thermal forbereder rooms/objects/vents/links uden at ændre verden og bevarer sin faste tidsfase.
Pools kan bruge en forberedt thermal-plan, så de ikke overskriver den samme termiske state igen.
Det forhindrer både dobbelt antændelse og ekstra debitering af kilder ved indlæsning.

Beholdere bør have et stabilt `bottle.checkpointId`, eksempelvis `diesel-can`. Restoren kræver samme indlæste,
autoriserede modeltopologi. Flader bruger stabile `userData.materialId`; ellers er mesh-uuid kun egnet i den samme scene.
Checkpoint-data indlæser ikke vilkårlige GLB-filer. Ruder skal have stabile, unikke pane-id'er. Deres logiske brud-,
skade-, revne- og hulstate gemmes med flaskernes state; kortlivede glasskår ryddes ved restore.
Knuste/fjernede beholdere ændrer flaskeinventaret og kræver
fortsat en asset-/destruktions-state-owner. Bottle-checkpointet afviser mismatchet inventar før commit.

Positions-/hastighedsdata genskabes gennem fysikadapterens public API. Backendens interne kontaktcaches indgår ikke.
Præsentationscaches regenereres: eksempelvis røgpuffernes præcise mønster og shaderens dekorative bevægelse.
Røgens logiske masse og sigtbarhed består, og tætte rum får straks en budgetbegrænset røggrafik igen.
Aktuelle grab-inputs neutraliseres ved mekanik-restore; en gemning afspiller ikke tidligere håndinput.

Logical flights bevares også på en lavere grafikkvalitet. Render-budget og stride anvendes straks,
så pause/indlæsning ikke midlertidigt viser alle gemte dråber på minimal kvalitet.

## Verifikation af checkpoint-milepælen — historisk baseline (2026-10-10)

- **17 nye unit-/integrationstests** blev tilføjet i `webxr-demo/tests/checkpoint.test.js`: samlet restore, korrupt data,
  rollback, observerfejl, schemas/budgets, fasefortsættelse, væskeidentitet/farve, strømme, lækagehuller,
  quality-budgetter, lifecycle, ændret inventar og synkrone kontrakter.
- **80/80 målrettede systemtests** bestod.
- Ved milepælen bestod **170/170 GameSystems-tests** og **339/339 Contracts-tests** efter standardsynkronisering.
  Senere resultater står i [game_systems_implementation.md](game_systems_implementation.md).
- Produktion: `npm run build` bestod.
- **8/8 checkpoint-browserkontroller** bestod: faktisk mid-pour-gemning, mere hældning og nulstilling,
  sidegenindlæsning, filimport, ugyldig fil, faktisk fildownload og videre hældning med balanceret volumen.
- Øvrige browserkontroller ved milepælen: **13/13 brandscenarier** og **12/12 system-/flaskescenarier**.

```powershell
cd C:\Devstuff\GameDev\GameSystems\webxr-demo
npm run build
npm run test:checkpoint:browser
```

Resultater, JSON-fixtures og screenshots: `webxr-demo/test-results/checkpoint/`.
Kontrollen er udført i Chrome/SwiftShader. Headset-performance og fysisk controlleraccept er fortsat ikke etableret.

## Pool-budget opfølgning

Pool-budgettets tidligere tab af ny væske er rettet. Checkpoints bevarer nu også hvilende poster uden termiske noder,
med oprindelse, sammensætning, position, varme/vådhed og aktiv status. Se [pool_budget.md](pool_budget.md).
