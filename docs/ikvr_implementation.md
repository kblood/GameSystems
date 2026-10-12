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
