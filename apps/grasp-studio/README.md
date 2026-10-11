# Grasp Studio (Quest 3)

Optag greb med Quest 3-håndsporing på en **virtuel** ølflaske (`bottle_beer`, krop eller hals, højre eller venstre hånd)
og gem dem direkte i `GameSystems/extensions/grasp/recorded_grasps.json`. Trin 4 i `../../docs/extensions_plan.md`.

> **Ikke afprøvet i et rigtigt headset.** Alt herunder er testet med syntetiske XR-led i node og med IWER-emuleret
> Quest 3 i Chrome (puppeteer). Følg "Test på Quest 3" og rapportér hvad der sker.

## Kom i gang

```powershell
cd GameSystems/apps/grasp-studio
npm install
npm run dev          # http://localhost:5180 (kun 127.0.0.1); sync kører først
npm test             # unit-tests (syntetiske XR-led, endpoint mod temp-fil)
npm run test:browser # Chrome + IWER smoke (system-Chrome/Edge, port 5191, gemmer i temp-fil)
npm run build        # dist/ (statisk; uden endpoint tilbydes gem som JSON-download)
```

Porten er fast (`strictPort`): 5180 for `dev`, 5181 for `preview`. Brugerens demo-server på 5199 berøres ikke.
`$env:GRASP_STUDIO_PORT=5185` vælger en anden port (husk så samme port i `adb reverse`).
`$env:GRASP_STUDIO_OUT="C:\sti\fil.json"` gemmer et andet sted end i `extensions/grasp` (bruges af testene).

`npm run sync` (kører før `dev`, `test`, `build`) kopierer `../../extensions/{host,grasp,humanoid,avatar,character-cc}` til
`src/vendor/extensions` og character-cc's genererede CharacterCreator-filer + avatar-aktiver (fra Contracts'
`src/extensions/character-cc/{vendor/cc,assets}`, `../../../NightfallContractsWebXR-interaction` eller `CONTRACTS_DIR`) til
`src/vendor/extensions/character-cc/vendor/cc` og `public/avatar-assets`, ligesom demoen (fælles kode i
`../../scripts/sync_lib.mjs`). Alt det er genereret og gitignored; ret i kilden. Uden Contracts kører studiet uden
avatar-tvilling (referencehånden vises stadig); `$env:REQUIRE_CONTRACTS=1` gør det til en fejl.

## Test på Quest 3

Uden adb: headset-testlabbet (`GameSystems/tools/headset-lab`, skrivebordsgenvejen "GameSystems testlab") serverer studiet over HTTPS på LAN på `https://<pc-ip>:8443/studio/`, og optagelser gemmes som her; se [docs/headset_testlab.md](../../docs/headset_testlab.md).

Forudsætning: Quest 3 med udviklertilstand, USB-kabel, Meta Quest Developer Hub (dens `adb.exe` bruges). Find adb:

```powershell
node $HOME\.claude\skills\quest-adb\adb.js discover
# -> "C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe"
```

1. Start serveren: `cd GameSystems/apps/grasp-studio; npm run dev` (vent på `http://127.0.0.1:5180/` og linjen
   `[grasp-studio] recordings are saved to ...recorded_grasps.json`).
2. Tilslut headsettet med USB og godkend USB-debugging i headsettet (`node $HOME\.claude\skills\quest-adb\adb.js devices`
   skal vise `device`). Trådløs adb virker også (`enable-wireless` + `connect`, se quest-adb-skill'en).
3. Videresend porten, så headsettets `localhost:5180` er PC'ens dev-server (secure context uden certifikater):
   ```powershell
   & "C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe" reverse tcp:5180 tcp:5180
   & "C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe" reverse --list   # tjek
   ```
4. I headsettet: slå håndsporing til (Indstillinger → Bevægelsessporing → Håndsporing), læg controllerne fra dig.
5. Åbn Quest Browser på `http://localhost:5180` og tryk **Gå i VR** (eller VR-knappen nederst). Tillad håndsporing hvis
   browseren spørger.
6. Flasken står 38 cm foran dig, 50 cm under øjenhøjde. Panelet står ved siden af flasken; tryk på knapperne med den
   **anden** hånds pegefinger (ikke den optagende hånd).
7. Grib flasken med den valgte hånd (standard: højre, krop). Fingerspidserne er hvide (fri), grønne (kontakt, ≤ 4 mm)
   eller røde (> 3 mm inde i glasset). Til siden (50 cm væk) vises avatarens hånd/referencehånden lukket-til-kontakt.
   Panelet viser tracking-sikkerhed for begge hænder (0–100 %).
8. Hold hånden stille om flasken: en nedtælling (1 s) vises over flasken. Bevæger du dig, starter den forfra. Under
   60 % tracking-sikkerhed tælles der ikke.
9. Efter optagelsen vises score (0–100) og validatorens fejl/advarsler på panelet. Vælg **Gem**, **Gem som foretrukken**
   eller **Kassér**. Med **Spejl: til** (standard) gemmes også den spejlede pose til den anden hånd. Flyt hånden mindst
   4 cm væk for at optage igen. **Fortryd gem** sletter det sidst gemte. Resultatet vises som grøn "Gemt ✓" eller rød
   "IKKE GEMT" foran dig; en afvist gemning ligger i køen (localStorage) til **Gem kø** sender den igen.
10. Se i PC-terminalen: `[grasp-studio] save: <id>, <id>-m -> ...` og filen `GameSystems/extensions/grasp/recorded_grasps.json`.
11. Få grebet ind i demoen: `cd GameSystems/webxr-demo; npm run sync` (eller genstart `npm run dev`). I Contracts:
    `cd NightfallContractsWebXR-interaction; npm run sync:extensions`. Optagelser er varianter: det bagte greb er stadig
    standard, indtil spillet vælger optagelser med `?graspvariant=recorded` (eller `=<id>`); håndklip med
    `?handvariant=recorded|<navn>@rec-<stamp>`. **Variant** på panelet viser originalen og optagelserne.
12. Ryd op: `& "<adb>" reverse --remove tcp:5180`.

Desktop uden headset: `http://localhost:5180/?synthetic` lader en syntetisk hånd gribe flasken (samme pipeline).
Flere URL-valg: `?quality=0..3`, `?avatar=off`, `?side=left`, `?panel` (vis panelet uden XR), `?avatarview=mirror|self`
(VRIK-avatar i spejl 1,5 m foran dig / 1. person; panelknappen **Avatar** skifter, sidepanelet har Figur CC/VRM, Rå led og
Tommel), `?character=vrm`.

Det vil vi gerne vide fra første headset-test: virker håndsporing i Quest Browser med hånden om en virtuel flaske (ingen
fysisk genstand); tracking-sikkerhed under grebet; om 1 s stillhed er for kort/lang; om poke-panelet er til at ramme;
score på et greb der føles rigtigt; billedhastighed på hvert kvalitetsniveau.

## Hvad gemmes

`recorded_grasps.json` (`gamesystems.recorded-grasps.v1`, én pose pr. linje) med samme poseformat som bagningen:
`wrist` (håndled i genstandens rum), `quat` (håndramme: +Z fingre, +Y håndryg), `angles` (5 × `[dyaw, pitch, bend1,
bend2]` grader = målformen for fingrene), `open`, plus `handLength` (den optagende hånds længde: knoglerne summeret håndled → langfinger-
spids, m) og `recorded: { at, source, score, frames, mirrored? }`. Spejlede poser har `mirroredFrom`.
`placeWrist` flytter håndleddet langs håndfladen med `(hånd.length − handLength) / REFERENCE_HAND.length`, så en
anden håndstørrelse holder om samme sted (bagte poser uden `handLength` bruger den gamle formel uændret).

Valget: en separat fil ved siden af `baked_grasps.data.json` i stedet for at skrive i bagningen, så en optagelse aldrig
kan ødelægge den bagte data, og den kan fortrydes ved at slette linjer. `baked_grasps.js` fletter den ind
som varianter: `POSES` er bagningen, indtil `setGraspVariants('recorded' | ids)` fletter optagelser ind (`mergePoses`;
en optaget standard tager så standard-flaget fra den bagte pose med samme genstand/side/grebstype). `graspVariants()`
lister bagt + optagne, `poseById` finder altid en optagelse. `BAKED` er stadig den urørte bagning.

Endpointet (`server/grasp_store.mjs`, monteret på `/api/grasps` af `vite.config.js`) tager kun imod POST fra samme maskine
(Origin localhost/127.0.0.1 eller ingen) med `Content-Type: application/json`, højst 512 KB, og skriver atomisk
(temp-fil + rename) i kø. Handlinger: `save` (poser; lægger altid til, et optaget id får `-2`, `-3` …), `default` (ids), `delete` (ids). En afvist
gemning logges og gemmes i `rejected/*.rejected.jsonl` (svaret har `kept`). Det findes kun i `npm run dev`.

## Kvalitetsniveauer

Global `0 minimal / 1 lav / 2 mellem (standard) / 3 høj` (HUD-vælger, panelknap, `?quality=`):

| | minimal | lav | mellem | høj |
| --- | --- | --- | --- | --- |
| Pixel ratio / XR framebuffer | 0,75 / 0,7 | 1 / 0,85 | 1,25 / 1 | 1,5 / 1 |
| Lukning-til-kontakt (live) | hver 3. frame | hver 3. frame | hver frame | hver frame |
| Avatar-tvilling (Contracts CC-spiller) | fra | plugin low | fuld | fuld |

Fingerspids-feedback (`chainGaps` + `closeToContact` på referencehånden) koster ca. 0,3 ms pr. frame i node. Score og
spejling beregnes én gang pr. optagelse.

## Filer

- `src/capture.js` – tracking-sikkerhed (fingerspids-jitter), stillhedsdetektor, midling (inkl. quaternion-fortegn),
  auto-capture-tilstandsmaskine (searching → holding → review → rearm).
- `src/studio.js` – studiets model uden three/WebXR: live feedback, optagelse, score, spejling, `syntheticHands`.
- `src/main.js`, `src/views.js`, `src/api.js`, `src/avatar.js` – scene, XR, panel, endpoint-klient, avatar-tvilling
  (extension efter `extensions/host`-kontrakten).
- `server/grasp_store.mjs` – gem-endpointet. `scripts/sync.mjs` – sync.
- Optagelses-matematik ligger i `extensions/grasp/record.js` (XR-led → håndramme + rækker, spejling, score, fletning),
  så spil og Contracts bruger samme kode. `extensions/grasp/reference_hand.json` er referencehånden (Contracts-rig,
  skala 1,094) bygget af `extensions/grasp/tools/make_reference_hand.mjs`.

## Begrænsninger

- Ingen headset-test. Score er en knoglemodel-tilnærmelse på referencehånden, ikke den skinnede CC-hånd.
- Tracking-sikkerhed er et heuristisk jitter-mål (WebXR giver ingen sikkerhedsværdi); `emulatedPosition` halverer den.
- Kun `bottle_beer`. Ingen animationsoptagelse, ingen pinch/controller-udløser (v1 bruger kun auto-capture + panel).
- Hånd + controller samtidig er ikke understøttet/afprøvet.
