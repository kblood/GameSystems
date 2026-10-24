# Forbedringsforslag på tværs af projekterne (G5-audit)

Oprettet 2026-10-24 som resultat af en READ-ONLY audit (mål G5 i [goals_roadmap.md](goals_roadmap.md)). Der er ikke ændret kode, docs eller git-tilstand; kun denne fil er oprettet. Ingen tests er kørt (der blev ikke startet processer), så alle testtal nedenfor er citater fra dokumenter eller tællinger af filer, ikke nye målinger.

Mærkning: **[V]** = verificeret mod kode, filer eller git i denne audit. **[S]** = min vurdering. Headset-resultater er aldrig påstået; "uden headset" betyder node/IWER/Godot headless.

Læste: `improvement_backlog.md` (overskrifter plus alle "Næste/Nyt åbent/Vedvarende"-afsnit og de nyeste ca. 40 afsnit), `game_system_ideas.md`, `godot_port_plan.md`, `extensions_plan.md`, `ikvr_implementation.md`, `audio_system.md`, `backpack_system_design.md`, `headset_testlab.md`, `goals_roadmap.md`, README'er (GameSystems, NightfallContractsGodot), `ai_system.md`/`gore_system.md`/`glass_system.md`/`pour_system.md`/`camera_system.md`/`mission_system.md` (kun "kendte mangler"), `VR_DEVELOPMENT.md`, `DFUVR-Steam-Frame-noter.md`, samt kode i `extensions/`, `godot/addons`, `tools/headset-lab`, NightfallContractsGodot (`core/`, `runtime/`, `tests/run_native_suite.py`), NightfallContractsWebXR-interaction (`src/game`, `tests`, `package.json`), og overfladisk IWSDK, CharacterStudio, makehuman-js, NightfallHandsFixture, NightfallContracts. CharacterCreator* er ikke rørt.

---

## 1. Hvad findes, og hvad lover game_system_ideas.md uden at levere

### 1.1 De seks "nye selvstændige gamesystems" fra `game_system_ideas.md`

Alle seks findes som extension og en `workshop`-composition [V] (`extensions/{mechanics,electricity,materials,thermal,tools,acoustics,workshop}`), men dybden er meget forskellig. Tabellen viser løftet i idé-tabellen mod koden.

| System | Linjer kode [V] | Hvad der er bygget | Hvad idéen/samspillet lover, men som ikke (fuldt) er bygget |
|---|---|---|---|
| mechanics | 89 | slider/hinge/valve, modstand, fjeder, stop-event med energi, lås-flag, hold pr. hånd, to hænder summeres, checkpoint | Ingen lås/nøgle-model (kun `locked`-boolean), ingen detent/klik-positioner, ingen magnetisk lukning, ingen smæk-lukning. "Strømstyret lås" findes kun som workshop-composition (`door` låst indtil elektricitet), ikke som genbrugelig lås |
| electricity | 215 + storage | DC-net, batteri, sikring, kontakt, last, kortslutning, observer-lifecycle | Kun resistivt DC. Godot-versionen er mere udbygget (`gs_electricity`, 871 linjer) end three-versionen |
| materials | 46 | 4 presets (wood, metal, concrete, fabric), vådhed, tørring, plet, friktion, regnskab (retained/evaporated/runoff) | Kun 4 materialer mod 7 i `audio/sound_materials.json` [V]. Ingen reaktion materiale til materiale; friktion er et tal, ikke koblet til gang/locomotion eller fysik i spillene [S] |
| thermal | 581 | brand, varmeledning, rum, portaler, elektrisk varme, sprinkler-kobling, pyt-ignition | Dækker det lovede og mere (Godot-port findes). Mangler dynamisk geometri og verdens-chunking (backlog "Næste undersøgelse") |
| tools | 45 | skrue, søm, sokkel (sikring); kun `screwdriver` og `hammer`; geometrisk afstands/vinkel-gate; ejerskab af dele | Ingen skruenøgle, tang, sav, tape, svejsning, reparation af ødelagte ting. Ingen kobling til grasp-systemets faktiske værktøjsgreb; værten må selv levere værktøjsspidsens pose [V: kommentar i filen]. Ingen Godot-port |
| acoustics | 57 | rum/portal-graf, lavest-tab-sti, afstandsdæmpning, forsinkelse, lyttere, stimulus-callback | **Ingen producent af `sound:emit` findes noget sted** [V]: extension-wrapperen lytter på `sound:emit`, men grep i alle projekter finder kun lytteren. Kun `workshop` kalder `acoustics.sound()` direkte. AI-hørelse (`ai/perception.js hear`) bruger egne radier og er ikke koblet til acoustics [V]. "Dør → lyd mellem rum → stimulus til AI" er altså kun bevist i workshop, ikke som spilfunktion |

Samspilspunkter fra idéfilen (jeg har kun kigget efter dem i koden):
- Vedligeholdelsesstation (skuffe → sikring → kontakt → lys → dør): bygget i `workshop` [V].
- Spild gør overflade våd (`liquid:deposit` → `materials.wet`): bygget som event-lytter [V]. "Vand kan køle/slukke brand": i thermal-systemet [S, ikke genverificeret].
- "En ventil kan styre et spildefineret flow": workshop har en `valve`, men den aflæses kun (`valve: m.state('valve').fraction`) og styrer ikke et flow [V]. Det er ikke koblet.
- "Værktøjers stød og mekaniske stop sender lydhændelser": koblet i workshop (`tools:impact`, `mechanics:stop` → `acoustics.sound`) [V], ikke i spillene.

### 1.2 Samlet oversigt over hvad der findes (kort)

| Område | three.js (`extensions/`, [V] linjer) | Godot (`godot/addons`, [V] linjer) | Bemærkning |
|---|---|---|---|
| Flasker/væske/brud | bottles 2566, pools 429, flow, supply, coatings | gs_bottles 6424 | Godot-kopi i Nightfall afviger i `bottle_pour.gd` (se 4.3 punkt 1) |
| Greb/hænder/avatar | grasp 3103, avatar 5756, humanoid 704, character-cc/vrm | gs_grasp 2888, gs_grasp_data 1280, gs_humanoid 84 | Vægt-lag, to-hånds, albue-hint, proceduralt greb er IKKE porteret til Godot (`ikvr_implementation.md` "Hvis det skal til Godot") |
| Rygsæk/inventar | backpack 1718 | gs_backpack 3264, gs_gear_inventory, gs_weapon_loadout/catalog | 125 golden-vektorer node vs Godot ifølge docs; Godot-scene-adapter er uncommitted |
| Lyd | audio 560 + 271 lydfiler | ingen `gs_audio` (Nightfall har egen `audio_bus.gd`, 16 stemmer) | Godot har ikke materiale-kontaktlyd fra GameSystems |
| NPC | ai 2182, hitreact 914, gore 2586 | Nightfall har egne `guard*.gd` (ca. 1300 linjer) og `blood.gd` | Ingen fælles Godot-AI; to uafhængige guard-implementeringer |
| Brand/varme/strøm | thermal, electricity, sprinklers, smoke, alarms | gs_thermal, gs_electricity, gs_sprinklers, gs_fire_spread, demo | Godot er længst her |
| Køretøj/kamera | vehicle 564, cameras 120 | gs_cameras 887 | Ingen vehicle i Godot |
| Mission | missions 41 (én tidsbegrænset mål-evaluator) | Nightfall `core/mission_state.gd` 83 linjer | Ingen fælles kontrakt-/mission-model; WebXR-`mission.js` (43 linjer) er hårdkodet: dræb alle, hent intel, nå udgang [V] |
| Test/værktøj | webxr-demo 101 testfiler, 20+ browser-smokes | 44 Godot-testscripts i GameSystems | Se 4.2 om manglende runner |

### 1.3 Port-status (godot_port_plan.md G0–G9, dokumentets egen tabel + kode)

| Trin | Status [V mod tabel og addons-mappen] |
|---|---|
| G0 afklaring, G1 gs_host, G2 gs_bottles, G3 fælles data | færdige |
| G4 gs_grasp kerne | påbegyndt; mange source-ports og goldens; "runtime-integration og runtime-paritet mangler" |
| G5 gs_humanoid + gs_character_cc | `gs_humanoid` 84 linjer findes; `gs_character_cc` findes ikke i `godot/addons` |
| G6 lukning-til-kontakt + optagelser | delvist dækket af G4-helpers |
| G7 gs_avatar (VR-IK), G8 hånd-poser, G9 Steam Frame ARM64 | ikke påbegyndt som GameSystems-addons (`gs_avatar` findes ikke). Nightfall har egen hånd/arm-IK og har allerede lavet Frame-ARM64-eksport og enhedslog uafhængigt af planen |

Navnekollision [V]: "G1–G9" betyder tre forskellige ting: `godot_port_plan.md` (G0–G9), `goals_roadmap.md` (G1–G7) og `extensions_plan.md` (trin 1–10 plus P0–P3 i backpack-designet). Fx er "G4" i roadmap "port af vægt, to-hånds, lyd, farveblanding til Godot" men i port-planen "gs_grasp kerne".

---

## 2. Forbedringsforslag (22 stk.)

Størrelse: S = op til ca. 1 dag, M = 2 til 5 dage, L = over en uge. Risiko: L/M/H for at bryde eksisterende adfærd. "Ren tilføjelse" = kan laves uden at ændre standardadfærd (flag/ny fil/ny extension), i tråd med brugerens regel om opt-in og standard FRA. "Headset" angiver hvad der kun kan afgøres på hardware.

Rækkefølgen i tabellen er tematisk, ikke prioriteret; prioritet står i afsnit 3.

### Gruppe A: Realisme og spiloplevelse i VR

**F01 — Fælles lydbus: producenter af `sound:emit` + kobling til AI-hørelse og akustik**
- Projekt: GameSystems (`audio`, `acoustics`, `ai`, `mechanics`, `tools`, `bottles`), derefter NightfallContractsWebXR-interaction. Godot-pendant som signal i `gs_host`.
- Hvad/hvorfor: I dag udsender ingen `sound:emit` [V]. Slag på flasker, skuffer, værktøj, gevær, tabte genstande og fodtrin er enten kun lyd (audio) eller kun AI-stimulus (`ai.stimulus`), aldrig begge. En lille bro, der oversætter kontakt/stop/brud-events (med energi og position) til ét `sound:emit` og derfra til `acoustics.sound()` (dæmpning gennem døre) og `ai.stimulus()` (radius efter energi), giver NPC'er der hører at du taber en flaske bag en lukket dør. Realisme + NPC-troværdighed + mekanik i smug-spil.
- Størrelse: S–M. Risiko: L. Afhængigheder: ingen (alle producenter findes).
- Test uden headset: ren node-test (`system-bridges.test.js` mønster): tabt flaske → ét `sound:emit` → AI `heard` og `acoustics:heard` med dæmpning ved lukket/åben portal; ingen emit når flag er fra; budgetgrænse (`maxPending`).
- Kræver headset: kun afprøvning af *om* det føles fair (guard reagerer for tidligt/for sent).
- Ren tilføjelse: ja, ny bro bag `?soundbus=on` (standard fra).

**F02 — Skrab/slide-kontakt og kontaktlyd for krus/dåse/karton**
- Projekt: NightfallContractsWebXR-interaction (`src/interaction/physics.js`) + GameSystems `audio`.
- Hvad/hvorfor: Kendt mangel (G6). Solveren har kontaktnormaler og tangentvektorer [V: `tangents(n)`], men contact-eventet rapporterer kun nærmehastighed, ikke glidehastighed; krus/dåse/karton er ikke oprettet med `contacts: true` [V: audio-doc]. Dermed lyder kun flasker, og intet skraber over bordet. Det er én af de billigste måder at få materiel realisme på (træk et krus hen over et bord, stål mod beton).
- Størrelse: M. Risiko: M (solveren er tunet; ændr kun rapporteringen, ikke løsningen). Afhængigheder: F01 er uafhængig, men samme event kan føde den.
- Test uden headset: solver-enhedstest at `slip` i eventet = tangentialhastighed (analytisk skråplan), at ingen solver-output ændres bit-for-bit (eksisterende `regression-digest.js`-mønster); audio-test at slide-loop gain følger slip og tier.
- Kræver headset: hørbar kvalitet, stemmeforbrug på Quest.
- Ren tilføjelse: ja (ekstra felt i event, `contacts: true` kun med `?audio`).

**F03 — Spillerskade pr. kropsdel, blødning og første hjælp ("vitals")**
- Projekt: ny extension `vitals` (three.js) + tynd Godot-port; Nightfall Godot bruger i dag én `health := 100.0` [V: `runtime/player.gd:61`, `:2693`].
- Hvad/hvorfor: Skader på kroppen og første hjælp er en gennemgående VR-oplevelse (bandage fra rygsækken, to-hånds tryk, bløde skadesfeedback uden kvalme). Hit-regionerne findes allerede for NPC'er (`gore/regions.js`, `hitreact`), så mapping kropsdel → effekt kan genbruges. Giver mening for rygsæk (forbrugsvarer), kontrakt (svære valg) og lyd (hjerteslag).
- Størrelse: M–L. Risiko: M (komfort: ingen skærmryst, ingen blodtåge som standard). Afhængigheder: backpack (forbrugsvarer), audio; valgfrit F07.
- Test uden headset: ren tilstandsmaskine med golden-vektorer (som backpack): skade → blødningsrate → død/stabilisering; bandage-forbrug; checkpoint-roundtrip; tiers ændrer kun visning, ikke udfald.
- Kræver headset: komfort (vignette, haptik), læsbarhed af pulsindikator på håndled, hvor man placerer bandage.
- Ren tilføjelse: ja, `?vitals=on`, standard fra; Nightfall-integration bag flag.

**F04 — Hænder-baseret håndværk v2 (`tools` fra "gate" til brugbar mekanik)**
- Projekt: GameSystems `tools` (+ `mechanics`, `grasp`), senere Godot.
- Hvad/hvorfor: `tools` er 45 linjer med to værktøjer [V]. Udvid med skruenøgle (drej-akse + drejningsmoment), tang (klip/træk søm), tape/reparation (lukker hul i flaske/rude/ledning), sav (kort strøg-baseret fremdrift), keycard/nøgle til lås. Gør vedligeholdelsesstationen til et reelt "lav noget med hænderne"-loop og binder værktøjsgreb til `grasp`-kataloget (tønde/stang findes allerede som to-hånds-genstande).
- Størrelse: M–L. Risiko: L (nye `kind`-værdier; eksisterende uændret). Afhængigheder: F06 (lås/nøgle) for nøglerne; `grasp` katalog-rækker for nye værktøjer.
- Test uden headset: gate-tests (afstand/vinkel/arbejdsmængde), ejerskab/checkpoint, workshop-integration; replay af en optaget "skru-bevægelse" som syntetiske poser.
- Kræver headset: om bevægelserne føles naturlige (rotation af håndled ved skrue, komfort).
- Ren tilføjelse: ja.

**F05 — Diegetiske tegn på NPC-opfattelse**
- Projekt: GameSystems `ai` (+ `hitreact`/audio) og Nightfall (begge runtimes).
- Hvad/hvorfor: AI'en har suspicion, alert-niveauer, hørelse og squad-reports [V: `perception.js`, `guard.js`], men spilleren får få tydelige signaler. Små, billige tegn: hovedvending mod lyd, lommelygtekegle der sveber, "huh?"-barks, radio-opkald (F18), skridt-tempo. Det løfter læsbarhed og fairness uden HUD-overlay (godt for VR).
- Størrelse: S–M. Risiko: L. Afhængigheder: F01 (lyd i verden), audio til barks.
- Test uden headset: events (`suspicion` tærskler → cue-id), determinisme med fast seed, ingen cue når flag er fra.
- Kræver headset: om cues er synlige/hørbare på realistisk afstand og ikke skræmmende.
- Ren tilføjelse: ja, cue-id'er som events; visning er opt-in.

**F06 — Møbler, døre og låse som datadrevet extension (G1)**
- Projekt: ny `extensions/furniture` (findes ikke endnu [V]); kerne i three.js og Godot-reader som backpack; brug i NightfallContractsGodot (har `lever_door`/`door_lever`) og WebXR-Contracts (har ingen døre/skuffer [V: audio.js-kommentar]).
- Hvad/hvorfor: G1 er "i gang" i roadmap, men der er ingen kode [V]. Byg 8+ typer (skab, skuffe, dør, kiste, hængelås, nøglelås, kombinationslås, strømstyret lås) oven på `mechanics`, `audio/creaks.js` (knirk findes allerede, kobles kun til `mechanics:changed`), backpack-containerledgeren (indhold) og checkpoint. Hånd-greb på håndtag via eksisterende grasp-rækker. Låse: nøgle-id'er, dirk (to-hånds finmotorik) og elektrisk lås.
- Størrelse: L (kan splittes i kerne M + rendering/scene S + Godot-reader M). Risiko: M. Afhængigheder: backpack-container (G2 delvist), mechanics.
- Test uden headset: golden-vektorer pr. type (som backpack), lås/nøgle-state, checkpoint-roundtrip, tier-paritet (tiers ændrer ikke puzzle-resultat), lyd-trigger; Godot headless paritet.
- Kræver headset: håndtagsrækkevidde, hængsel-"følelse", dirk-komfort, to-hånds skuffer.
- Ren tilføjelse: ja (ny extension, flag i spil).

**F07 — Kontrakt-/missionsflow v2 (flere mål, grene, belønning, briefing)**
- Projekt: GameSystems `missions` + NightfallContractsGodot `core/mission_state.gd` + WebXR `src/game/mission.js`.
- Hvad/hvorfor: `missions` er ét tidsbegrænset mål-evalueringsled (41 linjer) [V]; Godot-missionen er et hårdkodet forløb (bypass → manifest → lockdown → udgang) [V]; WebXR-missionen er "dræb alle → intel → udgang" [V]. For spiloplevelse mangler: flere delmål med afhængigheder, valgfrie mål, fejl/succes-grene, belønning (rygsæksindhold/penge), sværhedsgrader og en kontrakt-brief. Én fælles datamodel (JSON, golden-vektorer) kan drive alle tre.
- Størrelse: M–L. Risiko: M (rør ikke eksisterende `missions.start/evaluate` API; ny `contracts` bag ved).
- Afhængigheder: F06 (låse/dørene som mål), F03 (skadeudfald), F18 (radio til briefing).
- Test uden headset: ren tilstandsmaskine, checkpoint, deterministisk replay; paritet node vs Godot via golden.
- Kræver headset: flowet og sværhedsgrad (menneskelig vurdering).
- Ren tilføjelse: ja.

**F08 — Lys og lommelygte koblet til AI-synlighed og batteri**
- Projekt: GameSystems (ny lille `lighting`-bro: `electricity` batteri + `ai` perception) og Nightfall.
- Hvad/hvorfor: Lys er den billigste VR-atmosfære, og det kan være gameplay: lommelygten (batteri fra `electricity`) lyser op, men afslører dig (AI-opdagelsesrate stiger i kegle; mørke zoner sænker den). Strømsvigt (sikring, `electricity`) slukker lamper → mørke rum. Vejr kan komme senere (se afsnit 6).
- Størrelse: M. Risiko: M (belysning koster på Quest; her kun én spotlight, skygge fra og til via tier). Afhængigheder: AI perception skal have en "belysningsfaktor"-input (additiv parameter, default 1).
- Test uden headset: perception-test med faktor 0.2/1/2 ændrer detektionsrate monotont; batteri tømmes; ingen ændring uden flag.
- Kræver headset: ydelse (spot + skygge), læsbarhed af mørke på Quest.
- Ren tilføjelse: ja, `?lights=on`.

**F09 — Central haptik-tabel (event → puls)**
- Projekt: GameSystems (ny lille `haptics`-hjælper); Nightfall bruger i dag lokale kald (`haptic: (side, strength, ms)` i prop-scenen).
- Hvad/hvorfor: Haptik er billig realisme (flaske der rammer bord, skuffestop, tung genstand, skud). En tabel i data (`haptics.data.json`) fra event+energi til styrke/varighed, begrænset (ingen ryg-til-ryg-pulser), kan deles af begge runtimes og tilpasses pr. controller (Touch/Frame).
- Størrelse: S. Risiko: L. Afhængigheder: ingen.
- Test uden headset: ren funktion (energi → styrke monoton, loft, rate-limit, dt-uafhængighed); mock-aktuator.
- Kræver headset: hvad der føles rigtigt; Frame-controllers haptik (`STEAM_FRAME_TESTING` siger haptik mangler test).
- Ren tilføjelse: ja.

### Gruppe B: Fysik, væsker, avatar (porte og kvalitet)

**F10 — Godot-paritet for væsker (viskositet, glat farve, mix i `GSPourReceiver`)**
- Projekt: `godot/addons/gs_bottles` + synk til NightfallContractsGodot.
- Hvad/hvorfor: `pour_system.md` angiver at Godot mangler glat farve-fade, viskositetstabel (`cd`/`glug_k` er node-exports) og mix for modtagere uden `bottle_pour`-node [V: dokumentet]. Brugerens fokus på væsker i VR gør at three.js og Godot ikke bør glide fra hinanden. Rydder samtidig kopi-driften (4.3 punkt 1).
- Størrelse: M. Risiko: M (visuel adfærd). Afhængigheder: F20 (sync-gate).
- Test uden headset: eksisterende goldens fra `liquidMix`/viskositet porteres til `gs_bottles_tests.gd`; paritetstal node vs Godot (som backpack).
- Kræver headset: udseende/ydelse på Quest/Frame.
- Ren tilføjelse: ja (viskositet/mix som tier-flag).

**F11 — Port af vægt-lag og to-hånds greb til Godot (roadmap G4)**
- Projekt: `gs_grasp` + NightfallContractsGodot (`held_drive.gd`, `grabbable.gd`).
- Hvad/hvorfor: Vægt og to-hånds er de mest mærkbare "realismeløft" i JS, men findes ikke i Godot, hvor Nightfall kører [V: ikvr-doc]. Port rene funktioner (`weight_lag`, `two_hand`, kraftlofter) med eksisterende JSON, test mod JS-goldens.
- Størrelse: M–L. Risiko: M (påvirker hold/kast i Nightfall; derfor flag, standard fra). Afhængigheder: holdt-krop-model med roller; albue-hint kræver IK-mål (VRIK findes ikke i Godot).
- Test uden headset: golden-paritet (varians ≤ tolerance), dt-uafhængighed ved 36/72/144 Hz, ingen NaN under fuzz; Godot replay-suiter.
- Kræver headset: om forsinkelsen føles rigtig/ikke giver kvalme.
- Ren tilføjelse: ja, bag flag.

**F12 — Kollisionsbegrænset hånd/arm-test af avatar-fit på alle karakterer (Jimmy, krus-krop, karton)**
- Projekt: GameSystems `character-vrm`, `grasp`, Grasp Studio.
- Hvad/hvorfor: G6-restpunkter: Jimmy kræver kalibreret override pr. side, karton-håndled er et rækkeviddeproblem ikke et grebsproblem [V: ikvr-doc]. Byg en automatisk "hit-rate-matrix" (karakter x genstand x håndskala) som test og rapport, så fejl findes uden headset, og dokumentér hvilke kombinationer der er bevist.
- Størrelse: M. Risiko: L. Afhængigheder: proceduralgreb-data findes.
- Test uden headset: ja (matrix i node), resultater i et JSON-rapportformat.
- Kræver headset: visuel pasform på rigtige hænder.
- Ren tilføjelse: ja (test/rapport, ingen ændring af standard).

### Gruppe C: NPC'er

**F13 — Taktisk forfølgelse via NavigationServer i Nightfall Godot (opt-in)**
- Projekt: NightfallContractsGodot (`runtime/guard_squad.gd`, `guard_tactics.gd`).
- Hvad/hvorfor: README: "No navmesh-driven room-to-room tactical pursuit" [V]; `AI_REVIEW_IMPLEMENTATION.md`: "ikke en tactical navmesh/path planner" [V]. Men koden bager allerede en `NavigationMesh` til lokal positionering [V: `guard_squad.gd:252-271`], så en pursuit-tilstand er en naturlig udvidelse: guards leder efter lyd/last-seen rum-til-rum. Det er den enkeltstående største forbedring af NPC-troværdighed.
- Størrelse: M–L. Risiko: M–H (balance og ydelse; derfor flag og budget). Afhængigheder: F01 for troværdigt lydgrundlag.
- Test uden headset: deterministiske scenarier i eksisterende guard-suiter (uopnåelig stimulus søges fra nærmeste punkt, ingen vægg-krydsning, tidsbudget pr. tick); determinisme med seed.
- Kræver headset: følelse af tryk/fairness; ydelse med syv guards på Frame.
- Ren tilføjelse: ja, `--guard-pursuit` (standard fra).

**F14 — Fælles AI-kerne mellem three.js og Godot (kontrakt + golden)**
- Projekt: `extensions/ai` ↔ Nightfall `core/guard_*.gd`.
- Hvad/hvorfor: To uafhængige guard-implementeringer vil drive fra hinanden. `ai/guard.js` er allerede en port af `runtime/guard.gd`-dele [V: kommentar]. Udtræk de rene dele (perception-tærskler, state machine, difficulty) som JSON-config + golden-vektorer, og læs dem i begge.
- Størrelse: L. Risiko: M. Afhængigheder: F13 først eller sammen.
- Test uden headset: golden paritet; ingen runtime-adfærd ændres før flag.
- Ren tilføjelse: ja.

### Gruppe D: Ydelse (Quest/Steam Frame) og robusthed

**F15 — Automatisk ydelsesmåling i headset-lab (frame-percentiler, tier-budgetkort)**
- Projekt: `tools/headset-lab`, `webxr-demo`, Contracts, plus `STEAM_FRAME_TESTING`-formatet.
- Hvad/hvorfor: Hub-testen `perf` beder brugeren aflæse et testpanel og skrive tal i en note [V: `tests.js`]; resultatfilen `docs/headset_results.jsonl` findes ikke endnu [V], så der er ingen målinger at bygge budgetter på. AI-doc og audio-doc skriver begge "Quest-ydelse er ikke målt" [V]. Et lille `perf-capture`-modul (frame-ms p50/p95/p99, antal stemmer, antal aktive pytter, JS heap) der selv POSTer til `/api/results` fjerner menneskelig aflæsning og gør hvert tier sammenligneligt. Giver data til glass-opgaven (HIGH hit 10,47 ms mod 11,11 ms budget ved 90 Hz [V: backlog]).
- Størrelse: M. Risiko: L. Afhængigheder: ingen.
- Test uden headset: IWER/headless: modulet producerer valide linjer, percentil-matematik, rate-begrænsning, ingen overhead uden `?perfcapture`.
- Kræver headset: selve tallene (det er pointen).
- Ren tilføjelse: ja.

**F16 — Én Godot-testrunner for GameSystems + dækning af alle testscripts**
- Projekt: `GameSystems/godot` (`tests/README.md`, `tools/`).
- Hvad/hvorfor: 28 af 44 testscripts står ikke i `godot/tests/README.md` [V]: hele gs_grasp (12), gs_grasp_data (8), gs_humanoid, bottles, backpack container/parity/interaction, bottle leak. Nightfall har `run_native_suite.py`; GameSystems har kun en håndholdt kommandoliste. Én upload-sikker opdagelsesbaseret runner (find `*_tests.gd`, kør, afvis logged errors, opsummer) fjerner "glemte suiter".
- Størrelse: S. Risiko: L. Afhængigheder: ingen.
- Test uden headset: ja (selve runneren er værktøj; test på at den finder alle 44).
- Ren tilføjelse: ja (ny fil, README opdateres).

**F17 — Flaky tidstest og testlog-hygiejne i Nightfall Godot (G6)**
- Projekt: NightfallContractsGodot (`tests/run_native_suite.py`, `magazine_acquisition_safety.gd`).
- Hvad/hvorfor: Den kendte flake er `magazine-acquisition-budget`, der kører samme script på mikrosekund-uret (1 ms slice-krav) [V: runner-kommentar + STEAM_FRAME_TESTING linje 480: "known flake", fejler også alene]. Den seneste log i repoet viser to andre fejl (`MAG_GRIP_PROBE … validated visible-skin hand contact`) og "277 checks / 2 failures" (log dateret 2026-10-19) [V]. Altså: enten er flake-forklaringen ufuldstændig eller også er der en reel regression bag. Gør tidstest til en separat "wall-clock"-klasse: median af N kørsler, relative grænser, ikke gating i fast-tier, men rapporteret. Undersøg samtidig om `MAG_GRIP_PROBE`-fejlen er reproducerbar.
- Størrelse: S–M. Risiko: L. Afhængigheder: ingen.
- Test uden headset: ja.
- Ren tilføjelse: ja (ny test-klasse); selve fejlundersøgelsen er læsning først.

**F18 — Radio/kommunikation som lille system**
- Projekt: ny `radio` (three.js + senere Godot), bruger `ai` (squad `reports`), `audio`, `missions`.
- Hvad/hvorfor: Guards rapporterer allerede til hinanden (`guard.js` "reports") [V]. Gør det hørbart (radio-knas, kald om backup, tavshed = fejlet check-in) og giv spilleren en radio til briefing, hints og kontrakt-opdateringer. Meget lav pris, høj stemning, og styrer F07's briefing uden UI.
- Størrelse: S–M. Risiko: L. Afhængigheder: F01, F07 (hvis briefing).
- Test uden headset: events, tidsstyring, "radio-check mislykkes" udløser alarm i alarms-systemet.
- Kræver headset: lydbalance (stemmerne er tekst-til-tale/syntetiske) og tydelighed.
- Ren tilføjelse: ja.

**F19 — Aftagelig rygsæk: færdiggør G2 og synk til Nightfall med harness**
- Projekt: GameSystems `gs_backpack` + NightfallContractsGodot (branch `feature/detachable-backpack`).
- Hvad/hvorfor: Scene-adapter og body-anchor er uncommitted i begge repoer (5 untracked filer i GameSystems, 18 ændringer i Nightfall) [V], og Nightfalls `gs_backpack` mangler `gs_backpack_stash.gd`, container-tests og paritetstests [V: diff]. Færdiggør, synk, kør de ni suiter med og uden flag (roadmap-kriterium), og tilføj hub-test "rygsæk" (findes ikke i `hub/tests.js` [V]).
- Størrelse: M. Risiko: M (Nightfalls player/game/backpack_rig er rørt). Afhængigheder: brugerens beslutning om grene (se spørgsmål).
- Test uden headset: eksisterende 125 golden-vektorer + nye suiter; checkpoint v2.
- Kræver headset: rækkevidde, læsbarhed, komfort (backlog siger selv at headless ikke tæller).
- Ren tilføjelse: ja (opt-in flag).

**F20 — Synk-gate på tværs af alle projekter før hver rapport/eksport**
- Projekt: GameSystems `godot/tools/sync_addons.py`, `scripts/sync-*.mjs`, Nightfall `tools/sync_extensions.mjs`.
- Hvad/hvorfor: Én kommando (`--check` i alle synkere, sammenligning modulo CRLF) der melder hvilke kopier der er bagud. Nu: `gs_bottles/bottle_pour.gd` og dens test afviger, `gs_backpack` er bagud i Nightfall [V: diff med `--strip-trailing-cr`; øvrige addons er identiske]. CRLF/LF-forskelle gør rå `diff` støjende (flere addons ser forskellige ud uden at være det) [V].
- Størrelse: S. Risiko: L. Afhængigheder: ingen.
- Test uden headset: ja.
- Ren tilføjelse: ja (script).

**F21 — Opdel `runtime/player.gd` (5605 linjer) trinvis**
- Projekt: NightfallContractsGodot.
- Hvad/hvorfor: `player.gd` er 5605 linjer [V], `backpack_rig.gd` 1274 og `game.gd` 784. Allerede nu er sling, backpack, magazine og locomotion trukket ud i egne filer (`rifle_sling.gd`, `player_locomotion.gd`…); resten gør hver ny feature (F03, F06, F19) mere konfliktfølsom. Udtræk i små, test-beskyttede trin (ren refaktor, samme 43-processer grønne).
- Størrelse: L (men kan løbe i små S-trin). Risiko: M–H (stor fil, mange tests). Afhængigheder: efter F19 (undgå merge-konflikt).
- Test uden headset: eksisterende `run_native_suite.py` + replay-tests er netop sikkerhedsnettet.
- Ren tilføjelse: nej, det er refaktor; kun hvis hver del er flytning uden adfærdsændring.

**F22 — Docs-oprydning og én statusside**
- Projekt: GameSystems `docs/` (+ README, `extensions_plan.md`, `improvement_backlog.md`), Nightfall `README.md`/`VALIDATION.md`.
- Hvad/hvorfor: se afsnit 4 (mange stale påstande, 131 KB backlog uden kronologi, README med forkert titel). En kort `STATUS.md` der pr. system viser: findes/testet/port/headset-status (ét sted) ville spare tid hver gang et nyt agent-run starter med "tjek om det findes".
- Størrelse: S–M. Risiko: L. Afhængigheder: ingen.
- Test: link-checker på docs (alle 10 VR-guides har allerede lokal-link-tjek ifølge backlog).
- Ren tilføjelse: ja (docs).

---

## 3. Anbefalet rækkefølge i bølger

Princip: først det der gør alt andet sikrere (test og sync), så billige realismeløft med stor effekt i VR, så de større gameplay-systemer, til sidst det der kræver headset eller stor refaktor.

### Bølge 0 — Hygiejne (1 til 3 dage, alt parallelt)
F16 (Godot-runner), F17 (flake + logundersøgelse), F20 (synk-gate), F22 (docs).
- Begrundelse: de er små, risikofri og øger tilliden til alle senere tal. Ingen af dem ændrer spiladfærd.
- Fil-konflikter: F16 ejer `GameSystems/godot/tests/*` og `godot/tools/`; F20 ejer `godot/tools/sync_addons.py` og `scripts/sync-*.mjs` (adskil fra F16 ved at F16 kun tilføjer ny fil `run_contracts.py`); F17 ejer `NightfallContractsGodot/tests/`; F22 ejer `GameSystems/docs/*.md` og README'er. Ingen overlappende filer.

### Bølge 1 — Billige realismeløft og målegrundlag (ca. 1 uge)
F01 (lydbus), F02 (skrab/kontaktlyd), F09 (haptik-tabel), F15 (ydelsesmåling), F12 (hit-rate-matrix).
- Begrundelse: F01/F02/F09 er små, additive og hæver realismen mest pr. time (lyd, fysik-feedback, NPC der hører). F15 giver første rigtige Quest/Frame-tal til at prioritere resten. F12 lukker G6-hullerne uden headset.
- Fil-konflikter, må ikke køre samtidigt: F01 og F02 rører begge `extensions/audio/*` (F01: ny `soundbus.js` + `ai/`-bro, F02: `audio/contact`-udvidelser og `webxr-interaction/src/interaction/physics.js`). Løsning: F01 tilføjer kun nye filer; F02 ejer `physics.js` og eksisterende audio-filer. F15 ejer `tools/headset-lab/serve.mjs`+`hub/hub.js`; nye hub-tests lægges i en ny fil `hub/tests.perf.js` der importeres, så F06/F19 kan tilføje deres tests uden konflikt (nu ligger alle i én fil [V]).

### Bølge 2 — Gameplay-systemer på de nye fundamenter (2 til 4 uger)
F19 (rygsæk færdig + synk), F06 (møbler/låse/kiste), F07 (kontraktflow v2), F05 (NPC-tegn), F13 (Godot-pursuit), F08 (lys/lommelygte), F10 (Godot-væsker).
- Begrundelse: F19 først (roadmap-afhængighed og Nightfall er rørt), så F06 (G1, bruger containerledgeren), så F07 (bruger låse som mål). F05/F13/F08 er NPC-kæden og kan køre separat fra rygsæk/møbler.
- Parallelitet uden fil-konflikt: spor A = {F19 → F06 → F07} (`gs_backpack`, `extensions/furniture`, `missions`/`core/mission_state.gd`); spor B = {F05 → F13 → F08} (`extensions/ai`, `runtime/guard*.gd`, ny lysbro); spor C = {F10} (`gs_bottles`). Spor A og B deler `runtime/game.gd` og `player.gd` i Nightfall: koordinér via små adapter-filer, ingen direkte redigering af `player.gd` (F21 venter).

### Bølge 3 — Dybde, port og alt der kræver headset (løbende)
F11 (vægt/to-hånds til Godot), F03 (vitals + første hjælp), F04 (håndværk v2), F14 (fælles AI-kerne), F18 (radio), F21 (opdel `player.gd`), samt G7: den samlede headset-pakke (rygsæk, vægt, to-hånds, lyd, lys, møbler) via hub-testene.
- Begrundelse: F11/F14 er store porte der først giver værdi, når de forrige funktioner er stabile. F03/F04/F18 er nye systemer med lav risiko men kræver F06/F07 for fuld værdi. F21 sidst, så merge-konflikter undgås.
- Parallelitet: F03, F04, F18 er uafhængige nye mapper; F11 og F14 rører `gs_grasp` og `guard*`; F21 må ikke køre samtidigt med noget der redigerer `runtime/player.gd`.

---

## 4. Kendte fejl og risici fundet undervejs

Mærkning [V]/[S]. Hver [V] har et konkret bevis i parentes.

### 4.1 Forældet eller forkert dokumentation
1. **[V]** `GameSystems/README.md` har overskriften "BlenderShared" og nævner hverken audio, backpack, `godot/addons`, Grasp Studio eller headset-lab (filen er kun 60 linjer; første halvdel beskriver demoer, anden halvdel asset-biblioteket).
2. **[V]** `extensions_plan.md` linje 1: "Status (2026-10-10): trin 1, 2, 3, 5 og 8 færdige…" er en gammel statuslinje, mens dokumentet nederst fortæller at lyd og backpack er leveret 2026-10-23/24.
3. **[V]** `extensions_plan.md`: "GameSystems er git-repo, men webxr-demo er usporet": 159 filer under `webxr-demo` er tracked (`git ls-files`).
4. **[V]** `extensions_plan.md` linje 668: "Åbent: Contracts-kobling (`interaction/grab.js`) ikke lavet" for lyd, mens `audio_system.md` og koden har den (`NightfallContractsWebXR-interaction/src/game/audio.js`, `main.js` linje 95-106, `tests/game-audio.test.mjs`). Selve `grab.js` indeholder ikke "audio", men koblingen sker via grab-events, så den ene påstand er forkert.
5. **[V]** `backpack_system_design.md` §0 pkt 2: "der findes ingen inventory/backpack/holster-kode i GameSystems/extensions/" er forkert nu (`extensions/backpack`, 1718 linjer). Dokumentet har selv §8–9 med status, men §0 og §1.6 er ikke opdateret.
6. **[V]** `pour_system.md` linje 37: "Native puddles currently retain volume/colour only: fuel identity and fire coupling are still pending" modsiger `native_puddles.md`, backlog (2026-10-12 "Afsluttet native typede pytter") og koden (`gs_thermal/gs_puddle_fire_adapter.gd` findes).
7. **[V]** `improvement_backlog.md` (131 KB, 1971 linjer): ikke kronologisk (2026-10-13 øverst, derefter 10-12, 10-11, 10-10, men så "Arbejdsregel", "Vedvarende mål" og "Næste glass-performanceopgave" bagest); to overlappende backpack-mål ("Nyt løbende delmål — fysisk VR-backpack" linje 1078 og "Vedvarende mål: fysisk VR-backpack" linje 1758); "Næste undersøgelse" (linje 1363) har punkter der selv siger "er nu implementeret". Svært at se hvad der faktisk er åbent.
8. **[V]** `goals_roadmap.md` G1 "i gang", men der er ingen `extensions/furniture` og ingen furniture-doc; G-nummerkollision (se 1.3).
9. **[V]** `NightfallContractsGodot/README.md` og `docs/VALIDATION.md` åbner med "Current evidence (2026-10-05): 43/43 processes". Siden er der arbejde 2026-10-11 til 10-19 (sling, backpack, XR-profil, glass), og runneren har nu 32 navngivne suiter plus per-avatar-checks [V: `run_native_suite.py`]. Tallet er historisk; dokumentet markerer det delvist ("Earlier counts… are historical") men README peger stadig på det som aktuelt.
10. **[V]** `ikvr_implementation.md` indeholder selv en forbehold-linje (historiske TODO'er er snapshots), men tabellerne "Tests (runde 2/3)" (fx "Contracts 398 (397 grønne; samme bottles-fejl)") kan misforstås som aktuelt. Samme gælder `game_system_ideas.md` "101/101" (korrekt mærket "historisk").
11. **[S]** `IWSDK/docs/project-next-goals.md` er dateret 2026-07-17 og `IWSDK/HANDOFF.md` 2026-05-29; de peger på `dungeon-vr` holster/grab som "unvalideret". IWSDK er et separat spor (mange `.codex-*-before-*`-backupmapper i roden), og jeg har ikke gennemgået det dybt.
12. **[V]** `DFUVR-Steam-Frame-noter.md` beskriver status "virker ikke endnu (sort skærm)" og indeholder en fælde med `pkill -f` (dræber egen ssh). Det er et stand-alone eksperiment, ikke en del af spilprojekterne; det kan konsolideres eller arkiveres.

### 4.2 Test og tooling
1. **[V]** 28 af 44 Godot-testscripts i `GameSystems/godot` står ikke i `godot/tests/README.md`, og der findes ingen samlet runner (se F16).
2. **[V]** Flaky test: `magazine-acquisition-budget` er kendt som flake og fejler også alene (STEAM_FRAME_TESTING linje 480). Den seneste log i repoet viser dog 2 fejl af en anden art (`MAG_GRIP_PROBE avatar_*: transferred magazine has a validated visible-skin hand contact`, "277 checks / 2 failures", fil dateret 2026-10-19) [V]. Mulig reel regression skjult bag "flake"-etiketten [S].
3. **[V]** 212 `.log`-filer er tracked under `NightfallContractsGodot/tests/` (git ls-files) mens `.gitignore` kun ignorerer `assets/**/source/*.log`. Det forurener historikken og gør "seneste logfil" tvetydig.
4. **[V]** `docs/headset_results.jsonl` findes ikke (G7 venter på bruger, så det forventes, men `headset_testlab.md` beskriver det som lagringsstedet). Hub-testlisten har ca. 28 poster (grupper og tests); ingen for rygsæk, `systems.html`, `fire.html`, vægt/to-hånds i Godot eller lys.
5. **[V]** Alle hub-tests (ca. 28 poster) ligger i én fil (`hub/tests.js`, 301 linjer); ændringer kræver lab-genstart (doc) og giver merge-konflikter mellem parallelle agenter.
6. **[S]** `webxr-demo/node_modules`, `dist` og `test-results` ligger i træet; `dist` og `node_modules` er ikke tracked (git ls-files viser kun 159 filer), men mappestørrelse påvirker søgning/audit.
7. **[V]** `acoustics.path()` er en O(n²) Dijkstra pr. lytter pr. lyd; med mange lyttere og mange lyde (F01) kan den blive dyr på Quest. Der er et `maxPending=128`-loft, men ingen sti-cache [V: kode]. **[S]** Kræver måling før optimering.

### 4.3 Sync og git
1. **[V]** Kun `gs_bottles` afviger i Nightfall Godot fra kilden (modulo CRLF): `bottle_pour.gd` (87 linjers diff) og `tests/gs_pour_receiver_tests.gd`. `gs_backpack` i Nightfall mangler stash, container-test og paritetstest (forventet midt i G2). Øvrige 15 addons identiske med `--strip-trailing-cr`.
2. **[V]** GameSystems `main` er 7 commits bag `feature/weight-twohand-audio-mix` (hvor audio, vægt, to-hånds og backpack-kernen ligger); WebXR-Contracts er på `feature/weight-twohand-mix`; Nightfall Godot på `feature/detachable-backpack` med 18 uncommitted ændringer. Alle to stort set arbejder på grene som aftalt, men der er flere parallelle grene uden en plan for merge.
3. **[V]** `CharacterStudio` (clone af M3-org/CharacterStudio) har `.env`, `cert.pem` og `key.pem` tracked i git (`git ls-files`). Det er upstream, ikke brugerens kode, men brug ikke nøglerne til noget og undgå at pushe forks med dem. **[S]** Lav risiko.
4. **[V]** GameSystems har `tools/headset-lab/cert/{cert.pem,key.pem}` på disken; de er ikke tracked (ingen `pem` i `git ls-files`). Godt.
5. **[V]** Nightfall Godot og WebXR har hver `AGENTS.md`; `extensions_plan.md` nævner at WebXR-`AGENTS.md` kræver en bestemt agent-model, og at reglerne skulle opdateres i trin 2/5. Jeg har ikke åbnet WebXR-`AGENTS.md` i denne audit, så om den er opdateret er **[S]** ukendt.

### 4.4 Kode og arkitektur
1. **[V]** `sound:emit` har ingen producenter (se 1.1). `acoustics` default-extension er derfor reelt ubrugt i spil.
2. **[V]** `tools`: `use()` accepterer kun `screwdriver` (skrue) og `hammer` (søm); alle andre værktøjer afvises som "tool" [V: kode]. Ikke en fejl, men en grænse docs ikke fremhæver.
3. **[V]** `workshop`-ventilen er ikke koblet til et flow (kun aflæsning).
4. **[V]** `player.gd` 5605 linjer (se F21).
5. **[V]** To uafhængige guard-AI'er (JS `ai/guard.js` og Godot `runtime/guard.gd`) med fælles oprindelse men ingen automatisk paritet.
6. **[V]** Godot mangler vægt-lag, to-hånds, albue-hint, proceduralgreb og GameSystems-lyd (se 1.2).
7. **[V]** README i Nightfall Godot siger "No navmesh-driven … pursuit", men koden bager en NavigationMesh til lokal positionering (`guard_squad.gd:252`). Ikke en fejl; formuleringen kan misforstås.
8. **[S]** Glass HIGH-træf 10,47 ms (budget 11,11 ms ved 90 Hz) [V: backlog, desktopkalibrering]: kan ikke bruges på Quest uden staged-bygning; allerede en åben opgave.
9. **[V]** Ingen af de seneste headset-relaterede påstande er hardwareverificeret: backlog og docs mærker det selv konsekvent ("Headsetkomfort … uvalideret"). Det er korrekt, ikke en fejl, men det betyder at ydelse på Quest/Frame stadig er et blindt punkt (F15).

---

## 5. Spørgsmål til brugeren (valg kræves)

1. **Primær runtime for nye systemer:** Skal nye gameplay-systemer (vitals, møbler, kontraktflow) bygges i three.js først med Godot-port (som backpack-mønstret), eller i Godot først fordi Nightfall Godot er det spil der lever? Det styrer hele bølge 2.
2. **Grene:** GameSystems `main` er 7 commits bag; må feature-grenene merges til `main` (og må de pushes)? Roadmap-reglen siger "commit kun på grene, aldrig push uden aftale", så jeg gør intet uden svar.
3. **G1/G3 rækkefølge:** Skal møbler/låse (F06) have forrang over færdiggørelse af den aftagelige rygsæk (F19), eller omvendt? Roadmap siger G2 før G3, men F06 genbruger containerledgeren.
4. **Opt-in-politik:** Skal nye systemer som vitals/lys/pursuit holdes helt fra som standard (som hidtil), eller må de være slået til i en "hardcore"-profil i den færdige Nightfall-build?
5. **Ydelsesmål:** Hvilket mål er primært: Quest 3 browser-WebXR, Steam Frame (ARM64 native Godot) eller PCVR? Hvilken frame-rate (72 eller 90 Hz)? F15 og alle tier-valg afhænger af det.
6. **G7-hardwaretest:** Hvilken rækkefølge på hub-testene vil du prioritere først (rygsæk, vægt/to-hånds, lyd, væsker)? Jeg foreslår at F15 bygges først, så hver headset-session producerer tal.
7. **Kontraktstruktur:** Skal Blackwater Relay forblive én kontrakt, eller skal F07 designes til flere kontrakter i samme bygning (briefing → valg → udbetaling)?
8. **Logfiler:** Må de 212 tracked `tests/*.log` i NightfallContractsGodot fjernes fra git og ignoreres?
9. **Docs-oprydning:** Må `improvement_backlog.md` (131 KB) opdeles i `STATUS.md` (åbne punkter) og et arkiv (afsluttede runder) uden at ændre indholdet?
10. **Sekundære projekter:** Skal IWSDK, CharacterStudio, makehuman-js, NightfallContracts (original WebXR) og NightfallHandsFixture med i næste audit, eller kun gøres til arkiv? (Jeg har kun kigget; ingen action er foreslået for dem.)
11. **Lyd:** De 160 nye lyde er syntetiske ifølge docs. Vil du have en lyttesession først (høre dem) før F01/F02 bygger mere ovenpå, eller en plan for at erstatte dem med bedre kilder?

---

## 6. Idéer til nye game systems, vurderet efter værdi/pris

Værdi = effekt på realisme og brugbarhed i VR (ikke kosmetik). Pris = S/M/L omtrent som ovenfor. "Passer" = hvor det passer ind i de eksisterende systemer.

| Idé | Værdi | Pris | Passer ind i / bygger på | Bemærkning |
|---|---|---|---|---|
| Åbne/lukke/låse (skabe, døre, kister) | Høj | M–L | `mechanics`, backpack-container, `audio/creaks.js` | = F06/G1. Dirk og nøglekort er der selv spilgevinsten ligger |
| Hænder-baseret håndværk/værktøj | Høj | M–L | `tools`, `grasp`, workshop | = F04. Skruenøgle, tang, tape, reparation |
| Skader pr. kropsdel + første hjælp | Høj | M–L | gore-regioner, backpack-forbrugsvarer | = F03. Bandage i rygsæk, to-hånds tryk. Komfort er hovedrisiko |
| Lommelygte + lys som gameplay | Høj | M | `electricity`, `ai`-perception | = F08. Billig atmosfære, direkte gameplay |
| Tegn på NPC-opfattelse | Høj | S–M | `ai` suspicion, audio | = F05. Meget lav pris |
| Radio/kommunikation | Middel–høj | S–M | `ai` reports, `missions`, `audio` | = F18 |
| Kamera/overvågning med konsekvens | Høj | S–M | `cameras`, `electricity`, `alarms`, `ai` | Systemet findes (cameras + security.html); mangler at guards ser på monitorer og at man kan slukke kameraer ved at skære strøm (sikring findes). Næsten kun kobling |
| Opbevaring og stabling (kasser, hylder, snap-zoner) | Middel | M | backpack-container, `mechanics`, to-hånds | Snap-zone + stabilitetsregel (ingen fuld rigid-body stak); god til lagerscener |
| Dekaler (skud, blod, pletter) | Middel | S–M | gore effects, `materials` plet, Godot `bullet_hole_mark`/`blood` | Fælles dekal-pool med loft pr. tier; synlig realisme billigt |
| Vejr (regn/vind) | Middel | M–L | `materials` vådhed, `smoke`, `audio` | Regn gør overflader våde (materials findes), vind påvirker røg. Dyrt på Quest hvis partikler; start med lyd + vådhed uden partikler |
| Fodspor/spor og våde gulve | Middel | S–M | `materials` friktion, `audio` fodtrin, `ai` footstep | Vådt gulv: højere fodtrinslyd + glid. Kobler tre eksisterende systemer |
| Døre/vinduer brydes (spark, brydning) | Middel | M | `glass`, `mechanics` | Glas er langt fremme; dørbrud er ny |
| Haptik-tabel | Middel–høj | S | alle events | = F09 |
| Brandslukker/skumværktøj i hånden | Middel | S | `sprinklers`, `flow`, coatings (skum) | Brandstationsdemo findes; en håndholdt slukker er mest en genstand + dosisadapter |
| Nøglekort/RFID på elektriske låse | Middel | S | `electricity`, F06 | Billig udvidelse når låse findes |

Anbefalet "kobling først"-genvej (højest værdi/pris): F01 lydbus, kamera-konsekvens, fodspor/våde gulve og tegn på NPC-opfattelse kræver næsten kun forbindelser mellem systemer der allerede findes.

---

## 7. Hvad jeg ikke har gjort

- Ingen tests kørt, ingen processer startet; tal for test/suiter er fra dokumenter eller filtællinger.
- IWSDK, CharacterStudio, makehuman-js, NightfallContracts (original WebXR), NightfallHandsFixture er kun overfladisk kigget på; CharacterCreator* er ikke åbnet.
- `improvement_backlog.md` er ikke læst linje for linje (131 KB); jeg har læst alle overskrifter, de åbne/"næste"-afsnit og de nyeste afsnit. Ældre "Afsluttet"-runder (2026-10-10 til 12) er kun sampled.
- WebXR-Contracts `AGENTS.md` og Godot-Contracts `AGENTS.md` er ikke gennemgået i detaljer.
