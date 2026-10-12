# Løbende forbedringer af GameSystems

Mål oprettet 2026-10-10: find, løs og verificér konkrete forbedringer. Når aktive opgaver er løst,
fortsættes med nye fund i brandsystemet eller de øvrige systemer. En tom opgaveliste afslutter ikke målet.

## Afsluttet GearInventory root-rebind-runde — 2026-10-12

Scene-adapteren afviser nu skift af owner-root, mens inventory-ledgeren stadig har
registrerede genstande hos den owner. Det forhindrer, at håndbårne eller world-ejede
genstande bliver hængende under en gammel scene-root, mens ejerskabet fortsat peger
på den nye. Samme root er et sikkert no-op; root-skift er tilladt, når owneren er tom.

Verifikation: GameSystems scene-adapter **82/82**; Nightfall rygsæk-/inventory-udsnit
**13/13 processer, 502 checks**; sync `--check` består. Sol-review uden blocker.

## Afsluttet kamera-render reentrancy-runde — 2026-10-12

En scene-komponents `onBeforeRender` kunne kalde samme kamera-systems `step()` igen, mens feedets
render-target allerede var aktivt. Det gav rekursiv rendering og kunne forvrænge feed-ure/cursor.
`step()` afviser nu nested kald før clock ændres og frigiver guard i `finally`, også ved fejl.
Regressionen bekræfter både afvisning og at næste normale frame virker.

Verifikation: fokuseret kamera-suite **11/11**, fuld WebXR-demo Node-suite **526/526** og Sol-review
uden blocker. Browser/UI-adfærd er uændret; hardware-performance er fortsat ikke målt.

## Afsluttet bottle-factory lifecycle — 2026-10-12

`GSBottleExtension.create_bottle()` afviser nu ikke-finite fyldniveau, manglende modelressource
og forældre uden for extensionens aktive scene, før den asserting bottle factory kaldes. Flasker
tilføjes til scenen før tracking, og beholdte API-referencer kan ikke genoprette listeners efter
disposal. Kilde-suite **21/21**, Nightfall integration **25/25**; Sol review uden blocker.
Pushet som GameSystems `6ec987d` og synkroniseret/pushet til Nightfall `105873a`.

## Afsluttet sprinkler-lifecycle-runde — 2026-10-12

Sprinkler callbacks kan ikke længere starte et indlejret tick, checkpoint/restore eller ændre/dispose
systemet midt i simuleringen. Et kast fra en event observer springer ikke væskedeposit over eller
genbruger et allerede debiteret fast tick; checkpointing venter, indtil køen af hele ticks er drænet.

Verifikation: fokuseret suite **16/16**, fuld WebXR-demo Node-suite **503/503** og uafhængig Sol-review
uden blocker. Ændringen er pushet til GameSystems `main` som `72e63d0`.

## Afsluttet electricity-solver lifecycle-runde — 2026-10-12

Synkrone strøm-observers kan fortsat læse nettilstand, men nested solve/step, batteri- og
topologimutation samt restore-commit afvises, mens solver eller tidsstep er aktivt. Eventets
energi-resultat er en kopi, så observermutation ikke ændrer receipt fra `step()`.

Verifikation: fokuseret electricity-suite **15/15**, fuld WebXR-demo Node-suite **505/505** og
Sol-review uden blocker. Ændringen er pushet til GameSystems `main` som `2d52bdf`.

## Afsluttet termisk brændstof-eventrunde — 2026-10-12

`thermal:burned` udsender nu et frosset payload, så en tidligere synkron listener ikke kan ændre
joulebeløbet før pytter og flasker debiterer deres brændstofledgers. Listener-fejl bliver fortsat
isoleret af eventbussen, så senere forbrugere modtager hændelsen.

Verifikation: fokuseret fire/pool-batch **31/31**, fuld WebXR-demo Node-suite **506/506** og Sol-review
uden blocker; den uafhængige bogføringssuite bestod **12/12**. Pushet til GameSystems `main` som
`a90c0d6`.

## Afsluttet fire-scene checkpoint-ledger-runde — 2026-10-12

Fire-scene restore kræver nu, at hele flaskeejede pytvolumen stadig findes i de forberedte pooldata.
Et ellers balanceret snapshot, der fjernede pyt og thermal node og bogførte volumen som removed,
blev tidligere accepteret og efterlod flaskevolumen uden rumlig owner. Uoverensstemmelsen afvises
før scenen ændres.

Verifikation: checkpoint-suite **21/21**, fuld WebXR-demo Node-suite **507/507** og Sol-review uden
blocker. Pushet til GameSystems `main` som `8260879`.

## Afsluttet flow-callback leveringsrunde — 2026-10-12

Når supply-draw og emitterens emitted/pulsed ledger er committet, forsøger flow nu både `flow:deposit`
og `liquid:deposit`, selv hvis effekt-callbacken eller den første emitter kaster. Den første fejl
rapporteres efter begge receipt-forsøg, og den allerede bogførte levering må ikke gentages.

Verifikation: flow-suite **16/16**, fuld WebXR-demo Node-suite **509/509** og Sol-review uden blocker;
ændringen er pushet til GameSystems `main` som `73d3229`.

## Afsluttet alarm-step observer-fejl-runde — 2026-10-12

Alarm-systemet færdiggør nu hele det faste detector-batch, selv hvis en event-observer kaster.
Første fejl rejses først efter notifikationerne og efter at `busy` er frigivet; disposal stopper resten
af arbejdet uden at skjule den oprindelige observer-fejl.

Verifikation: fokuseret alarm-suite **16/16**, fuld WebXR-demo Node-suite **511/511** og Sol-review
uden blocker; uafhængig alarm-fil **11/11**. Pushet til GameSystems `main` som `1fa93d8`.

## Afsluttet acoustics callback-fejl-runde — 2026-10-12

Når lydleveringer er forfaldne, forsøger acoustics nu hver listener og dens `acoustics:heard`-event,
selv om en callback fejler. Step-guard frigives, og første fejl rapporteres efter alle leveringer.

Verifikation: fokuseret system-suite **25/25**, fuld WebXR-demo Node-suite **512/512** og Sol-review
uden blocker. Pushet til GameSystems `main` som `f00a6f0`.

## Afsluttet vehicle-step observer-fejl-runde — 2026-10-12

Køretøjets `step()` fuldfører nu beregnet brændstof-/strømforbrug, bevægelse og delopdateringer for
alle biler, selv hvis `vehicle:stopped` eller `vehicle:part` observers kaster. Første fejl rejses
efter batchen; direkte `stop()` beholder sin synkrone eventsemantik.

Verifikation: fokuseret køretøjsbatch **32/32**, fuld WebXR-demo Node-suite **513/513**, Sol-review
uden blocker og uafhængig vehicle-motion/vehicle suite **26/26**. Pushet som `be0f965`.

## Afsluttet mechanics hold-ejerskabsrunde — 2026-10-12

Hold-nøgler koder nu `(mechanism_id, owner)` som en tuple i stedet for kolon-join. Fjernelse af `door`
kan derfor ikke fjerne grebet på `door:inner`, og kolon i både mechanism-ID og owner skaber ikke
kollisionsaliaser. Hold-records matcher removal på præcis mechanism-ID.

Verifikation: fokuseret `new-systems`-suite **26/26**, fuld Node-suite **514/514**, Sol-review uden
blocker. Pushet til GameSystems `main` som `7315101`.

## Afsluttet camera-feed fairness-runde — 2026-10-12

Et renderer-kast flytter nu round-robin-cursoren forbi det fejlede feed, før fejlen rapporteres.
Dermed kan et konsekvent defekt kamera ikke sulte raske feeds; vellykkede renders fra samme step
opdaterer stadig deres textures.

Verifikation: fokuseret camera-suite **10/10**, fuld Node-suite **515/515**, Sol-review uden blocker.
Pushet til GameSystems `main` som `55379ba`.

## Afsluttet grasp motion-tidsvalidering — 2026-10-12

`pushHandMotion` afviser nu ikke-finite `dt`, før sample-historik eller cached hastigheder røres.
`Infinity`, `-Infinity`, `NaN`, nul og negative tider lader både sample-vinduet og publiceret motion
uændret, så `Infinity / Infinity` ikke kan forgifte håndhastighed med `NaN`.

Verifikation: grasp-suite **6/6**, fuld GameSystems Node-suite **516/516**, Contracts WebXR
interaction-grab **17/17**, Sol-review uden blocker. Pushet til `main` som `255609e`.

## Afsluttet VRM eye-offset world-matrix-runde — 2026-10-12

`eyeOffset()` opdaterer nu root og ancestor matrices, før den konverterer øjenpositioner til root-lokal
offset. Resultatet ændres derfor ikke, når avatar eller parent flyttes/roteres efter sidste renderer-opdatering.

Verifikation: character-vrm-suite **9/9**, fuld GameSystems Node-suite **517/517** og Sol-review uden
blocker. Pushet til GameSystems `main` som `d7189dc`.

## Afsluttet tools socket-ejerskabsrunde — 2026-10-12

Et tomt socket kan ikke længere oprettes med `installed: true`; occupancy opstår kun gennem en
gyldig part insertion, så ingen installeret del kan mangle `partId` og blive umulig at fjerne.
Forudinstallerede skruer og søm er fortsat gyldige.

Verifikation: fokuseret `new-systems`-suite **27/27**, fuld Node-suite **518/518** og Sol-review uden
blocker. Pushet til GameSystems `main` som `3840d10`.

## Afsluttet mission-start reentrancy-runde — 2026-10-12

`start()` afviser nu en nested start under den aktive transition før endnu et run oprettes. Start-guard
frigives også, hvis input- eller event-callback kaster; reset fra evaluator og start efter terminal
state er uændret.

Verifikation: mission-suite **6/6**, fuld Node-suite **519/519**, Sol-review uden blocker. Pushet til
GameSystems `main` som `1be7096`.

## Afsluttet humanoid skeleton-point validering — 2026-10-12

Skeleton-checker og hand completion kræver nu præcis tre finite koordinater pr. joint. Tomme,
forkortede eller ikke-finite fingerpunkter tæller korrekt som manglende grebskæde, og håndsynthese
reparerer dem kun når wrist/underarm-ankrene selv er gyldige.

Verifikation: humanoid-suite **2/2**, fuld Node-suite **521/521**, Sol-review uden blocker.
Pushet til GameSystems `main` som `1716a40`.

## Afsluttet Cannon adapter timestep-validering — 2026-10-12

`step(dt)` afviser nu `NaN`, infinities og negative tider før Cannon state ændres; nul er et no-op.
Det forhindrer NaN-accumulator poisoning og tillader efterfølgende gyldige fysiksteps.

Verifikation: physics-adapter **8/8**, fuld GameSystems Node-suite **522/522**, Sol-review uden
blocker og Contracts-kopien/hash er matchet. Pushet til `main` som `6ef7cb0`.

## Afsluttet workshop partial-init cleanup — 2026-10-12

Workshop init ejer nu eksplicit de registreringer, listeners, acoustic rooms/portals og fuse grabs,
som den selv har erhvervet. En senere konflikt eller callback-fejl rydder kun disse op, bevarer
konfliktens eksisterende objekt og tillader retry. Fuse release-tokenet bevarer korrekt håndejerskab.

Verifikation: fokuseret workshop/system-suite **30/30**, fuld Node-suite **525/525**, Sol-review uden
blocker. Pushet til GameSystems `main` som `af3658b`.

## Afsluttet WebXR-grenkonsolidering — 2026-10-11

De seks commits fra `interaction-port` — bottle liquid controls/foam, GameSystems-syncs og
extension-host lifecycle-fix — er flettet ind i `main` i
[`kblood/NightfallContractsWebXR` PR #1](https://github.com/kblood/NightfallContractsWebXR/pull/1).
Efter merge blev den lokale checkout sat på `main`, og den nu indeholdte lokale/remote feature-gren
blev fjernet. WebXR forbliver et selvstændigt projekt; dets kode er ikke flyttet ind i Godot/Steam Frame.

Verifikation: fuld WebXR `npm test`-suite består 339/339 efter merge; checkout matcher `origin/main`.

## Afsluttet GameSystems-grenkonsolidering — 2026-10-11

`codex/liquid-opacity-depth-write` er flettet ind i `kblood/GameSystems` `main` via
[PR #1](https://github.com/kblood/GameSystems/pull/1). Den lokale GameSystems-checkout
følger nu `main`, og den flettede feature-gren er fjernet fra både lokal branch-liste og remote.
Ændringen holder fuldt opaque Godot-væske i depth-writing render pipeline og skifter til alpha
shader ved translucency.

Verifikation: Godot 4.7.2 `liquid_controls_test.gd` passerer (`LIQUID_CONTROLS_OK`); lokal `main`
matcher `origin/main`. Igangværende, urelaterede GameSystems-ændringer blev bevaret.

## Afsluttet Godot-grengennemgang — 2026-10-11

De lokale `blood`, `npc-ai`, `interaction-fix` og `worktree-opus-physical-grasp` branches i de
to ældre NightfallContractsGodot-kloner var alle allerede forfædre til `origin/main`; deres
kode og tests var derfor indlemmet i projektets kblood-repository. Begge kloner er fast-forwardet
til commit `33a84d0` på `main`, og de indlemmede lokale branchnavne er fjernet. De to kloners
genererede Godot `.uid`-artefakter og Python-cache blev bevaret i lokale Git-stashes, da nogle UID'er
afviger fra den primære checkout. Steam Frame/Godot forbliver separat fra WebXR.

Verifikation: begge kloner matcher `origin/main`; ingen af de gennemgåede branches havde commits
foran remote `main`. De primære GameSystems-, WebXR- og Godot-checkouts forbliver hver på deres egen
`main`.

## Nyt løbende delmål — VR-backpack

Færdiggør og verificér et selvstændigt, genbrugeligt VR-backpack-system med fysisk adgang inspireret af
*The Walking Dead VR*: spilleren åbner tasken med hånden, ser afgrænsede lommer og tager faktiske
genstande ud. Inventory-ledgeren ejer slot og genstand; spillets objekter ejer deres egen ammunition,
væske og gameplay-tilstand. Samspil mellem systemerne skal bruge stabile ID'er og atomiske overførsler.

NightfallContractsGodot har nu en fungerende håndbetjent rygsæk med tre indvendige lommer,
udvendige mounts, reach-/occlusion-regler, weapon-/magasin-integration og et Blender-authored,
tekstureret canvas asset integreret i runtime-scenen. De fire visuelle meshgrupper bevarer de
eksisterende slot-/håndtagsankre, bruger 13.982 trekanter og tilføjer ingen kollidere eller
løbende fysik. Asset-, importer- og hinge-kontrakter er grønne. Den seneste backpack-kørsel
består 8/8 processer og 256 headless-checks; dette beviser ikke headset-fit. Det aktive
arbejde er headset-afprøvning og eventuelle målte forbedringer af komfort, rækkevidde og læsbarhed samt
fortsat kontrol af tracking-tab, afbrudt greb og checkpoint/lifecycle-regressioner. Undgå
stof-/lynlåsfysik og kontinuerlig simulation af opbevarede genstande; hold løsningen eventbaseret.
Headless-tests må ikke tælle som headset-accept. Detaljer og acceptkriterier står i
[`NightfallContractsGodot/docs/vr_backpack_weapon_system.md`](../../NightfallContractsGodot/docs/vr_backpack_weapon_system.md)
og [`NightfallContractsGodot/docs/backpack_runtime.md`](../../NightfallContractsGodot/docs/backpack_runtime.md).

Dette er et delmål under det aktive, vedvarende forbedringsmål og afslutter det ikke.

## Afsluttet våbenkatalog-valideringsrunde — 2026-10-11

Våbenkataloget afviser nu kapaciteter over `WeaponState`'s 128-skudsgrænse, ukendte eller dobbelte
fire modes, ugyldig default mode og skudhastigheder uden for runtime-intervallet 0,03–2 sekunder.
Det forhindrer kataloget i at godkende profiler, som gameplay-adapteren senere afviser. Kildetesten
ligger i GameSystems; den genererede addon-kopi i NightfallContracts er synkroniseret og drift-kontrolleret.

Verifikation: 19/19 GameSystems-kildetests og fire NightfallContracts-processer for katalog, våbenvarianter,
weapon gameplay og backpack-våben består. Headset-fit og balance er fortsat en separat enhedsaccept.

En ekstra Nightfall-regression dækker nu et ugyldigt valgt våben ved player-opstart: runtime falder tilbage
til Kestrel med intakt 15-skuds state, og `firearm_load_errors` beholder den maskinlæsbare årsag. Den
målrettede firearm-variant-suite består 75 checks; Sol har godkendt testen.

## Nyt åbent delmål — selvstændigt våben-loadout og live switching

`gs_weapon_loadout` er nu et host-agnostisk GameSystems-addon, der holder hvert våbens uigennemsigtige
tilstand og præsentationsreferencer samlet. Værten godkender policy og anvender våbnet før det aktive
ID offentliggøres; afviste valg ændrer derfor ikke aktivt loadout. Callback-mutationer og ugyldige
boolean-resultater afvises. Addonet er committed i GameSystems `main` (`3338928`) og synkroniseret
som arbejdskopi til NightfallContractsGodot.

Verifikation: loadout-kontrakten **25/25** og våbenkataloget **19/19** består; Sol-review fandt ingen
blocker. Nightfall-runtime integration er under arbejde: fysisk stuvning/hentning, isoleret state pr.
våben, magasinidentitet og atomisk afvisning skal stadig bestå målrettede tests og review.

### Nightfall-integration — første verificerede milepæl — 2026-10-12

NightfallContractsGodot har nu handlingsbaseret skift: det aktive våben skal stues i rygsækken,
før et andet hentes. Våbnene beholder separat ammunition, chamber og magasin-tokenidentitet.
Rygsækkens aktuelle kapacitet giver Kestrel, Morrow, Shear og én rifle ad gangen (Tern eller
startup-valgt Rook). Checkpoint v2 gemmer per-våben ammunition/chamber, magasin-tokenidentitet,
aktivt våben, inventoryplacering og drawn/holstered-tilstand. Restore validerer hele roster og
inventory før commit og ruller sent slotkonflikt tilbage; v1 accepteres fortsat kun for én weapon
context. Skift og missionsbinding er pushet til Nightfall `main` som `1737af9` og `f31bc66`, og
checkpointet som `4941f3a`. GameSystems-registryens `restore_active_entry`-API blev pushet som
`83679e8`.

Verifikation: sidste fokuserede våbensuite **117/117** bestod uafhængigt under Sol-review;
implementeren rapporterede 9/9 relaterede suites, loadout-kildekontrakten **27/27** og ren addon-sync.
Headset-fit og XR frame pacing mangler fysisk headset-accept. Fortsæt med headset-validering og nye
forbedringer, når aktive fund er lukket.

## Afsluttet Aster-ekstern ressource-afbrydelsesrunde — 2026-10-12

Aster slukker nu motoren straks, hvis en aktiv ekstern brændstof- eller strømforsyning bliver
utilgængelig. Alternator-drevne lamper opdateres, før `engine_changed` udsendes, så synkrone lyttere
ser den færdige visuelle tilstand. Den delte Blender-bil og resource-adaptere er tilføjet
NightfallContractsGodot og pushet til `kblood/NightfallContractsGodot` (`e7ee55c`).

Verifikation: målrettet Aster/shared-resource-suite **21/21**, samlet native Aster-validering
**130 checks**, Blender 5.2.2 read-only validering og isoleret import består. Sol-review bekræftede
regressionstesten. Aster er stadig en interaktiv asset-/panelprototype, ikke en kørebar missionsbil.

## Afsluttet inventory-root-lifecycle-runde — 2026-10-11

Scene-adapteren afviser nu item-registrering sikkert, hvis et konfigureret owner-root er blevet
frigivet eller står uden for scenetræet. Tidligere kunne hierarkikontrollen dereferere en fri
root og give en engine-fejl. Når root erstattes med et gyldigt håndanker, kan registrering igen
fortsætte. Addon-kilden er synkroniseret til NightfallContracts.

Verifikation: 61/61 målrettede scene-adapterchecks og 8/8 relevante backpack-/inventory-processer
består. Magasiner slettet fra tasken og permanente scene-detach frigiver fortsat deres slot-claims.

## Afsluttet genbrugelig gear-inventory lifecycle-runde — 2026-10-11

`gs_gear_inventory` har nu en selvstændig Godot-kildekontrakt for ledger-forbrug/unregistering,
og scene-adapteren rydder slot claims ved både permanent detach og ekstern destruction. Sol-review
fandt ingen blocker: expected-owner validering, reverse-slot-index, deferred tree-exit cleanup og
Nightfall-kopiens manifest stemmer. Review-hærdning tilføjede også synkron `free()` af et slotted item
foruden `queue_free()`.

Verifikation: GameSystems ledger **57/57**, scene adapter 65/65, alle fem GameSystems Godot-addon-suiter
**212 checks samlet**, addon sync-check og Nightfall adapter-kontrakten 65/65 består på Godot 4.7.2.
Den afsluttende source-ledger-runde dækker også `equipped`-ejeren for våben ved transfer, checkpoint
restore og reset; den samlede kildepakke er staged til review, endnu ikke committed.
Kørsel af Nightfall headless-testen kræver `--xr-mode off`; almindelig fallback uden headset gav ikke
frameticks i denne direkte script-kørsel.

## Afsluttet extension dependency-lifecycle-runde — 2026-10-11

Extension hosten lukker nu transitive afhængige extensions ned, før en navngiven dependency fjernes.
Det forhindrer eksempelvis `flow` i at blive stående som klar efter `supply` er disposed og gør også
igangværende dependent-init ugyldig. En async init, der afsluttes sent, kører `dispose()` præcis én
gang; sene init-fejl rapporteres fortsat med deres korrekte fase.

Verifikation: host- og supply→flow-regressioner, herunder sen succes/fejl efter annullering, består.
Hele WebXR-demoens Node-suite består 491/491 tests. GameSystems-host-kopien og NightfallContractsWebXR-
kopien er synkroniseret; Sol reviewede ændringen uden resterende blocker.

## Afsluttet Aster-adapterkontrakt og interaktionsrunde — 2026-10-11

Godot-bilens eksterne væske- og strøm-adaptere kræver nu eksplicit reversibilitet og validerede,
begrænsede state-former. Ugyldige adapters afvises atomisk, og en delvis strømudtagning refunderes
præcist. Det bevarer en let lokal store som fallback og lader værten koble bilen på fælles systemer.

GameSystems har nu `gs_resource_adapters`: en begrænset, navngiven væsketank, en reversibel
brændstofadapter og en reversibel batteriadapter. Adapterne er synkroniseret til
NightfallContractsGodot og koblet direkte til Aster. Bilen kan fyldes fra petrol-komponenten,
forbruge fælles brændstof, trække startstrøm og returnere generatorladning uden at blande diesel
ind i benzinforbruget. Simple og disabled vehicle modes er stadig tilgængelige.

Verifikation: 25/25 kildechecks for adapters, 12/12 Aster/shared-resource integrationchecks,
112 native Aster-kontraktchecks og 1.439 panelinteraktionschecks består. Isoleret import består,
og Sol reviewede adapterkontrakten uden blocker. Fysisk rør-/ledningsnet, kredsløb og headset-
gennemgang af bilens VR-paneler er fortsat åbne, særskilte opgaver.

## Afsluttet væske-opacitet-runde — 2026-10-11

Designfeltet `opacity` styrer nu væskens gennemskinnelighed i Three.js og Godot over samme referencevej,
med intervallet 0–1. Skum forbliver uigennemsigtigt. Liveændringer opdaterer rendervejen og vækker
væskedriveren; Three.js- og Godot-designhelpers bevarer indstillingen ved kvalitetstrinsskift.

Verifikation: 487/487 GameSystems-WebXR unit-tests, 339/339 Contracts-WebXR tests, produktionsbuild,
13/13 browserkontroller inklusive faktisk authored designværdi og runtime-rendering samt Godot
liquid-controls accepttest består. Godot headset/renderhardware er ikke testet.

## Afsluttet hvileskum-runde — 2026-10-11

Væskedesign kunne kun danne skum efter rystning. Et separat `foam_static`-felt giver nu en
vedvarende skumtop i hvile uden at tvinge væskedriveren til at køre; eksisterende `foam`
styrer stadig mængden, som rystning kan danne. Liveændringer vækker controlleren, headet
overlever tier-skift, og værdierne er afgrænset til 0–1.

Verifikation: dedikerede Three.js- og Godot-tests for authored værdier, awake/sleep, grænser
og tier-skift; GameSystems 486/486, WebXR Contracts 339/339, 12/12 browserchecks og production
build består. Sol reviewede idle/sleep- og tier-adfærden uden blocker. Godot MINIMAL udelader
fortsat skum som sin eksisterende shader-optimering.

## Afsluttet væskefarvekontrol-runde — 2026-10-11

`tint_strength` blev gemt i designs, men blev ignoreret af shaderne. Det styrer nu Beer-Lambert-
absorption i Three.js og Godot med samme 0–4 interval; 0 fjerner farveabsorption, 1 bevarer den
authored farve, og eksisterende stærkere sidecar-værdier virker fortsat. Det gør ikke væsken
transparent. Ændringer vækker
kontrollerne, og værdien overlever tier-skift. Schema, API-dokumentation og acceptancetest er
opdateret.

Verifikation: 486/486 GameSystems-tests, 339/339 WebXR Contracts-tests, 12/12 systems-browserchecks,
Godot-væsketest og produktionsbuild består. Sols uafhængige review fandt ingen kildefejl.

## Afsluttet rude-checkpoint-runde — 2026-10-11

- Logisk rude-state (brudt/hel, skadesniveau, huller og revner) gemmes og gendannes sammen med flaskesystemets øvrige state. Fysiske skår er fortsat transient debris og genskabes ikke.
- Restore-planer kontrollerer igen rude-topologi og objektidentitet ved commit, før de rydder eller muterer ruderne.
- Urealistisk store hul-/revnekoordinater afvises før Float32-geometri oprettes.
- Hver revnelinje ejer sit materiale, så budget-eviction ikke frigiver materiale for stadig synlige revner.

Verifikation: 33/33 målrettede flaske-/checkpointtests, 469/469 GameSystems-tests, 339/339 Contracts-tests, produktionsbuild og 8/8 checkpoint-browserkontroller består. Sols review fandt ingen yderligere konkrete fejl.

## Afsluttet pool-ignition-performance-runde — 2026-10-11

Hvilende pytters oxygen-gate hentede tidligere `thermal.capture()` for hvert antændelsesforsøg. Det kopierede hele thermal-verdenen selvom kun den faste systemkonfiguration skulle læses. Ambient og oxygen-cutoff caches nu én gang, når pool-systemet oprettes; ignition spørger stadig det aktuelle rums oxygen via `roomState`.

Verifikation: regressionen bekræfter nul thermal-captures på dormant ignition; 48/48 målrettede pool-/brandtests, 470/470 GameSystems-tests, produktionsbuild og 9/9 pool-browserkontroller består.

## Afsluttet runde — 2026-10-10

- Atomisk indlæsning af pytter: ugyldige data, id-konflikter og budgetfejl valideres før live tilstand erstattes.
- Vådhed, varme, skum, igangværende forbrænding og eksplicitte varmeforbindelser bevares ved indlæsning.
- Pyt-id'er kan ikke genbruges på en anden flade/et andet rum; genererede id'er kan ikke kollidere efter indlæsning.
- Direkte indeks fra termisk id til pyt erstatter gentagne lineære opslag under forbrænding.
- Termisk konfigurering er atomisk, slukker straks under slukningstærsklen og afviser ugyldige tærskler.
- Substep-budget afviser ekstremt dyr catch-up uden at ændre tilstanden; NaN i iltgrænsen afvises.
- Kilden til hver væskekomponent bevares. Slangevand og ekstern olie debiteres ikke på dunkens ledger.
- Fjernelse/opsamling tælles særskilt fra forbrænding. Rydning og kilde-reset debiterer ikke samme væske to gange.
- En flaske-runtime kan ikke få to samtidige pool-bridges; disconnect er idempotent ved genbinding.
- Automatisk spredning afhænger ikke længere af objekternes registreringsrækkefølge.
- Brand-labben kan opsamle en valgt pyt og fjerner dens gamle flammer, grafik og ugyldige genstandsvalg.

Verifikation: 63/63 målrettede tests, produktionsbuild samt 13/13 brand-browser- og 12/12 system-browserkontroller består.
20 nye regressionstests blev tilføjet i denne runde. Samlet GameSystems-suite: 146/147; Contracts: 338/339.
De to resterende regressioner er i VRM/greb, hvor en anden agent arbejder; detaljer står i `fire_v2_handoff.md`.

## Afsluttet checkpoint-runde — 2026-10-10

- Genbrugelig, engine-uafhængig checkpoint-extension med provider-kontrakt, samlet validering, rollback og observers efter commit.
- Komplet gem/indlæsning af brandstationens rum, åbninger, termiske objekter, mekanik, pytter, kildevæske og applikationstilstand.
- Gemning midt under hældning bevarer også airborne væske, strømme, dunkens pose og resterende hældetid.
- Browserlager overlever sidegenindlæsning; JSON-filer kan eksporteres/importeres. Pause gør tilstanden inspicerbar.
- Fase i 20 Hz-simuleringen, ilt/røg, vådhed/skum, varmeforbindelser og ladningers timere fortsætter efter load.
- Tomme, endnu varme pool-spor bevares. Kildefarver og lækagehullers radius ændres ikke ved gentagne loads.
- Logiske dråber består ved lav kvalitet, mens deres visuelle budget anvendes straks.
- Scene-/topologifejl, korrupt data, ophørte ejere og async-kontrakter afvises før live state ændres.
- Missionen melder ikke bygningen færdig, mens der er en aktiv spil-ladning.

Verifikation: 17 nye checkpoint-tests, 80/80 målrettede systemtests, 170/170 GameSystems, 339/339 Contracts,
produktionsbuild, 8/8 checkpoint-browserchecks samt 13 brand- og 12 system-browserchecks består.
De tidligere hånd-/VRM-regressioner ses ikke i den seneste samlede kontrol.
API, afgrænsninger og brug: [checkpoint_system.md](checkpoint_system.md).

## Tilføjet af brugeren — sprinkler, bil, strøm og kameraer

- Sprinkler som selvstændigt system med genopfyldelig væskeforsyning, flere væsketyper, endelig volumen,
  varmeudløste hoveder og integration med brand. Forkert væske må ikke automatisk opføre sig som vand.
- Realistisk bil modelleret i **Blender** af **Astra med xhigh**. Lever både `.blend` og GLB med PBR-materialer,
  åbnelige døre, bagagerum, kølerhjelm og tankklap. Brændstof og batteri kan tømmes; adaptere gør væske og
  strøm udskiftelige med enklere implementationer eller eksplicit deaktiverede afhængigheder.
- Udbyg strømnettet med endelige batterier, strømskabe, ledninger og sikringer samt tydelig fejl-/forsyningstilstand.
- Genbrugeligt kamera/skærm-system med skift mellem feeds, begrænset renderfrekvens/op­løsning og korrekt oprydning.

Astra-bilopgaven er startet i denne runde. Forsyning og sprinkler er nu implementeret i kerne og branddemo.
Genopfyldning, blandinger, endelig volumen, varmeudløsning, ventil, valgfri power gate og checkpoint er verificeret.
Endeligt batteri og brændstofadapter er klar til bilintegration; fysisk elskab og netkobling mangler stadig.
12 nye tests og 8/8 sprinkler-browserchecks består; detaljer i [supply_sprinklers.md](supply_sprinklers.md).
Disse opgaver er en del af det fortsatte mål; de eksisterende budget- og checkpointopgaver beholdes.

## Afsluttet bil- og kamerarunde

- Astra xhigh leverede Blender-kilde, high/low GLB, PBR-materialer, syv åbnelige dele og interaktiv bildemo.
- Bilen bruger fælles supply-/energy-adaptere, kan bruge lokale simple stores og kan få afhængigheder slået fra.
- Brændstof og batteri kan tømmes; tankklap, starter, lys og let kørselsmodel er verificeret.
- Kameraextension og kontrolrumsdemo: tre feeds, fysisk skærm, delte targets, round-robin og kvalitet med faste budgets.
- Kameraernes strøm-/skærmflag og feedvalg gemmes; genopladning af demobatteriet genskaber billedet.
- 201/201 GameSystems-tests, produktionsbuild, 8/8 bil- og 9/9 kamera-browserchecks består.
- Bil: [vehicle_system.md](vehicle_system.md). Kamera: [camera_system.md](camera_system.md).

Bilens chassis har endnu ikke fysisk collision/suspension; checkpoint-provider er nu implementeret.
Strømskab, ledninger, endelige netbatterier og sikringer er nu implementeret og koblet til skærmen.
13 nye kerne-/integrationschecks, 15/15 kamera-/strømskab-browserchecks og 12/12 eksisterende værkstedschecks består.
Samlet GameSystems-suite: 214/214; produktionsbuild består.
Se [electricity_system.md](electricity_system.md). Bilen er også verificeret med nettes batteriadapter.
Sprinklerpumpen er nu koblet på nettet; se den afsluttede pumpe-runde nedenfor.

## Afsluttet pool-budget-runde

Væsken bevares nu som logisk post uden for det aktive termiske budget. Kilder, komponenter, position,
rum og latent termisk tilstand kan aktiveres, opsamles og gemmes. Separate renderqueries begrænser grafik;
spatialt mergeindeks og cachet volumen undgår fuld historikgennemgang på hver frame.
13 nye budget-/persistens/index-tests og én virkelig flaske-/ledger-test består. 9/9 budget-browserchecks
med 140 pytter og 1.400 ml består, samt de eksisterende 13 brand-, 8 sprinkler- og 8 checkpointchecks.
Samlet GameSystems-suite: 228/228; produktionsbuild består.
Se [pool_budget.md](pool_budget.md) for public API og de bevidste grænser for hvilende simulering.

### Oprindeligt reproduceret fund

Bevar væskens logiske post, når det aktive pool-budget er fuldt. Adskil logiske data, aktiv termisk simulering og grafikbudget,
så hver tilført mængde fortsat har ml, sammensætning, kilde og position og kan aktiveres/opsamles/gemmes korrekt.

Reproduceret med faktisk kerne: `maxPools=1`, først 20 ml diesel ved [0,0,0], derefter 40 ml ved [5,0,0].
De sidste 40 ml giver kun `pools:budget`, returnerer null og indgår ikke i pool-ledgeren; kun 20 af 60 ml spores.
Kildens world ledger kan stadig have alle 60 ml. En checkpoint-restore kan ikke genopfinde den tabte komponent-/positionspost.
Dette tab er nu rettet; maxPools begrænser aktive termiske noder og kasserer ikke nye logiske poster.

## Næste undersøgelse

- Verdens-chunking og streaming for store scener; varme-/brandinteresse er nu implementeret.

- Større rum, smallere åbninger, per-room varme og overgang mellem rum ved flytning.
- Dynamisk geometry og flere materialeeffekter; overflade-/højdeafhængig, endeligt doseret skumvirkning er nu implementeret.
- Videre bilintegration med physical collision/terrain; låsemekanik og timestep-/pauseadfærd er nu forbedret.
- Mere læsbar brand-/røgfeedback samt mål og sværhedsgrad i demoen.
- Videre checkpoint-dækning af asset-lifecycle, knuste beholdere, ruder og debris i spil med dynamisk destruktion.
- Gennemgå de øvrige systemers persistens, validering, lifecycle og budgetter, når de vigtigste brandopgaver er løst.

## Afsluttet pumpe-runde

Sprinklerens flow følger strømnettets faktiske energikvittering, inklusive delvist tømte batterier.
Pumpens driftstid begrænses ved små restmængder, så batteriet ikke tømmes af en asymptotisk væskehale.
Branddemoen har strøm-, lednings-, fejl-, sikrings- og opladningsbetjening og gemmer net + kvittering sammen med væsken.
9 nye tests, 237/237 samlet suite og produktionsbuild består; 15/15 pumpe-/sprinkler- og 8/8 checkpoint-browserchecks består.
API og afgrænsninger: [sprinkler_power.md](sprinkler_power.md).

## Afsluttet interesse-runde

En selvstændig pool-interest-extension vækker brændbare, hvilende pytter omkring varme og brand inden for
inspektions-, celle- og aktiveringsbudget. Lukkede rum beskytter; åbne direkte forbindelser følger thermal-reglen.
Aktive varme naboer og netop aktiverede poster beskyttes mod thrashing. Latent, tidligere tilført varme får en ny chance.
Checkpoint bevarer scanningens fase/cursors samt aktiv udskiftnings- og latent varme-rækkefølge.
14 nye tests, 255/255 samlet suite, produktionsbuild, 8/8 nye interesse-, 9/9 pool-budget- og 8/8 checkpoint-browserchecks består.
Andre agenters nye hånd-/grebfiler blev bevaret og deres genererede Contracts-kopier opdateret med normal sync.
API og begrænsninger: [pool_interest.md](pool_interest.md).

## Afsluttet flow-runde

En selvstændig flow-extension doserer fra supply efter holdetid og bevarer komponenter/kilde.
Mus, tastatur og XR deler én dyserate, med stop ved release, cancel, fokus-tab, pause, reset og load.
Slangen har en genopfyldelig 1,2-litertank; donor, emitterkvittering, pool-provenance og vandvisning valideres samlet.
XR-aim bruger rigtige scene-meshes, gulv og blokerende dør/væg; controllerne bruger viewer-riggens koordinater.
13 nye tests og 268/268 samlet suite består, samt 17/17 flow-, 8/8 checkpoint- og 15/15 sprinkler-/pumpe-browserchecks.
API og afgrænsninger: [flow_system.md](flow_system.md).

## Afsluttet skum-runde

Coatings er en selvstændig overfladeeffekt med areal, normal, højde, indfaldsvinkel og varmeafhængig nedbrydning.
Skum er en ægte, inert fluid-komponent i supply/flow/pools og kan også bruges af powered sprinkler.
UI har egen 600 ml-tank, doser på 20/75/150 ml, kontinuerligt flow og synlig dækning. Alle valg og kilder gemmes samlet.
12 nye tests, 280/280 samlet suite, produktionsbuild og 12/12 nye skum-browserchecks består.
Grebenes eksisterende integrationskontrol er tilpasset den anden agents dokumenterede variantvalg: bakes bevares,
optagelser vælges eksplicit med setGraspVariants. Ingen af agentens hånd-/grebs-kildefiler blev ændret.
API og begrænsninger: [coatings_system.md](coatings_system.md).

## Afsluttet bil-checkpoint-runde

Bilens native stores og navngivne adapters kan gemmes/gendannes med kørsel, motor, låse og panelanimationer.
Den samlede vehicle-scene-provider gemmer også frakoblede shared/standalone-reserver og validerer resource-views før commit.
UI har pause, browserlager, portable JSON-filer og neutralisering af gamle kørselsinput/bremsetimere.
10 nye tests, 290/290 samlet suite, 7/7 nye checkpoint-browserchecks og 8/8 tidligere vehicle-browserchecks består; produktionsbuild består.
API og begrænsninger: [vehicle_checkpoint.md](vehicle_checkpoint.md).

## Afsluttet lås-/motion-runde

Reproduceret låsefejl og 30/90 FPS-baneafvigelse er rettet. Låse fryser eksisterende animationer; motorens bidrag
og brændstof følger den faktisk understøttede fuel/power-driftstid. RK4 med stop-grænse forhindrer baglæns bremse-jitter.
9 nye tests og 299/299 samlet suite består; 6/6 nye motion-, 8/8 vehicle- og 7/7 vehicle-checkpoint-browserchecks består.
Optagelsestesten bruger en isoleret testfil, så agentens nye virkelige optagelser bevares og ikke påvirker fixture-antallet.
API og grænser: [vehicle_motion.md](vehicle_motion.md).

## Afsluttet brændstof-integration

Benzin mistede identitet i pool-systemet og kunne ikke brænde; den bevares nu som petrol med game-tuned brandprofil.
En supply-kompatibel vehicle fuel-port udtager fra den aktive adapter, tæller spilledL og følger source-skift.
Vehicle Lab viser spild, kontinuerlig lækage, antændelse og opsamling med instanced budgets og fælles checkpoint.
6 nye tests, 305/305 samlet suite, 8/8 nye spill- og 7/7 vehicle-checkpoint-browserchecks består; build består.
API/grænser: [vehicle_fuel_spill.md](vehicle_fuel_spill.md).

## Afsluttet page-lifecycle-runde

En cachet pagehide genbrugte tidligere en disponeret runtime. Fælles helper adskiller nu suspension fra endelig cleanup
for security/vehicle/fire/systems, rydder input og resetter frame-clock før genoptagelse.
6 nye tests, 311/311 samlet suite og 17/17 lifecycle-browserchecks består. Faktisk cachegenbrug blev observeret for
bil/kontrolrum; brand/værksted blev genindlæst, og deres persisted-events blev også kontrolleret direkte.
Regel, API og grænser: [page_lifecycle.md](page_lifecycle.md).

## Afsluttet rum-/åbningsrunde

Reproduceret: 1% og 100% døråbning gav identisk varmeoverførsel mellem nabogenstande.
Nabografen skalerer nu med åbningen og cacher portalopslag ved topology-ændring.
Flytning af en brand ind i et iltfattigt rum gav desuden en checkpoint, der ikke kunne indlæses.
Flytning slukker nu straks uden tab af varme/brændstof, validerer samlet og notificerer observers.
5 nye tests og 316/316 samlet suite består; produktionsbuild og 13/13 brand-browserchecks består.
Regler og API: [fire_system.md](fire_system.md).

## Afsluttet rum-feedback-runde

Branddemoens slukningsmål kunne erklære bygningen ventileret med varm eller iltfattig luft.
Stateless assessFireHazards giver nu fælles public vurdering af brand, ladninger, varmt brændstof,
hvilende varme pytter, rumvarme, røg og relativ luftreserve. Begge rum vises samtidigt i demoen.
Checkpoint afleder samme vurdering uden en ekstra tilstandsowner. Luftreserve er tydeligt relativ.
4 nye tests, 320/320 samlet suite, produktionsbuild og 15/15 brand-browserchecks består;
rumoverblikkets screenshot er visuelt kontrolleret. Dette etablerer ikke headset-performance.
API og game-tuned grænser: [fire_system.md](fire_system.md).

## Afsluttet røg-fordelingsrunde

Reproduceret: 20 brandkilder i første rum optog alle 12 minimale partikler og skjulte
røg i et andet lige så røgfyldt rum. Per-room reservation og donation fordeler nu det
fælles budget; kvalitetsreduktion bevarer flere rum. Ved flere rum end slots roterer
udvalget. Fjernede rum rydder deres partikler, og stats har detached tællere pr. rum.
5 nye tests, 325/325 samlet suite, produktionsbuild og 16/16 brand-browserchecks består.
Visuel fordeling ændrer ikke thermal-reservoirs eller vedvarende tilstand.
API og grænser: [fire_system.md](fire_system.md).

## Afsluttet rum-/genstandsvarme-runde

Reproduceret: træ forblev 20 °C efter 10 sekunder i 400 °C rumluft.
airConductance kobler nu hver genstand til det rum, den befinder sig i, med samtidig
energi-bevarende udveksling. Koblingen kan konfigurere og gemmes med objektet; legacy defaults er 0.
Nye bygninger bruger 0,5. Første forsøg med 2 bremsede stofspredning for meget; sammenligning
med demoens faktiske parametre og en scenarietest fastlægger den korrigerede balance.
6 nye tests, 331/331 samlet suite, produktionsbuild og 16/16 brand-browserchecks består.
API og afgrænsninger: [fire_system.md](fire_system.md).

## Afsluttet pool-/rumvarme-runde

Pytter kan nu have en gemt airConductance; nye branddemo-poster bruger 0,5.
Interest-schedulerens fælles roundrobin omfatter varme rum og finder koblet, brændbart
fuel langt fra genstandsbaserede varmekilder. Linked room-paging holder checks/celler/aktiveringer
inden for budget og bevarer cursor efter restore, uden at kopiere eller scanne hele rummet.
Pool/thermal-state validerer samme kobling. Legacy poster beholder kobling 0.
Browsertesten afslørede, at 0,01 °C varme låste alle kolde vandpytter; hvilegrænsen tillader
nu 0,1 °C med præcis bevarelse af varme. Varme/beskyttede/brændende poster bliver aktive.
7 nye tests, 338/338 samlet suite, produktionsbuild, 16/16 brand-, 8/8 interesse- og
8/8 checkpoint-browserchecks består.
API/grænser: [pool_budget.md](pool_budget.md), [pool_interest.md](pool_interest.md).

## Afsluttet fuldt rum-/brændstof-overblik

Reproduceret: hotDormant()s default-preview indeholdt én post, så østrummet stod som klar,
selv om både vest og øst havde varmt, hvilende diesel. Cached tællinger pr. rum dækker nu alle
poster og udendørs fuel. Rumvurderingen bruger den fulde summary og validerer tællingerne.
Cooling, dilution, fjernelse, aktivering og restore vedligeholder tællinger uden per-frame
kopiering af hele pool-verdenen. Hot-priority-order bevares; der kræves ingen ekstra provider.
5 nye tests (inklusive 1.000 poster), 343/343 samlet suite, produktionsbuild og
17/17 brand-browserchecks består, herunder flere varme rum efter checkpoint-restore.
API: [pool_budget.md](pool_budget.md), [fire_system.md](fire_system.md).

## Afsluttet XR-rumstatus-runde

Rumstatus var kun i HTML-panelet, som forsvinder ved headset-entry. En genbrugelig world-readout
viser nu begge rum, luft/sigt, mission, pause og vand/skum i scenen med én genbrugt canvas/texture.
Ændret tekst uploades højst 5 Hz; skjult/uændret tekst giver ingen uploads. Reset/re-entry
genbruger pladen, mens terminal cleanup frigiver geometry/material/texture én gang.
Screenshot-QA afslørede geometri foran teksten; HUD render-order/depth-regler sikrer nu læsbarhed.
Simuleret XR kræver et direkte render-frame, da ingen headset-animation overtager browser-loopet.
En eksisterende skumkontrol er gjort atomisk omkring pulse og assertion, så senere termisk
genantændelse ikke forveksles med mislykket dosering.
5 nye tests, 348/348 samlet suite, produktionsbuild og 18/18 brand-browserchecks består.
Screenshot er visuelt kontrolleret; fysisk headset-komfort/stereo/performance er stadig uafprøvet.
API og begrænsninger: [fire_system.md](fire_system.md).

## Afsluttet per-room varmeprofil-runde

Varmekapacitet, heatFraction og passivt varmetab var faste i kernen. De kan nu vælges
og konfigureres atomisk pr. rum; iltændringer afklarer eksisterende brandtilstand straks.
Ventilation og rum-/genstandsudveksling bruger rumspecifik kapacitet og bevarer energi
ved udveksling. Profiler gemmes med thermal-room-state; legacy defaults bevares.
Demoen har standard/isolated/light-valg for valgt genstands rum og korrekt selection/restore.
6 nye tests, 354/354 samlet suite, produktionsbuild og 19/19 brand-browserchecks består.
API og gameplay-grænser: [fire_system.md](fire_system.md).

## Afsluttet dynamisk thermal-event-runde

Reproduceret: removal fra thermal:burned fejlede senere med Unknown id. Simulationen
kontrollerer nu konkret objektidentitet, genbygger ændrede naboer under catch-up og
springer fjernede/udskiftede planlagte objekter over. Nye objekter får næste fixed step.
Ilt tælles fra faktisk frigivet energi, og vand til en planlagt brand stopper dens burn.
Room teardown og dispose er dækket. Reentrant step samt restore midt i et trin afvises.
7 nye tests, 361/361 samlet suite, produktionsbuild og 19/19 brand-browserchecks består.
API-/eventgrænser: [fire_system.md](fire_system.md).

## Afsluttet elektrisk varme-runde

En selvstændig thermal-adapter overfører passive strømkomponenters faktiske energyJ receipts
til authored varme-targets. Den avancerer ikke netværket, fordeler højst leveret energi og
ignorerer replay af samme receipt-objekt. Tomt batteri, afbrydelse og tripped fuse giver ingen
phantom-varme. Fjernede targets er dækket. Eksisterende strøm-/thermal-providers ejer gemningen.
Demoen har dårlig-ledning/repair, synligt wire-tab og metaltemperatur. Netværksindstilling,
varme og pumpe-/væskereserver restore sammen. Metal og lille batteri antænder ikke automatisk.
6 nye tests, 367/367 samlet suite, produktionsbuild, 20/20 brand- og 15/15 sprinkler-browserchecks består.
API, budget og receipt-grænser: [electrical_heat.md](electrical_heat.md).

## Afsluttet browser-oprydningsrunde

Fire/sprinkler hang tidligere i browser.close efter vellykkede checks og krævede manuel
lukning af de verificerede egne Puppeteer-processer. Alle 14 browserkontroller bruger
nu fælles bounded cleanup af server og browser. Tvangslukning kræver egen ChildProcess
og midlertidig Puppeteer-profil; remote/uverificerede processer rammes ikke.
6 nye tests, 373/373 samlet suite samt 20/20 brand- og 15/15 sprinklerchecks består.
Begge kontrolprocesser afsluttede nu selv med exit 0. En særskilt rigtig-browser-kontrol
fremtvinger close-hang, verificerer fallbackens proces-exit og genbinder serverporten.
Kommando/grænser: [webxr-demo README](../webxr-demo/README.md).

## Afsluttet idle-air-performance-runde

Luftgrupper og beta-vægte blev genopbygget, og alle koblede objekter kontrolleret ved
hvert fixed step. Afledte caches og room-wake-flags springer nu kolde ligevægtsrum over.
Objekt-roster genbruges, med samme identity-guards for event-driven mutationer.
Varme/vand/heater/links/vents/blast og relevante konfigurationsændringer er dækket;
restore genbygger afledte caches uden ændret save-format.
5 nye tests, 378/378 samlet suite og produktionsbuild består. 512 kolde koblede objekter
har efter første kontrol 0 air-node-checks. Lokal median for 3.000 idle-trin faldt 447→45 ms;
det er en kerne-måling, uden headset/FPS-konklusion. 20/20 brand-browserchecks består.
API/afgrænsning: [fire_system.md](fire_system.md).

## Afsluttet restore-notifikationsrunde

Reproduceret: én gemt genstand gav fire thermal:changed-notifikationer, når observeren
udskiftede instansen med samme id; en ubegrænset observer kunne hænge i Map-iteration.
Thermal og pools bruger nu afgrænsede instans-snapshots. Nye/udskiftede/fjernede instanser
bliver ikke til nye restore-notifikationer i samme runde; dispose afbryder resten.
Nested restore/commit/notify (og thermal step) afvises under runden, og guards frigives
ved observer-fejl. Checkpoint returnerer observerErrors uden at rollback'e gyldig commit.
7 nye tests, 385/385 samlet suite, produktionsbuild, 20/20 brand- og 8/8 checkpoint-browserchecks består.
Event-/lifecycle-grænser: [fire_system.md](fire_system.md).

## Afsluttet brandalarm-runde

En selvstændig alarms-extension læser room thermal-data ved 10 Hz med detector-budget,
varme/røg-modes, dwell, latch, silence og reset-hysteresis. En boolean power-gate er valgfri;
modulet ejer hverken strømnet, energiforbrug eller audio. Dynamiske observers/disposal
og staged checkpoint-validering er dækket. Demoen har rumlamper, betjening og VR-status.
Alarmdata gemmes i den eksisterende application-provider, og gamle filer uden alarms
indlæses med friske detektorer. Ugyldige alarmdata afviser hele indlæsningen før commit.
9 nye tests, 394/394 samlet suite, produktionsbuild, 21/21 brand- og 8/8 checkpoint-browserchecks består.
Signalet i demoen er visuelt; fysisk headset-performance er ikke etableret.
API/budget/grænser: [alarm_system.md](alarm_system.md).

## Afsluttet geometrisk åbning-runde

Åbne rumforbindelser gav direkte nabovarme gennem solide vægdele, fordi dørplacering
manglede i modellen. Valgfri axis-aligned portal-bounds og heatPath begrænser nu
varmevej til faktisk åbning, med konservativ route-distance og open-faktor.
Pool-interest vækker/beskytter kun geometrisk reachable nabopytter; rumluft er fortsat
room-reservoir-baseret. Abstrakte game-blast-hits følger samme rute. Explicite material-links
er fortsat authored. Bounds kopieres/valideres ved capture/restore; legacy null bevares.
Demoens portal matcher døråbningen, og forkert saved layout afvises før commit.
6 nye tests, 400/400 samlet suite, produktionsbuild, 22/22 brand- og 8/8 interesse-browserchecks består.
API/afgrænsning: [fire_system.md](fire_system.md), [pool_interest.md](pool_interest.md).

## Afsluttet alarm-dependency-runde

Reproduceret: ugyldig power-gate flyttede pending-fasen før typefejl, og room teardown
gav et fejlet opslag. Første sensor-batch valideres nu før timerændring; snapshots af
instanser begrænser også mutationer i dependency-læsere. Fjernede rum giver eksplicit
fault, nul dwell og intet signal, mens tidligere latch bevares. Fault-state restore,
legacy-data samt rekonstruktion og reset er dækket. Thermal har public hasRoom.
5 nye tests, 405/405 samlet suite, produktionsbuild og 22/22 brand-browserchecks består.
API og præcis transaction-grænse: [alarm_system.md](alarm_system.md).

## Afsluttet thermal-antalsbudget-runde

Reproduceret: maxObjects:1,5 tillod to objekter, men egen capture kunne ikke restore;
4097 vents kunne ligeledes oprettes og derefter afvises af indlæseren. Counts er nu
heltal, og maxVents/maxLinks bruges både i runtime og restore. Vents har gyldige ids.
connectNearby validerer hele batchen før grafen ændres, og connect kan opdatere ved
fyldt budget. Canonical endpoint-par undgår collision for ids med skilletegn.
JSON-byte-/nodegrænser er fortsat særskilte fra antalsgrænserne.
6 nye tests, 411/411 samlet suite, produktionsbuild og 22/22 brand-browserchecks består.
API/grænser: [fire_system.md](fire_system.md).

## Afsluttet forbindelsesindeks-/pool-performance-runde

Cold-eviction kopierede thermal.capture pr. kandidat for at teste material-links.
Thermal har nu afledt endpoint-indeks og public hasConnections, som pools bruger til
konstant opslag. Connect/upsert, atomiske batches, remove, scoped replacement, restore
og dispose vedligeholder indekset; save-format er uændret. Ældre adapters har fallback.
En lokal testcase med 300 uvedkommende nodes/links og 2.000 kolde swaps gik fra 4.000
captures/ca. 652 ms til 0 captures/ca. 76 ms, med samme beskyttelse af linked pool.
5 nye tests, 416/416 samlet suite, produktionsbuild, 8/8 interesse- og 9/9 pool-browserchecks består.
Målingen er kernelokal, ikke headset-performance.
API/regler: [fire_system.md](fire_system.md), [pool_budget.md](pool_budget.md).

## Afsluttet røg-reservoir-/bounds-runde

Reproduceret: 96 primede partikler blev hængende efter canonical smoke var 0.
Gamle skyer følger nu aktuel density og ryddes under visuel threshold; aktive, faktisk
røgproducerende kilder har egne source/room-markører og kan give tidlige lokale faner.
SmokeYield:0 opfinder ingen synlig røg. Flytning/slukning lader kun eksisterende room-
reservoir begrunde gamle skyer. Smalle/resized bounds har gyldige indre margins og
clamper centre straks. 0,3 s og 3×0,1 s giver samme visuelle ticks.
6 nye tests, 422/422 samlet suite, produktionsbuild og 23/23 brand-browserchecks består.
Canonical heat/smoke/liquid-state er uændret af grafikkens oprydning.
Regler/budget: [fire_system.md](fire_system.md).

## Afsluttet smoke-lifecycle-runde

Reproduceret: `dispose()` fjernede mesh og frigav GPU-ressourcer, men beholdt det gamle
instance-count; et efterfølgende `prime()` kunne desuden genskabe partikler og kalde
upload på frigivne attributter. Dispose nulstiller nu også mesh-count. Efter dispose
er prime, quality-ændring og bounds-oprettelse afvist; step/clear bliver sikre no-op'er,
og fjernelse af bounds returnerer false. 1 ny regressionstest, 460/460 samlet suite og
produktionsbuild består. Sol-review fandt ingen resterende forhold.

## Afsluttet missions-/udfordringsrunde

En selvstændig missions-extension håndterer injected evaluering, samlet clear-periode,
deadline, outcome og JSON-checkpoint. Terminal timer clamp, inputvalidering, callback-
reset og metadata-detachment er dækket. Demoen har to brande ved dørens spredningsvej,
østbeskyttelse og 180/120/60 s sværhedsgrader. Øst-antændelse latches på tværs af restore.
Aktiv udfordring låser editors/gratis refill, og pause tillader ikke udstyrs-/åbningsændringer;
sandbox beholder redigering. Outcome/timer findes i desktop-/VR-status. Application-provider
gemmer mission, næste difficulty og historik; gamle filer går til idle uden nye providers.
5 nye tests, 427/427 samlet suite, produktionsbuild, 12/12 missions-, 23/23 brand- og
8/8 checkpoint-browserchecks består. Screenshot er kontrolleret; ikke fysisk headsettest.
API/scenarie/grænser: [mission_system.md](mission_system.md).

## Afsluttet XR-challenge-kontrolrunde

VR-diesel kaldte action direkte og omgik active-challenge-lock. Desktop/VR bruger nu
samme action-gate og håndterer også async action-fejl. Otte genbrugte knapper giver
flow, start/pause/sandbox, difficulty og alarm-ack uden HTML-panel. Labels opdateres
kun ved ændring; utilgængelige knapper dæmpes. Anden-hånds-pause frigør alle nozzle-ejere.
Terminal cleanup frigiver menuens 24 geometry/material/texture-ressourcer én gang og
rydder scene-content. Synthetic XR kræver direkte render og normal tekst-interval.
427/427 samlet suite, produktionsbuild, 10/10 nye XR-, 12/12 missions- og 17/17 flow-browserchecks består.
Screenshot er visuelt kontrolleret; fysisk headset/tracking/stereo/komfort er uafprøvet.
Kontrol/budget/grænser: [mission_system.md](mission_system.md).

## Afsluttet combustion-numerik-runde

Forhåndstjekket kunne overse ekstreme, men endelige værdier, når varme først gik via
rumluft, ambient, et forbundet varmelegeme eller flere kædede objekter, før brændstof
antændtes. Det kunne kaste efter at have ændret simuleringsur og tilstand. Risikovurderingen
medregner nu mulige kombinerede output i rum-, link- og samlet varme-netværk; den fulde
forhåndssimulering afgør fortsat, om det konkrete forløb faktisk er usikkert. Den dyrere
kombinerede graf aktiveres kun ved ekstreme numeriske størrelser og springes over i normale
scener. Sol-review fandt ingen resterende korrekthedsfejl; normal 512-objekt/200-tick
måling er tilbage på 28–37 ms. 10 nye overflow-regressioner, 462/462 tests, produktionsbuild
og `git diff --check` består.

## Afsluttet heater-/forbrændingssamspil

Ved ekstreme temperaturer afviste heater-only preflight ethvert forbundet rumbrændsel,
også når det var sikkert sovende. Den returnerer nu kontrollen til den efterfølgende
fulde forbrændings-/blast-preflight, som afviser reelle overflows atomisk uden at blokere
sikre kombinationer. Sol bekræftede, at fjern detonationsfrist og overophedende heater
fortsat afvises før clock/state ændres. 1 ny regressionstest, 463/463 samlet suite,
produktionsbuild og `git diff --check` består. Det ældre implementationsoverblik er også
rettet, så det skelner mellem rum-/ventilmodellen og fraværet af kontinuerlig 3D-luftstrøm;
Sol bekræftede, at beskrivelsen stemmer med brandguiden. Forældede testtal i brandguiden er
opdateret til den aktuelle 464/464 suite og 23/23 brandbrowserkontrol.

## Afsluttet thermal-event-fejlisolering

En observer, der kastede ved `thermal:burned`, kunne afbryde et catch-up-batch efter et
delvist fremskridt: første fixed tick var allerede bogført, mens de resterende ønskede
ticks sprang over. Simulationen fuldfører nu hele batchen, fortsætter eventrækken og
returnerer den første observerfejl bagefter; en intern simulationsfejl beholder forrang,
og stepping-guard frigives også. Observeres uden for `step` beholder synkron fejlsemantik.
8 thermal-eventtests og 7 restore-notificationtests består, samlet suite **464/464**,
produktionsbuild og `git diff --check` består. Sol review fandt ingen state-, rækkefølge-
eller lifecycle-problemer.

## Afsluttet køretøjs-kurvatur-runde

Reproduceret: et endeligt, men næsten nul `wheelbase` blev accepteret af bilsystemet;
med styring dividerede cykelmodellen med denne værdi og gjorde position/retning til `NaN`.
`add()` afviser nu akselafstand under 0,1 m, og den mindste understøttede akselafstand
bevarer endelig tilstand under kørsel. Grænsen er dokumenteret. 1 ny regressionstest,
465/465 samlet suite og 6/6 browserkontroller for bilens bevægelse består.
Kilde og modelgrænser: [vehicle_system.md](vehicle_system.md).

## Afsluttet extension-lifecycle- og kamerakatalog-runde — 2026-10-11

Hosten lukker nu transitive dependents ned før deres dependency fjernes, og forsinket
async-init-success/-fejl rydder extension-ressourcer præcis én gang. Kamera-feeds har
validerede labels, og `feedOptions(screenId)` returnerer friske snapshots af feed-id,
label, enabled- og selected-state til monitorens valg-UI. NightfallContractsWebXR's
genererede extension-kopier var ude af sync på source-hash/provenance og to bottle-filer;
de er nu genskabt fra GameSystems-kilden, og separate WebXR-projekt blev bevaret.

Verifikation: GameSystems Node-suite **491/491**, NightfallContractsWebXR Node-suite
**339/339**, Vite-produktionsbuild består, Sol-review godkendte host-/kameraændringerne,
og `git diff --check` er ren. Builden viser fortsat den eksisterende bundle-size-advarsel;
det er ikke en buildfejl.

## Arbejdsregel

Hver ændring skal have en konkret begrundelse og passende verifikation. Bevar andre agenters arbejde.
Test kerner og public API'er, og brug browserkontrol ved ændringer af synlig adfærd, input eller rendering.
Rapportér faktisk testresultat; browserkontrol etablerer ikke headset-performance.

## Vedvarende mål: fysisk VR-backpack

Byg NightfallContracts-backpacken videre mod et fysisk, hurtigt og forståeligt VR-inventory
med inspiration fra *The Walking Dead: Saints & Sinners*. Spilleren skal kunne finde og
trække genstande fra bestemte steder på kroppen, sætte dem tilbage med tydelig taktil og
visuel feedback og skifte våben uden at åbne en flad menu. Bevar eksisterende loadout,
checkpoint og gear-inventory integrationer; backpacken skal være et selvstændigt lag, der
arbejder sammen med dem.

Arbejd i små, målbare trin: auditer først nuværende fysiske rig, grebs-/slotlogik, headset-
ergonomi og persistence; vælg derefter næste konkrete fejl eller manglende spillerhandling.
Prioritér stabile over-skulder-/hoftegreb, sikre indsæt- og udtrækszoner, kapacitets- og
våben-fit-regler, feedback ved forkert slot/fuld taske, håndtracking-tab, checkpoint-restore
og et fast budget for fysik/sceneopdateringer. Undgå at indføre fuld inventory-simulering,
hvis en lille deterministisk slotmodel giver samme spiloplevelse. Verificér controller- og
syntetiske XR-flow samt persistence; markér headsetkomfort og frame pacing som uafprøvet,
indtil det er målt på hardware. Fortsæt med at finde og løse næste forbedring, når hvert
backpack-delmål er reviewet og består relevante tests.
