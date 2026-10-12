# Selvstændige gamesystems — implementation og brug

Dato: 2026-10-10. Første version til Three.js/WebXR, med engine-uafhængige simulationskerner.
Idéer og acceptkriterier: [game_system_ideas.md](game_system_ideas.md).

Brandsystemet er siden udvidet med ilt/røg pr. rum, materialebrændbarhed, vedvarende brændstofpytter og en bygningsdemo.
Se [brandsystem v2](fire_system.md) for det aktuelle API, afgrænsninger og nye testresultater. Afsnittene nedenfor
beskriver fundamentet fra første implementation.

## Moduler

| Extension | Public API | Events |
|---|---|---|
| `mechanics` | `add`, `state`, `setValue`, `setLocked`, `drive`, `grab`, `moveHand`, `release`, `releaseAll`, `step`, `remove` | `mechanics:changed`, `mechanics:lock`, `mechanics:stop` |
| `electricity` | `add`, `state`, `setEnabled`, `replaceFuse`, `evaluate`, `step`, `remove` | `electricity:changed`, `electricity:fuse-blown`, `electricity:fault` |
| `materials` | `add`, `state`, `wet`, `clean`, `ledger`, `reset`, `step`, `remove` | `materials:changed`, `materials:wetted` |
| `thermal` | `add`, `state`, `connect`, `connectNearby`, `ignite`, `addHeat`, `setHeater`, `water`, `step`, `remove` | `thermal:changed`, `thermal:ignited`, `thermal:extinguished`, `thermal:cooled` |
| `tools` | `add`, `state`, `hold`, `release`, `use`, `insert`, `removePart`, `forgetPart`, `releaseAll`, `remove` | `tools:changed`, `tools:installed`, `tools:removed`, `tools:impact` |
| `acoustics` | `addRoom`, `addPortal`, `setPortal`, `addListener`, `moveListener`, `path`, `sound`, `step`, `removeRoom`, `removePortal`, `removeListener` | `acoustics:heard`, `acoustics:dropped` |

Godot also has native bottle/liquid storage and a first bounded fire/thermal vertical slice;
see [native puddles](native_puddles.md) and [Godot thermal](godot_thermal.md). The native
kernel is intentionally smaller than the WebXR thermal extension; sprinkler scheduling and
spatial fire spread remain follow-up work.

For VR implementation, controllers, IK/avatar scale, active ragdolls, NPCs and performance,
see the [VR guide index](vr/README.md).

The native Godot sprinkler layer composes finite typed supplies, room fire state and an optional
battery pump adapter. Thermal, supply, battery, pump and sprinkler states expose versioned
checkpoints which the host captures at one paused save boundary. A future native power grid can implement the same provider contract; see
[Godot sprinklers](godot_sprinklers.md).

Alle kerner har `setQuality`, `quality` og `dispose`. Alle moduler eksporterer en default extension-factory samt en navngiven
`create…System`. Kilde: `extensions/<id>/index.js`. Kun den fælles, offentlige host-helper `extensions/host/system.js` importeres
af kernerne; de importerer ingen rendering- eller physics-engine og ingen søstersystems interne filer.

`extensions/workshop/index.js` er en valgfri composition med alle seks systemer som eksplicitte afhængigheder. Den
registrerer scenariets objekter og kobler dem via public API og events. Ved unload eller fejl midt i init fjernes kun
ressourcer, som scenariet nåede at oprette: objekter, rum, portaler og lytterevents. Eksisterende objekter med samme ID
bevares, så en senere load kan lykkes, når ID-konflikten er løst.

## Indlæsning

```js
import { createHost } from './extensions/host/index.js';
import mechanics from './extensions/mechanics/index.js';
const host = createHost({ quality: 2 });
const m = await host.load(mechanics, {
  applyPose(id, pose, state) {
    // Værten opdaterer sit renderobjekt eller sin fysikadapter her.
  },
});
m.add('drawer', { axis: [0, 0, 1], max: 0.5 });
m.grab('drawer', 'left-hand', [0, 0, 0]);
m.moveHand('drawer', 'left-hand', [0, 0, 0.3]);
host.update(1 / 60); // kun én update-kilde; kald ikke også m.step med samme tid
m.release('drawer', 'left-hand');
host.dispose();
```

Spil synker de flade moduler på samme måde som eksisterende extensions. `webxr-demo/scripts/sync-helpers.mjs` tager
alle seks samt workshop med. Et andet spil behøver kun at synke de systemer, det bruger, og `host`.

## Mekanik

`add(id, {kind, origin, axis, min, max, value, inertia, resistance, damping, spring, rest, locked})`.
`kind` er `slider`, `hinge` eller `valve`. Lineær koordinat er meter; roterende koordinat er radianer.
`drive(id, owner, force)` anvender kraft i N eller moment i Nm. Flere ejere summeres, så to hænder kan hjælpe
eller modarbejde hinanden. `grab/moveHand` omregner håndpositioner til en begrænset målkoordinat og fjederkraft.
Ejere er lokale for hvert mekanisme-id, så id'er og ejernavne må gerne indeholde kolon uden at kollidere;
fjernes en mekanisme, ryddes kun dens egne greb. Låse stopper bevægelse; mekaniske endestop nulstiller
hastighed og udsender stødenergi.

Det er en analytisk frihedsgrad med modstand og dæmpning. Værten skal forbinde output til sine collidere og beslutte,
hvordan omgivende objekter påvirker mekanismen. Labben driver synlige 3D-objekter; den er ikke en fuld rigid-body-ledsolver.

## Elektricitet

`add(id, {kind, a, b, resistance, voltage, enabled, rating})` registrerer en komponent mellem terminal-id'er.
`kind`: `source`, `wire`, `switch`, `fuse`, `load`. Resistans er ohm, spænding volt og sikringsrating ampere.
Ledninger og lukkede kontakter har lille positiv resistans. `setEnabled` åbner/lukker en forbindelse.
Modified nodal analysis understøtter serier, parallelkoblinger, flere idealspændingskilder og separate øer.
`state` giver `current`, `volts` og `power`; kildeeffekt er negativ ved forsyning, så summen kan kontrolleres.
Overlast springer en sikring og genberegner nettet; den forbliver sprunget indtil `replaceFuse`.
Inkompatible idealspændingskilder udsender `electricity:fault`, og den berørte ø forbliver uden leveret effekt.

Nettet genberegnes kun efter ændringer. Modellen er resistiv DC uden batteriafladning, AC, induktion eller elektronik.

## Materialer og kobling til flasker

`add(id, {material, capacityMl, dryRate, dryFriction, wetFriction, stainRetention})` bruger presets
`wood`, `metal`, `concrete`, `fabric`. `wet(id, ml, {kind, stain})` fordeler væske mellem tilbageholdt volumen og runoff.
`step` tørrer i ml/s. `state` giver vådhed, plet og interpoleret friktionskoefficient.
`ledger` balancerer tilbageholdt, fordampet og runoff; `reset` starter en ny observationsperiode.
`applySurface(id, state)` forbinder til shader/materiale/fysik hos værten.

Flaskernes `PourSystem` udsender nu **`liquid:deposit`**, når en rigtig væskedråbe rammer en modtagende vandret flade:

```js
{
  surfaceId, thermalId, position: [x, y, z], ml,
  kind: 'water' | 'wine' | 'mixed' | 'unknown', sourceId, stain
}
```

Værten sætter `surface.userData.materialId` og eventuelt `thermalId`. En flaske kan deklarere `bottle.liquidKind = 'water'`.
Udeklareret væske er `unknown` og behandles aldrig automatisk som slukningsvand. Blandede dråber under et effektbudget
markeres `mixed`; modtagelse af en anden væsketype blander også beholderens type.
Det nye event observerer depositionen: flaskesystemets ledger er stadig den autoritative volumen og ændres ikke af wetting.
Materialernes ledger er en lokal reaktionsmodel, som **ikke** lægges oven i flaskernes verdensvolumen.

Den oprindelige flaskedemo registrerer sine flader i materials-extensionen og ændrer faktisk friktion og udseende ved spild.
Cannon-adapterens valgfrie `setFriction(handle, coefficient)` kombinerer kontaktflader som `sqrt(muA * muB)`.
Det obligatoriske physics-interface er uændret. Cannon er en tilnærmet spilsolver; realistiske glideafstande kræver kalibrering.
Integrationstesten sammenligner en tør flade med den ideelle friktionsfri, fuldt smurte grænse.

## Varme og ild

`add(id, {position, temperature, heatCapacity, fuelJ, ignition, burnPower, cooling})` bruger °C, J/K, J og W.
`connect(a, b, conductance)` forbinder to legemer med W/K. `connectNearby` bygger forbindelser fra registrerede positioner.
Varmeudvekslingen bruger stabil, parvis eksakt integration og bevarer energi i et lukket, ikke-brændende net.
Brændstof er endeligt; varme kan antænde naboer. `water(id, ml)` køler og efterlader en midlertidig vådhed,
der hæmmer genantændelse. `setHeater` gør det muligt for værten at koble en elektrisk forbrugers effekt til opvarmning.
Kun `liquid:deposit` med `kind: 'water'` køler automatisk et deklareret `thermalId`.

Fundamentet her beskriver samlede objekttemperaturer og deklarerede varmeforbindelser. Den senere brandversion har
tilføjet samlet ilt-, varme- og røgniveau pr. rum, udveksling gennem åbne ventiler, brandspredning mellem forbundne
brændbare objekter samt vedvarende brændstofpytter; se [brandsystem v2](fire_system.md). Modellen løser stadig ikke
luftstrømme eller brandspredning kontinuerligt ud fra mesh-geometri. Labben viser flammer med kvalitetsstyret detaljeantal.

## Værktøjer og samling

`add(id, {kind, position, axis, radius, angleTolerance, requiredWork, partType})`: `screw`, `nail`, `socket`.
`use(id, {tool, position, axis, rotation, energyJ})` afviser forkert værktøj, afstand eller akseretning.
En skrue akkumulerer omgange (`rotation` er radianer); negativ rotation skruer ud. Et søm akkumulerer impactenergi.
`hold(partId, owner)` sikrer eksklusiv ejer. `insert` kræver korrekt type, ejer, nærhed og orientering.
En fysisk del kan kun være i én socket; den må fjernes via `removePart`, før den kan gribes igen.
Socket-tilstand bliver installeret gennem `insert`; `add(..., {installed:true})` er kun gyldig for skruer og søm,
så en socket aldrig kan starte installeret uden en fysisk `partId`.

Labben flytter sikring og værktøj i 3D. Hammerens bevægelse estimerer impactenergi; musens hjul eller VR-vrid/trigger
driver skruetrækkeren. Kernerne forventer faktiske kontakt-/poseinput fra værtens interaktionssystem.

## Lyd mellem rum

Rum registreres med `addRoom`. `addPortal(id, {a, b, position, open, closedLossDb, openLossDb})` forbinder dem.
`setPortal` kan følge en mekanisk dørs åbningsgrad. `addListener(id, {room, position, thresholdDb, receive})`
registrerer lydafspilning eller en NPC's stimulusindgang.
`sound({room, position, db, kind, sourceId})` vælger den vej med mindst portaldæmpning, dæmper derefter med afstand
og køer modtagelse med afstand / lydhastighed. Ingen forbindelse betyder ingen lyd.
`maxPending` (standard 128) begrænser ventende events. Budgetoverskridelse udsender `acoustics:dropped`.
`step` forsøger alle forfaldne listener-callbacks og `acoustics:heard`-events, selv hvis en callback kaster, og kaster
derefter den første fejl videre; en reentrant `step` afvises, så allerede forbrugte cues ikke springer over.

Modellen erstatter ikke bølgeakustik, rumklang eller generel lydmotor. Labben afspiller en kort rumlig WebAudio-tone
og viser en navngiven AI-lytters dB-stimulus. NPC-integration i andre spil sker via `receive`.

## Demo og verifikation

```powershell
cd C:\Devstuff\GameDev\GameSystems\webxr-demo
npm run dev
# Åbn Vites adresse efterfulgt af /systems.html
npm test
npm run build
npm run test:systems:browser
```

Browser-testen kræver installeret Chrome/Edge (eller `CHROME_PATH`) og genbruger workspace-QA-afhængigheden
`puppeteer-core` fra `NightfallContractsWebXR-interaction`. Denne søsterafhængighed gælder kun QA-scriptet;
den byggede system-lab har ingen runtime-afhængighed til Contracts eller karakteraktiver.
Rapport og screenshots: `webxr-demo/test-results/systems/` (genereret, gitignored).

Automatiske kerne-/integrationstests dækker mekaniske stop og to ejere, Kirchhoff/effektbalance og sikringer,
væskebalance, pletter, stabil varmeoverførsel, antændelse/slukning, værktøjsgates, unik delplacering,
portalveje og forsinkelse, kvalitetsændringer samt unload/reload og cleanup.
Browser-testen arbejder mod produktionsbuildet og bruger faktiske musehandlinger til sikring, skruetrækker og hammer.

## Seneste verifikation (2026-10-11)

- GameSystems `npm test`: **464/464 bestået**.
- Produktionsbuild: bestået; både flaskedemo og system-lab indgår. Eksisterende avatar/VRM-chunk-advarsler består.
- System-labbens produktionsbrowserkontrol: **12/12 scenarier bestået**, uden browserfejl eller HTTP-fejl.
  Omfatter faktisk sikringsflytning, lampe/dørlås, lydforsinkelse, ventil/vand/slukning, sikringsoverlast,
  skruetrækker, bevæget hammer, kvalitetsskift, tre reset, 29 beholdere og faktisk væskedeposition med bevaret
  ledger. Rapport: `webxr-demo/test-results/systems/report.json`.
- Fysisk headset-test og headset-performance: **ikke udført**. WebXR-controllerinput er implementeret,
  men desktop-browserkontrol etablerer ikke VR-komfort eller hardwareaccept.
- Native Godot-porte og integration i Nightfalls missioner er fortsat senere opgaver.
