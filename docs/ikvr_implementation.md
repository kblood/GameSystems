# IK VR-implementering (avatar, hænder, tommelfinger)

Noter om hvordan avatarens VR-IK og fingre er bygget i GameSystems, og hvad der er ændret. Kildekoden ligger i
`extensions/avatar` (VRIK, fingre, håndprofil) og `extensions/grasp` (greb, optagelse, validator). Contracts, demoen
og Grasp Studio får synkede kopier; ret altid i GameSystems og synk bagefter (`npm run sync:extensions` i Contracts,
`scripts/sync-helpers.mjs` i demoen, `scripts/sync.mjs` i studiet).

**Historisk evidens:** daterede Quest-noter, testtal og TODO'er nedenfor er snapshots fra deres angivne kørsel, ikke aktuel native Nightfall- eller headset-acceptance. Kontrollér den aktuelle kilde og projektspecifikke device-log, før du bruger dem som status.

## Overblik

| Del | Fil | Hvad den gør |
|---|---|---|
| Kropsløsning | `avatar/vrik.js` | VRIK-agtig fuld krop fra 3 punkter (hoved + 2 hænder). Ren, motoruafhængig, ingen allokering pr. frame (pooled math i `pm.js`). Output er en kanonisk humanoid-pose + placering af avatarens forælder. |
| Arme/ben | `avatar/twobone.js` | Tobens-IK for arme og ben. |
| Gang | `avatar/locomotion.js`, `cliploco.js` | Procedurel og klip-baseret benbevægelse. |
| Kalibrering | `avatar/calibrate.js` | Højde og armskala. |
| Fingre | `avatar/fingers.js`, `rigdata.js` | Fingertilstand fra sporede XRHand-led eller kurver; retarget til avatarens knogler. |
| Controller-fingre | `avatar/fingerInput.js` | Fingerkurver fra controller-input, profiler pr. controller. |
| Håndstillinger | `avatar/handposes.js`, `hand_poses.json` | Gestus/klip, kvalitet `?handposes=low|mid|high`. |
| Håndprofil | `avatar/handprofile.js`, `handskin.js` | Målt, justerbar håndstørrelse (se nedenfor). |
| Greb | `grasp/closure.js`, `baked_grasps.js`, `record.js`, `grasp_validator.js` | Lukning mod genstandens SDF, bagte/optagede greb, ledgrænser. |

Kvalitetstrin for avataren: `AVATAR_QUALITY = off | arms | full` (`avatar/index.js`).

## Fingerrækker (format)

Et greb/en stilling gemmes som en række pr. finger: `[dyaw, pitch, bend1, bend2]` i grader
(`grasp_validator.js` har grænserne). Tommelfingeren kan have en **5. værdi, `twist`** (se 2026-10-10 nedenfor).
Rækker med 4 værdier betyder twist 0, så gamle data virker uændret.

## Håndprofil (trin 10, 2026-10-10)

- Format `gamesystems.hand-profile.v1`: `length`, `knuckle`, `palmWidth`, `palmThickness`, `palmCenter`,
  `palmNormal`, `palmPatch`, `thenarPatch`, `palmOffset`, `thumbRoot`, `thumbTilt`, `bases`, `spread`, `segments`,
  `girth`, `pad`.
- Måles én gang fra karakterens hvile-skin. Kan overstyres i rækkefølgen karakter → provider → plugin →
  `createPlayer` → runtime `entity.setHandProfile` (øger `handProfileVersion`). `size` og `girth` er skalafaktorer.
- Grebslukningen bygges kun fra profilen. Søgning omkring det indlærte greb: low ingen, mid 27 kandidater,
  high 162.
- Kendte begrænsninger: Jimmy (VRM) kræver en kalibreret override; en profil der ikke passer til modellen giver
  greb der går ind i genstanden; krus og karton fejler stadig.

## Tommelfinger: rotation og twist (2026-10-10)

Fundet efter brugerens Quest-test ("tommelfingeren har en underlig drejning til at starte med").

### 1. Konstant skæv rulning på avatarens tommelfinger

- **Årsag:** tommelfingerknoglerne blev poseret med korteste rotation fra bind-retningen til målretningen. Det
  lægger en rulning på som afhænger af stillingen: målt mod CC-kroppens bind-knogler (`base_body.glb`) −25° til
  −70° i `relaxed` og +60° i `thumbs_up`. Selve bind-posen var fin (inden for ca. 5° af 60°-hængselkonventionen).
- **Rettelse:** knoglerne poseres nu fra både segmentretning og bøjehængsel (`thumbFrameDelta` i `fingers.js`, også
  i den poolede `fingerWorldDeltasInto`). Metacarpal- og proximal-rulning er nu konstant i alle stillinger (test:
  inden for 0,5°).
- **Kontakt:** `THUMB_AXIS.roll` i `rigdata.js` (`false` = gammel opførsel).
- Ses på avataren (tvillingen i studiet, demo- og Contracts-avataren). Den sporede hånd og den gule referencehånd
  tegnes kun fra ledpositioner, så de viser ingen negl.

### 2. Sporet tommelfinger-pronation gik tabt

- **Årsag:** sporede tommelfingre blev målt mod et fast bøjeplan. Ved 20° pronation sad spidsen ca. 21 mm forkert,
  ved 35° ca. 35 mm.
- **Rettelse:** valgfri `twist` (±45°) målt fra MCP/IP-bøjeplanet, ført igennem rigdata, fingers, fingerInput,
  handposes, record, closure, validator og baked_grasps.
- **Kontakter:** `THUMB_AXIS.twist` (`rigdata.js`, avatar) og `THUMB_TWIST.enabled` / `THUMB_TWIST.plane`
  (`grasp/record.js`, optagelse). Twist fades ind over bøjeplanets styrke (`TWIST_PLANE = [0.15, 0.4]`), fordi en
  strakt tommelfinger ikke har noget plan.
- **Kvalitet:** controller-, kurve- og bagte kilder har ingen twist og bruger fortsat den simple faste-plan
  tommelfinger (det lave trin).
- **Grebs-lab:** alle domme uændret. Med rulning slået til: 0,3–0,5 mm mindre penetration, 2–7° bedre opposition,
  1–1,5 mm større afstand ved tommelfingerspidsen (formentlig fordi puden nu vender mod genstanden).

### Ikke verificeret

- VRM-tommelfingerens bind-rulning er ikke tjekket mod meshet; den nye posering bevarer modellens konstante offset,
  så Jimmy kan stadig se lidt drejet ud.
- Den distale tommelfingerknogles hvileretning er ekstrapoleret fra forrige knogle, så dens rulning bevæger sig
  stadig ca. ±12° (gammelt, ikke twist-fejlen).
- Intet af det er prøvet på en rigtig Quest endnu.

## Grasp Studio: VR-UI efter optagelse (2026-10-10)

Ikke IK, men fundet i samme test og hænger sammen med håndinput.

- **Panelet reagerede ikke efter en optagelse:** VR-panelet tog kun imod pegefingeren på den hånd der *ikke*
  optog, så Gem/Kassér med den optagende hånd virkede døde. Nu virker begge hænder; den optagende hånd ignoreres kun
  mens den optages (holding/arming/recording/stopping). `apps/grasp-studio/src/main.js`, `views.js`.
- **VR-knappen:** three's `VRButton` kalder `offerSession` ved sideindlæsning, Quest annullerer det
  ("called more than once"), og den tilbyder aldrig igen efter man forlader VR via systemmenuen. Erstattet af egen
  knap ("Gå i VR" / "Afslut VR") med én anmodning ad gangen og fejl i statuslinjen. `panel.reset()` ved start og
  slut af session. En ikke-gemt optagelse bevares når man forlader VR.
- Demoen bruger stadig standard-`VRButton`.

## Tests

| Suite | Resultat (2026-10-10) |
|---|---|
| webxr-demo `node --test` (inkl. ny `tests/thumb-twist.test.js`) | 251/251 |
| grasp-studio `node --test` | 17/17 |
| grasp-studio browser-smoke (`tests/smoke.mjs`) | 16/16 |
| headset-lab `tools/headset-lab/test/lab.test.mjs` | 7/7 |
| Contracts `npm test` | 339/339 |
| Closure-lab | alle domme uændret |

## Tjek på Quest

Via testlab'et (`docs/headset_testlab.md`, https://dionysus.dk/webxr/GameSystems/) → Grasp Studio:

1. Greb-optagelse, tryk Gem med den optagende hånd og med den anden ("Gemt …").
2. Forlad VR via systemmenuen; siden skal vise "Gå i VR" og kunne gå i VR igen. Samme i Animation og Gestus.
3. Avatarens tommelfinger (kvalitet mellem/høj): neglen vender udad med afslappet hånd, drejer med ved knib, intet
   mærkeligt ved thumbs-up.
4. Nye optagelser følger tommelfingerspidsen bedre ved opposition.

## Runde 2 (2026-10-10, aften): Quest-gemninger, varianter og VRIK-avatarvisning

### Hvorfor Quest-optagelserne aldrig nåede disken

Optagelserne fra Quest-testen er **tabt**. Ingen af dem nåede `recorded_grasps.json` eller `recorded_hand.json`, og de
kan ikke gendannes:

- **Årsag:** testlab'et kører studio-Vite i middleware-mode i én langlivet node-proces. Serverens gem-endpoints
  (`server/grasp_store.mjs`, `hand_store.mjs`) importerede validatorerne (`isPose`, `isClip`) én gang ved start. Da
  tommelfingerrækkerne fik en 5. værdi (twist, se ovenfor), havde browsersiden den nye kode efter HMR, men serveren
  havde stadig den gamle validator i node's modulcache. Hver gemning med 5-værdi-rækker blev afvist med 400 `invalid
  pose` / `invalid clip`.
- **Hvorfor det var stille:** serveren loggede ikke afviste gemninger og gemte ikke deres indhold. Klienten ryddede
  optagelsen, før svaret kom. Fejlen stod kun som sidste statuslinje på panelet.
- Reproduceret gennem lab-originen (puppeteer + IWER mod https://localhost:8443/studio/, Greb, Animation og Gestus).
  Efter rettelsen gemmer alle tre: lab-loggen viser `[lab] POST /studio/api/grasps -> 200` og den tilsvarende
  `/studio/api/hand`.
- Det var ikke en cachet side: studio-HTML'en sendes med `Cache-Control: no-cache` af Vite, og hub-HTML'en også.

### Rettelser: gemning er højlydt og kan ikke tabes

- **Friske validatorer på serveren:** `freshExport` i `server/grasp_store.mjs` genindlæser validatoren med
  `?v=<mtime>`, når filen ændrer sig. `vite.config.js` importerer stores med `?t=`, og `hand_store` importerer
  `grasp_store` med sin egen query, så en Vite-genstart ikke blander gammel og ny kode.
- **Afviste gemninger gemmes på serveren:** de logges som `save REFUSED (400): …` og lægges i
  `apps/grasp-studio/rejected/<fil>.rejected.jsonl` med fejl, body og user agent. Svaret har `kept`, og mappen er
  gitignored.
- **Kø i browseren:** hver gemning lægges i køen (`localStorage` `grasp-studio.pending.v1`, try/catch, ellers i
  hukommelsen) *før* den sendes, og tages først ud, når serveren har bekræftet den (`src/api.js`).
  - Knappen "Gem kø (n)" på panelet sender køen igen.
  - Køen prøves også automatisk ved sideindlæsning, når biblioteket svarer.
- **Resultatet vises i VR:** en grøn "Gemt ✓ …" eller rød "IKKE GEMT (n i kø): …" toast foran dig (`views.js`
  `Toast`), og det samme på 2D-siden (`#toast`). "Fortryd gem" sletter kun de id'er, serveren bekræftede.
- **Lab-loggen** (`tools/headset-lab/serve.mjs`) logger hver `/studio/api/*`-, `/api/results`- og
  `/api/sync`-request med metode, URL, status, tid, enhed (Quest/headless/browser) og adresse. Den logger også
  `uncaughtException`.

### Optagelser er varianter: originalen bevares

En gemning overskriver aldrig noget:

- Hver optagelse lægges til som en ny variant med eget id og tidsstempel.
- Det bagte greb og håndbibliotekets klip forbliver standard, indtil et spil vælger en optagelse.
- Sletning er altid en eksplicit handling: "Fortryd gem" eller `action: 'delete'` med id.

| | id | standard |
|---|---|---|
| Greb | `<kind>/<side>/<grasp>/rec-<stamp>` (spejlet `…-m`); et optaget id får `-2`, `-3` … | det bagte greb. "Gem som foretrukken" markerer kun den foretrukne *optagelse* |
| Håndklip | `<navn>@rec-<stamp>`, `variantOf: <navn>`; klip og spejl deler id'et | biblioteksklippet med navnet |

Sådan vælges en variant:

- **I studiet:** knappen "Variant" bladrer gennem originalen og optagelserne for den aktuelle side, greb og navn.
  Varianten vises som en lilla hånd ved spøgelsesflasken. Biblioteksteksten lister varianterne.
- **I demo og Contracts:**
  - `?graspvariant=recorded` gør den nyeste optagelse til standard;
  - `?graspvariant=<id>[,<id>]` vælger bestemte optagelser;
  - `?handvariant=recorded|<navn>@rec-<stamp>[,…]` gør det samme for håndklip.
  - Uden parameter bruges bagt/bibliotek.
- **I kode:**
  - grasp: `setGraspVariants('baked' | 'recorded' | ids)`, `graspVariants(kind, side, grasp)`;
  - avatar: `setHandVariants(…)`, `handVariants(name)`, `buildLibrary(base, recorded, { variants })`.
  - `poseById`, `handPose` og `handClip` finder altid en variant på dens id.
- **Gamle filer:** optagelser gemt under det bare navn (før varianter) får id'et `<navn>@rec`.

### VRIK-avatarvisning i Grasp Studio (valgfri)

Standard er stadig tvillingen ved spøgelsesflasken. Visningen skiftes med panelknappen "Avatar: tvilling → spejl →
1. person" eller med `?avatarview=mirror|self`:

- **Spejl:** avataren står ca. 1,5 m foran dig (spejlplan 0,75 m foran hovedet, sat ved start og med "Centrér")
  og følger dit hoved, dine hænder og fingre live gennem fuld-krops-VRIK, spejlvendt. Din højre hånd styrer
  spejlbilledets venstre hånd, som i et spejl. De rå XRHand-led vises spejlet som cyan prikker på avatarens hænder,
  så du kan se, hvor tæt avatarens fingre følger.
- **1. person:** samme avatar uspejlet, uden hoved. Avatarens hænder ligger på dine sporede hænder.
- **Sidepanel** (ved siden af flasken, kun i avatarvisningerne):
  - "Figur: CC/VRM" skifter mellem CharacterCreator og VRM Jimmy; `?character=vrm` vælger ved start.
  - "Rå led: til/fra" viser eller skjuler de rå XRHand-led.
  - "Tommel" skifter `THUMB_AXIS` roll/twist: begge → kun roll → ingen.
  - Linjerne viser håndkilde pr. hånd (sporet/controller), fingerkvalitet i %, kropstrin og håndpose-trin,
    tommelfingerindstillinger og om optagelsen har twist.
- **Kvalitetstrin:** visningen følger studiets trin. Minimal slår avataren fra, lav giver arme og 'low'-preset, og
  mellem/høj giver fuld krop. Spejlberegningen er få vektoroperationer pr. frame, og avataren drives af pluginnets
  egen `readTracking` (ingen ekstra joint-læsning).
- Kode: `apps/grasp-studio/src/avatar.js` (visninger, `setCharacter`) og `src/main.js` (spejl, sidepanel).
  Avatarpluginnet er uændret.

### Tests (runde 2)

| Suite | Resultat |
|---|---|
| grasp-studio `node --test` (append/varianter, `kept`, `uniqueId`, håndvarianter) | 17/17 |
| grasp-studio browser-smoke | 26/26 (ny: afvist gem → kø + rød toast → "Gem kø"; variantvisning; spejl/1. person; tommelskift; CC↔VRM) |
| webxr-demo `node --test` | 280/280 |
| headset-lab `lab.test.mjs` | 7/7 |
| Contracts `npm run sync:extensions` + `npm test` | 339/339 |
| Lab-repro (IWER gennem https://localhost:8443/studio/) | Greb, Animation og Gestus gemt (200); de rigtige filer er gendannet bagefter |
| Hub-feedbackknapper (headless Chrome gennem lab-originen) | POST 200, linjer i `headset_results.jsonl`, historik efter genindlæsning, ukendt id → 400; testlinjerne er slettet |

### Tjek på Quest (runde 2)

1. Grasp Studio → Greb → Gem. Du skal se en grøn "Gemt ✓"-toast foran dig, og biblioteksteksten skal vise 1+
   varianter. Gør det samme i Animation og Gestus.
2. Står der rødt "IKKE GEMT": tryk "Gem kø". Fejlen står også i lab-konsollen (`[lab] POST /studio/api/… -> 400`)
   og i `apps/grasp-studio/rejected/`.
3. "Variant" skal vise originalen og derefter din optagelse (lilla hånd).
4. Hub-testen `studio-avatar`: spejl, 1. person, CC/VRM, rå led og tommelskift.
5. Hub-testen `studio-varianter`: `/demo/` skal se ud som før, og `/demo/?graspvariant=recorded&handvariant=recorded`
   skal bruge dine optagelser.

## Vægt og to-hånds greb (2026-10-23)

Kun GameSystems er kilden; Contracts og demoen får filerne med `npm run sync:extensions` (Contracts, kun grasp) og `npm run sync` (demo/studio). Ikke porteret til Godot (se nederst).

### A. Visuel vægt (`extensions/grasp/weight_lag.js`, `data/weight_lag.data.json`)

- Når en tung ting holdes, synker og halter den VISTE hånd 5-30 mm efter massen. Den rigtige håndsporing, selve gribet og fysikken røres ikke; det er kun visning.
- Formlen bruger held-drive-loven (`held_drive.js`): fejlen mellem objektets position og målet (hånden) giver offsettet. Vægten er log-masse, begrænset blødt med tanh, udjævnet uafhængigt af dt (tau 0.09 s, indsvingning 0.3 s). Derfor ingen jitter og ingen NaN. Konstanterne ligger i den eksporterede tabel `WEIGHT_LAG` (data-filen), ikke spredt.
- Hvor genstanden er kinematisk (demoen, studioet) kører `simulate:true` en virtuel krop gennem den rigtige `driveAcceleration`; i Contracts bruges den virkelige krops fejl.
- Tiers: minimal = fra, lav = hånd-offset, mellem/høj = + albue-hint. Albue-vektoren (`elbowHintOf(result)` i `weight_lag.js`: `{vector, weight:1}` eller null) er koblet til VRIK gennem det valgfrie `solver.setElbowHint(side, vector|null, weight)` (se «Albue-hint» nedenfor). Hånd-offsettet flytter stadig IK-målet.
- Kontakt: `?weightlag=off|on`. Standard FRA i Contracts. TIL i demoens testpanel (`?testpanel`) og i grasp-studio. Testpanelet i demoen har knapperne «Vægt» og «Rå led».
- Den rå hånd kan altid ses: studioets «Rå led»/«Rå»-knap viser den uforsinkede spøgelseshånd (hvid) og skjuler vægt-laget på den gule; demoen har `setShowRawHand`.

### B. To-hånds greb

- Datamodel: `data/two_hand.data.json` (`TWO_HAND`, `ITEMS`: carton, pole, barrel, mug) giver pr. genstand en primær- og en sekundær-gruppe, mindste afstand mellem grebene og reference-hånd. En optaget pose kan have `role: 'secondary'` (validatoren `isPose` tillader `primary`/`secondary`/ingen); `mirrorPose` bevarer rollen. Validator/closure: `handsClearance` (kapsler på hænderne) afviser to hænder der går i hinanden, og `pickSecondary` vælger kun et sekundært greb med ren afstand og ≥ `minSeparation`.
- Kørsel (Contracts `grab.js`, `?twohand=on`): holder den ene hånd genstanden, og den anden griber det sekundære greb, skiftes til to-hånds-modus. Orienteringen er en afgrænset look-at fra primær til sekundær hånd (max 55 grader, primærens roll som reference, samme mønster som `pistol.js`), blendet over 0,25 s, med højst 4 cm balanceforskydning. Holdekraften er summen af hænderne, begrænset (120 N for én, 200 N for to). En 16 kg tønde kræver 157 N: én hånd kan ikke, to kan.
- Slip: slipper den sekundære hånd, fortsætter den primære uden hop; slipper den primære, bliver den sekundære primær (offset genberegnet, 0 mm hop). Kast fra to hænder kun hvis begge slippes inden for 0,2 s (middel af historikken); ellers falder det rent tilbage til den hånd der slap sidst. Afvisningsgrund `grip_taken`, hvis det sekundære greb er for tæt på det primære. Brydes afstanden over 0,3 m, slippes det sekundære greb.
- Krus og karton, hvorfor closure fejlede: de bagte mug-håndtagsgreb havde tommel-pitch uden for ledgrænsen (100), og karton-gribene krævede håndledsbøjninger længere end rækkevidden. RETTET: proceduralt genererede greb (`tools/make_procedural_grasps.mjs`, `data/procedural_grasps.data.json`, 214 poser, 0 droppet): mug-håndtag (hook, 4) og -top (8), karton-side (16), stang (90), tønde (96). De er VALGFRIE (standard FRA): standardbiblioteket `BASE_POSES` er bagningen uændret (de bagte mug-håndtagsgreb urørte, ingen procedurale poser, pole/barrel har intet greb). `setProceduralGrasps(true)` (`?proceduralgrasps=on` i demoen og Contracts; Grasp Studio har dem slået TIL som standard, `?proceduralgrasps=off` slår dem fra) flette dem ind (`PROCEDURAL_POSES`, `buildLibrary(valgte, { procedural: true })`), og først da afløser `replaces: ["mug/*/handle"]` de bagte håndtag. `BAKED` er uændret i begge tilstande. HIT-RATE: 100 % (12/12 mug, 16/16 karton, 90/90 stang, 96/96 tønde) på hænder af skala 0,9/1,0/1,1.
- Tidligere åbne fejl, nu løst (valgfrit, kun med `?proceduralgrasps=on`): krus-KROPPEN og stigen, se «Runde 3» nedenfor. Karton: håndled-bøjningen i labbet er et rækkeviddeproblem, ikke et grebsproblem.
- Nye genstande (kun data-rækker): `pole` og `barrel` i `data/catalog.data.json` (mug og carton fandtes); i Contracts lægger `?twohand=on` eller `?proceduralgrasps=on` en stang og en tønde i prop-tabellen (ellers ikke). To-hånds greb på dem kræver de procedurale greb, så brug `?twohand=on&proceduralgrasps=on`.

### C. Grasp Studio

- «Genstand» (bottle_beer, mug, carton, pole, barrel), «Primær/Sekundær» (kun to-hånds genstande) og «Vægt» står i panelets nye række 5, sammen med «Rå». Den anden hånd vises på genstanden og på spøgelset (grå/gul). Reviewet viser «hænder N mm fra hinanden».
- Et sekundært greb gemmes som variant `…/rec-<stempel>` med `role: 'secondary'` gennem den eksisterende kø og validering (`rejected/`-filen ved afvisning); intet overskrives. Al eksisterende gem-sikkerhed (kø, «Fortryd gem», atomisk skrivning) er uændret. Flaske-flowet er uændret.

### D. Tal (node, intet headset)

- Vægt-lag: 5-30 mm, monoton i massen, dt-uafhængig ved 36/72/144 Hz, ingen frame-hop over 1,5 mm.
- To-hånds: en hånd 92 cm fejl mod 3,8 cm med to; drive-mål-skridt 1,3 mm ved 1 -> 2 -> 1; hop ved skift af primær 0 mm.
- Tests: GameSystems webxr-demo 797 (796 grønne; 1 fejl er den anden agents `bottles`-synk), grasp-studio 25 node-tests + 27 browser-checks, Contracts 398 (397 grønne; samme `bottles`-fejl), hub-labtest 7. (runde 3: se tallene i «Runde 3»).

## Runde 3: krus-krop, stige, albue-hint og ?twohand-advarsel (2026-10-23)

Alt er additivt og valgfrit. Uden flag er resultatet bit-identisk med før (golden-digest af 442 closure-resultater og 600 VRIK-frames, taget på træet før ændringen: `webxr-demo/tests/helpers/regression-digest.js`).

### 1. Krus-kroppen: rodårsag og rettelse

- Rodårsag: den Godot-bagte krop-række har tommelens CMC-pitch 100 (`[-42,100,10,-20]`), men `HARD.Thumb.pitch` er -35..65. `validateRows` afviser rækken; closure klemmer til 65, og tommelen opponerer stadig (154 grader), så det er den GEMTE række der er forkert, ikke closure.
- Rettelse: `make_procedural_grasps.mjs` laver 36 krop-poser (de bagte rækker med pitch klemt ind i grænsen, drejet 0/25/50 grader om Y væk fra hanken, dy 0/±12 mm). `replaces` er nu `mug/*/handle` og `mug/*/body`. Kun i den procedurale pose-pulje; BAKED er uændret.
- Closure-hitrate (krop): bagt 0/4 ved håndskala 0.9/1.0/1.1; procedural 36/36 ved alle tre.

### 2. Stige (`ladder`)

- Rodårsag til «+Y-aksen»: opposition-porten måler vinklen om genstandens akse med atan2(z,x), dvs. en +Y-akse gennem origo. Løsning: en valgfri pr.-pose akse `pose.axis = {origin, dir}` (samme format som i contact.js). `aroundOf(axis)` (eksporteret fra closure.js) returnerer EKSAKT den gamle funktion når aksen er null, så alle eksisterende poser er uændrede. `searchThumb`, `closeAll`, `gradeGrasp` (option `axis`), `closeToContact` (bruger `pose.axis`) og `scoreGrasp` bruger den. `isPose` validerer aksen; `mirrorPose` spejler den (z negeres).
- Genstand: datarække `ladder` i `catalog.data.json` (2 sider + 5 trin, cylinder-`axis: 'x'` er nyt i catalog.js: afstand, hull og inerti) og `ITEMS.ladder` i `two_hand.data.json` (primær og sekundær: `rung`, minSeparation 0,25 m). 150 procedurale trin-poser (5 trin x 3 stationer x 10 greb), hver med sin akse.
- Tal: closure 150/150 ved skala 0.9/1.0/1.1 (uden pr.-pose akse kun 50/150). To-hånds: 900/900 par har ren afstand, 15/15 primære får et sekundært greb på et ANDET trin. Alle 442 eksisterende closure-resultater identiske.
- Procedurale poser i alt: 400 (0 droppet): mug/handle 4, mug/top 8, mug/body 36, carton 16, pole 90, ladder 150, barrel 96.
- Contracts: stigen ligger kun i `LAYOUT_TWO_HAND` ((-0.62, 0, 6.55), på gulvet), altså kun med `?twohand=on` eller `?proceduralgrasps=on`.

### 3. Albue-hint (VRIK)

- `solver.setElbowHint(side, vector|null, weight=1)` (returnerer false ved ugyldigt input) og `solver.elbowHint(side)`. Vektoren (rig-meter, yaw-ramme) blødt-biaser albuens pole-vektor; udjævnes med `lp(dt, tau 0.12)` (dt-uafhængigt), og efter løsningen sammenlignes albuen med den almindelige løsning og bias skaleres ned, så albuen højst flytter 3 cm (`elbowHintMax`). Nul-vægt/null toner ud; `reset` rydder. Aldrig kaldt = bit-identisk.
- Avatar-plugin: `record.elbowHints[side] = {vector, weight}` føres til solveren i `updateTracking` (ingen hints = intet sker).
- Contracts: kun med `?weightlag=on` og tier mid/høj sætter `main.js` `record.elbowHints` fra den viste hånds `weightLag.elbow`; lav og minimal giver ingen.
- Tal: største albue-skift 29,7 mm af 30 mm; indsvinging inden for 1 mm ved 36/72/144 Hz, frame-skridt under 4 mm; ingen NaN ved 800 tilfældige hint-strømme. Ærligt: med den rigtige weight_lag-vektor (16 kg, tier høj) flytter albuen kun ca. 0,9 mm i testposen, fordi vektoren er lille; API'et kan bære op til 3 cm.

### 4. ?twohand=on uden ?proceduralgrasps=on

- `?twohand=on` slår IKKE procedurale greb til (separate flag). Uden `&proceduralgrasps=on` har stang, tønde og stige intet greb. Contracts skriver nu `console.info`, viser en HUD-statuslinje og en start-toast: «Stang og tønde har ingen greb uden &proceduralgrasps=on». Kun ved den flagkombination.

### 5. Grasp Studio

- Genstandslisten har `ladder` (gruppe `rung`, to-hånds); kruset har gruppen `body`. «Hals»-knappen (`grasp-neck`) cykler grupperne (mug: top, krop, top). Cylinder-`axis` tegnes i views.js.

### Tests (runde 3)

- webxr-demo: `ladder-mugbody.test.js` (11), `elbow-hint.test.js` (8), opdaterede `procedural-grasps`/`grasp-catalog-data`; studio `two-hand.test.js` + smoke (27/27); Contracts `interaction-ladder-elbow.test.mjs`; hub-testen `studio-stige`.

### Tjek på Quest (runde 3)

1. Contracts `?twohand=on` alene: en statuslinje/toast siger at stang og tønde mangler greb. Med `&proceduralgrasps=on` er den væk.
2. Contracts `?twohand=on&proceduralgrasps=on`: grib stigen med højre på et trin, og venstre på et ANDET trin. Stigen retter sig mellem hænderne; slip én hånd uden hop.
3. Grib kruset i KROPPEN (`?proceduralgrasps=on`): tommelen opponerer uden at gå ud af leddet. Uden flaget er det som før.
4. Contracts `?weightlag=on&twohand=on&proceduralgrasps=on&quality=3`: løft tønden. Albuen bøjer sig svagt; hånden må ikke virke ryk eller kvalmende. Prøv `quality=1` (kun hånd, ingen albue).
5. Studio: «Genstand» til ladder og mug, «Hals» til body; gem er uændret.

### Godot

Port `pose.axis`/`aroundOf` (valgfri akse pr. pose; null = gammel adfærd), cylinder-akse i formerne, de nye procedurale data (JSON uændret) og et pole-bias til albue-IK med 3 cm loft og lp-udjævning.


### Valgmuligheder (tilføjelser, standard uændret)

- `?proceduralgrasps=on`: procedurale greb (krus, karton, stang, tønde). Standard FRA i demoen og Contracts; TIL i Grasp Studio. Uden flaget er biblioteket bagningen som før.
- `?viscosity=on`: væskers viskositet bremser udstrømning fra huller (`holeHydraulics`); standard FRA (bit-identisk med før), TIL i demoens `?testpanel`.
- Vægt-lag-tabellen kender nu tier-navnet `mid` (= `elbow`, som `medium`), så Contracts' tier `mid` får albue-hintet.

### Tjek på Quest

1. Studio (`/studio/` i labbet): Gå i VR, tryk «Genstand» til barrel, grib med en hånd. Panelet skal vise «Vægt: hånden synker N mm» (5-30). Hånden skal falde til ro uden rystelser. «Vægt: fra» skal vise præcis din hånd. «Rå: til» viser den uforsinkede hvide hånd.
2. Studio: mug/carton/pole/barrel viser en ekstra hånd uden at hænderne går igennem hinanden. Tryk «Sekundær», hold stille, «Gem»: grøn «Gemt ✓», ny variant med rolle secondary; «Fortryd gem» fjerner den igen.
3. Demo `/demo/?testpanel`: løft en fyldt flaske; tryk «Vægt» og «Rå led» på VR-panelet og sammenlign.
4. Contracts `?twohand=on&proceduralgrasps=on&weightlag=on` (alle tre er FRA som standard; to-hånds greb kræver `proceduralgrasps=on`): tag tønden med én hånd (hænger tungt), derefter med to (lettere, stangen retter sig). Slip en hånd (ingen hop), slip begge samtidigt (kast), slip med mere end 0,2 s imellem (intet to-hånds kast).
5. Fortæl: føles forsinkelsen rigtig, er den for stor, giver den kvalme? Ligger fingrene rigtigt på hanken og toppen af kruset?

Hub-testene `studio-vaegt` og `studio-tohaand` (tools/headset-lab/hub/tests.js) følger de samme trin.

### Hvis det skal til Godot

Port `weight_lag.js` (en ren funktion af dt, masse, mål og held-drive-fejl; tabellen er JSON), `two_hand.js` (solveTwoHand, stepBlend, secondaryHeld, releasedTogether, handsClearance) og `held_drive.js`-kraftlofterne (`holdForce`/`holdTorque`). Kræver i Godot: en holdt-krop-model med hånds-roller (primær/sekundær) og `hands` 1|2, et IK-mål der kan få offsettet (og et rigtigt albue-hint, som VRIK ikke har), de proceduralt genererede grebsdata (JSON uændret), og at validatoren accepterer `role`.

### Nye og ændrede filer

- GameSystems `extensions/grasp`: `weight_lag.js`, `two_hand.js`, `held_drive.js`, `record.js`, `baked_grasps.js`, `index.js`, `data/{weight_lag,two_hand,procedural_grasps,catalog}.data.json`, `tools/make_procedural_grasps.mjs`.
- GameSystems `webxr-demo`: `src/avatar.js`, `src/testpanel.js`, tests `weight-lag`, `two-hand`, `procedural-grasps` (+ to ændrede data-tests).
- `apps/grasp-studio`: `src/studio.js`, `src/views.js`, `src/main.js`, `tests/two-hand.test.js`, `tests/smoke.mjs`.
- `tools/headset-lab/hub/tests.js` (to nye tests + `studio-stige`).
- Contracts: `src/interaction/{grab,physics,props}.js`, `src/main.js`, `src/extensions/grasp/*` (synket), `tests/interaction-two-hand.test.mjs`, `tests/interaction-baked-grasps.test.mjs`.

- Runde 3: `extensions/grasp/{closure,record,catalog,weight_lag,index}.js`, `data/{catalog,two_hand,procedural_grasps}.data.json`, `tools/make_procedural_grasps.mjs`, `extensions/avatar/{vrik,index}.js`, studio `studio.js/main.js/views.js`, tests `ladder-mugbody`, `elbow-hint`, `helpers/regression-digest.js`; Contracts `src/main.js`, `src/interaction/props.js`, `tests/interaction-ladder-elbow.test.mjs`.