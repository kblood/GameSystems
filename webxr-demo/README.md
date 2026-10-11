# Flaskedemo i WebXR

De fire systemdemoer bevarer runtime ved cachet side-navigation og suspenderer rendering/simulation under skjulning.
Se [page-lifecycle](../docs/page_lifecycle.md); browserkontrol: `npm run test:lifecycle:browser`.

## Bil og kontrolrum

`/vehicle.html` viser den originale Blender-bil med PBR, syv åbnelige dele, endeligt brændstof/batteri
og skift mellem fælles systemadaptere, simple stores og deaktiverede afhængigheder.
Se [bilens API og Blender-kilde](../docs/vehicle_system.md).
Vehicle Lab kan også gemme kørsel, animationer og alle reservekilder til browserlager/JSON;
se [vehicle-checkpoint](../docs/vehicle_checkpoint.md) og `npm run test:vehicle-checkpoint:browser`.
`/security.html` demonstrerer skift mellem tre kamerafeeds på en fysisk skærm med kvalitet og endeligt demobatteri.
Se [kamera-/skærm-system](../docs/camera_system.md).
Browserkontroller efter build: `npm run test:vehicle:browser` og `npm run test:cameras:browser`.

Brandstationen har også en selvstændig sprinkler med genopfyldelig væskeforsyning;
se [forsyning og sprinkler](../docs/supply_sprinklers.md).

## Brandstation

Skum bruger nu en endelig 600 ml-tank og [overfladedækning](../docs/coatings_system.md) efter dosis, areal og orientering.
Browserkontrol: `npm run test:coatings:browser`.

Slangen har en genopfyldelig supply-tank og en selvstændig [flow-extension](../docs/flow_system.md).
Hold med mus/tastatur, eller brug controller-aim i XR. Release/fokus-tab/pause/load stopper input.
Browserkontrol: `npm run test:flow:browser` (controller-events/poses simuleres; ikke fysisk headset-test).

`/fire.html` demonstrerer brandspredning, materialebrændbarhed/antændelsestemperatur, røg under loftet,
rumilt og døre/vinduer, vand/skum, vedvarende dieselpytter fra den eksisterende dunk og en abstrakt spil-ladning.
Se [brandsystem v2](../docs/fire_system.md). Browserkontrol: `npm run build`, derefter `npm run test:fire:browser`.
De normale væskefarver og blandinger er bevaret; brændstofkomponenter og forbrug føres separat.
Brandstationen har nu komplette checkpoints med browserlager, filimport/-eksport og pause, også under hældning.
Se [checkpoint-kontrakten](../docs/checkpoint_system.md); kør `npm run test:checkpoint:browser` efter et build.

## System-lab

`/systems.html` er et separat værksted med mekanik, strøm, overfladereaktioner, varme/ild, værktøjer og lyd mellem rum.
Åbn skuffen, flyt sikringen fysisk til holderen, drej kontakten og åbn døren. Test også ventil/vand/slukning,
kortslutning, skruetrækker og hammer. Labben bruger fælles extensions og kræver ingen karakteraktiver.
Se [API og testresultater](../docs/game_systems_implementation.md). Kør `npm run build` og derefter
`npm run test:systems:browser` for browserkontrol af begge demoer. Headset-kontrol er endnu ikke udført.

Flaskedemoen kobler nu faktisk spild til materials-extensionen, som ændrer modtagende overfladers udseende og friktion.

En selvstændig browserudgave af den samlede Godot-demo i `../demo/main.gd`. Den indlæser de samme 20 hyldegenstande, 9 bargenstande og tre ruder fra GameSystems' eksisterende eksport. Godot-projektet og eksportfilerne ændres ikke.

## Start lokalt

Kræver Node.js 20.19+ eller 22.12+ og PowerShell 7 til deployment.

```powershell
cd C:\Devstuff\GameDev\GameSystems\webxr-demo
npm install
npm run dev
```

Åbn adressen som Vite viser, normalt `http://localhost:5173/`. Første indlæsning kan tage lidt tid: 29 GLB-modeller og væsketabeller skal hentes. Åbn udviklerkonsollen, hvis en model fejler. `npm run build` kopierer de anvendte GLB, design, sidecars og OGG-filer til `dist/assets`; `npm run preview` viser buildet.

Buildet bruger relative stier og ligger på [https://dionysus.dk/webxr/flaskedemo/](https://dionysus.dk/webxr/flaskedemo/). Den afsluttende skråstreg i adressen er nødvendig for korrekt opløsning af assetstier. Udgiv ændringer fra PowerShell 7 med `./deploy.ps1`; scriptet bygger, uploader til staging, skifter atomisk og kontrollerer sidens filer over HTTPS. `./deploy.ps1 -VerifyOnly` kontrollerer den live-udgave uden at bygge eller uploade.

WebXR kræver en kompatibel browser og en sikker kontekst. `localhost` virker normalt til lokal udvikling; på et headset via netværket skal siden serveres over HTTPS. Vite-udviklingsserveren er ikke en produktionsserver. Brug gerne `npm run build` og servér `dist` via HTTPS, når du tester på headset. Den aktuelle udgave er udgivet på adressen ovenfor.

## Styring

| Desktop | Handling |
| --- | --- |
| Klik | Lås musen; klik igen for at ramme genstande og ruder |
| WASD, Space, C | Flyt rundt |
| Mus | Kig rundt |
| G | Grib eller slip genstand under sigtet |
| Hjul eller Z/X | Vip genstanden i hånden |
| U | Åbn/luk beholder under sigtet eller i hånden |
| E eller højreklik | Kast den holdte genstand; ellers slag/impact |
| R, P, 1–4 | Nulstil, pause, kvalitet |
| Esc | Frigør musen |

I VR bruges grip til at gribe/slippe, trigger til impact eller menuknapper, venstre stick til at flytte og højre stick til trinvist at dreje. Håndsporing kan bruge pinch til at gribe/slippe, hvis headset og browser sender WebXR `select`-hændelser. Den lille menu over hylderne har nulstil og kvalitet. For at hælde skal beholderen være åben og vippes over en anden beholders munding; ellers samles væsken i en pyt.

## Implementering og grænser

Browserkontrollerne bruger `scripts/smoke-cleanup.mjs` til fælles oprydning. Browser og
dedikeret testserver lukkes samtidigt. Browser.close får normalt 5 sekunder; ved timeout
eller protocol-fejl må helperen kun kill'e den ChildProcess, Puppeteer selv lancerede,
med bekræftet Chrome/Edge-executable og Puppeteer-temp-profil. Termination kontrolleres
inden for 2 sekunder, og klient-disconnect har også en 2-sekunders grænse. En remote
browser uden ChildProcess bliver kun frakoblet. Ubekræftet proces eller mislykket cleanup
giver en eksplicit fejl frem for at kill'e andre browsere eller skjule problemet.
`npm run test:cleanup:browser` simulerer hængende graceful close på en rigtig headless
testbrowser og kontrollerer termination samt genbrug af serverporten. Det tester ingen
spiladfærd eller fysisk headset-performance.

- Three.js `0.170.0`, Cannon-es `0.20.0` og Vite `8.3.3` er låst i `package.json`.
- `src/vendor/extensions` er genererede kopier af GameSystems-extensions (se "Distribution"). Væske-shaderen, LUT'en og design-helperen ligger i `../extensions/bottles` (siden extensions-trin 8; `../shaders/three/*.js` og `../designs/three/bottle_design.js` re-eksporterer dem). Kør `npm run sync` efter ændringer; build gør det også automatisk.
- Væskeshaderen tegner overfladen og slosh. `src/pour.js` trækker faktisk ml fra kilden og lægger dem i en modtager eller pyt. Shaderens LUT sænker kun den synlige overflade til kanten; den ændrer ikke selv beholdning. `PourSystem.ledger()` kan bruges til at inspicere beholdningen i konsollen under fejlsøgning.
- Kollisionsformer for hele beholdere er tilnærmede cylindre. Ruder brydes ved projektil eller passage af en kastet genstand. GLB-skår og rudefragmenter får individuelle, tilnærmede Cannon-kollisioner og arver flaskens fart og rotation; shard-collidere bruger modellens boundingbox-center.
- Kollisionsimpacts samles pr. genstand og behandles efter Cannon-trinnet og synkronisering af positioner. Brud kan derfor fjerne en flaske uden at ændre Cannons liste af kroppe under kollisionsbehandlingen.
- Beholdere med `liquid_sidecar` i kataloget henter præcis den fil. Mangler filen, giver indlæsning og build en fejl med filens sti. Ældre flasker bruger fortsat helperens væsketabel-fallback, og designmodeller bruger indlejrede tabeller.
- PET-genstande knuses ikke som glas. Et projektil giver i stedet en lækage. Kvalitetsniveauer ændrer opløsning, skygger, slosh og bobler; den eksisterende Three.js-væskeshader har kun sin HIGH-rendersti implementeret.
- Fysisk headset-test er endnu ikke udført her. WebXR-knapper, greb, håndtracking og sticks afhænger af browserens og headsetets inputprofil.

Bygget henter kun det katalogudsnit, som `src/lineup.js` bruger. `scripts/copy-assets.mjs` læser `../catalog.json` og kopierer disse kildefiler deterministisk. Ændrer du lineup, tager næste build de nye katalogaktiver med.

## Extensions og avatar

Valgfrie systemer er extensions efter kontrakten i `../extensions/host` (se `host.js`): `{ id, requires, quality, init(ctx), update(dt), setQuality(tier), dispose() }`. Kernen (`main.js`, `interaction.js`) sender hændelserne `grab`, `release`, `xrStart`, `xrEnd`, `disconnect` og `handTrackingChanged`, og bottles-extensionen (`../extensions/bottles`: fabrik, væske, hældning, brud, lyd, ruder; kun via fysik-adapteren, steppes fra `physics.onStep`; niveauer minimal/lav/mellem/høj) sender `broken`; extensions reagerer og kan ikke vælte spillet (fejl i `init`/`update` logges, og extensionen fjernes). Det globale kvalitetsniveau 0–3 fordeles på hver extensions niveauer; for avataren er `minimal` = slået fra (skjult, ikke opdateret), `lav` = plugin'ets low-preset, `mellem`/`høj` = fuld. Low/high vælges når avataren indlæses; senere skift slår den kun til og fra.

- **Distribution:** som `shaders/three`. `npm run sync` (kører også før `dev`, `test` og `build`) kopierer `../extensions/host`, `../extensions/adapters` og `../extensions/bottles` (m.fl.) til `src/vendor/extensions` (genereret, gitignored, ret i GameSystems). Kun ændrede filer skrives.
- **Fysik:** `src/physics.js` bygger på `../extensions/adapters/physics-cannon.js`, som også er `ctx.physics` for extensions.
- **Avatar:** `src/avatar.js` er en extension, som `main.js` indlæser med dynamisk `import()`. Den bruger GameSystems-extensions `avatar` (VRIK, fingre, rest-hånd), `humanoid` og `character-cc` (CharacterCreator-karakteren) samt bagte greb fra `grasp`, som `npm run sync` kopierer til `src/vendor/extensions`. character-cc's genererede CharacterCreator-moduler og aktiver hentes fra Contracts' `src/extensions/character-cc/{vendor/cc,assets}` (`../../NightfallContractsWebXR-interaction` eller `CONTRACTS_DIR`; et MIT-snapshot, CharacterCreator selv er GPL fra 2026-10-03) til `src/vendor/extensions/character-cc/vendor/cc` og `public/avatar-assets` (genereret, gitignored; koden er MIT, aktiverne CC0 – se `public/avatar-assets/asset_licenses.json` og `src/vendor/extensions/*/LICENSE-NOTES.md`). Kvalitet: low = kun hænder og arme (avatar 'arms'), high = fuld krop.
- **Uden Contracts:** sync advarer kun, `src/contracts.js` erstattes i buildet af `src/contracts-missing.js`, og demoen kører med de almindelige controller-modeller. Avatar-testene springes over. `$env:REQUIRE_CONTRACTS=1; npm run build` fejler i stedet, hvis Contracts mangler (brug det ved deploy, hvis avataren skal med).
- **Avatar-aktiver:** kun de filer avataren i `src/avatar-config.js` henter, kopieres (ca. 11 MB i stedet for 28 MB). `$env:AVATAR_ASSETS="all"; npm run sync` kopierer alt.
- `?avatar=0` eller `?avatar=off` starter uden avatar.
- **Optagede greb:** greb optaget i Grasp Studio (`../apps/grasp-studio`) gemmes i `../extensions/grasp/recorded_grasps.json` og flettes ind i det bagte bibliotek af `baked_grasps.js`; et optaget greb markeret som standard erstatter det bagte standardgreb. Kør `npm run sync` (eller genstart `npm run dev`) efter en optagelse. `tests/recorded-grasp.test.js` viser vejen fra studiets endpoint til demoens grasp-kopi.
- **Sync-kode:** `scripts/sync-helpers.mjs` bruger den fælles `../scripts/sync_lib.mjs` (samme som Grasp Studio).
