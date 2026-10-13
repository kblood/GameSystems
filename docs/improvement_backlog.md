# Løbende forbedringer af GameSystems

## Aktuel G3-integrationsstatus — 2026-10-13

De syv `gs_grasp_data`-datakontrakter er nu pushet i GameSystems og synkroniseret til
Nightfall Godot, inklusive seneste bake-kontrakt (`GameSystems 9995834`, Godot
`ed83b27`). GameSystems WebXR bestod **579/579** før denne Godot-only addon-sync;
Nightfall WebXR bestod **375/375** efter sine runtime-datasynkroniseringer. Dens
manifester blev derefter opdateret til `GameSystems 9995834` i `a367ecc`; extension-
og addon-`--check` passerede i alle tre worktrees. Bake-kopien i Nightfall Godot
består **300/300**.

G3 mangler stadig fælles quality-data og en afsluttende kontrol af kontraktgrænserne.
Disse læsere validerer data; de porterer ikke Godots grebs-, kontakt-, SDF-, bake- eller
håndgeometrialgoritmer. Headset-/asset-paritet kræver særskilt evidens.

## G3 bake-kontrakt med komplette offentlige records — 2026-10-13

`GSGraspBakedData` læser en genereret kopi af den uændrede
`extensions/grasp/baked_grasps.data.json`. Goldenen bygger på hele den offentlige
`BAKED`-eksport og gemmer desuden samtlige 255 pose-ID'er i rækkefølge, kind-tællinger
og typer uden generisk katalogpost. Source-/konventions-/summary-metadata, oprindelige
raw-vinkler, wrap/flat/pinch, fit-markører og sentinel-metrics bevares.

Valideringen kontrollerer feltstruktur, finite tal, quaternion-norm, rækker,
unikke ID'er og summary-counts. Den kræver ikke `CATALOG`-medlemskab: 34 magazine-
records er asset-specifikke. Mug-exemption og magazine-clamping er uændrede i JS;
regressionen fastholder hele dokumentets historiske hash og hvert records identitet.
Source-hashes/avatarsti dokumenterer den historiske Godot-bake, konvertering og refit;
ingen avatarasset, bake-algoritme eller kontakt-/SDF-paritet er verificeret her.
Reference-hand-fixturet er en separat kilde og forveksles ikke med bake-avatarens
operatorScale/rest-konventioner.

Verifikation: Godot 4.7.2 **300/300**, fokuseret JS **28/28** inklusive Contracts-
filsammenligningen, golden-freshness og `git diff --check` passerer. Kilden er pushet
som GameSystems `9995834`, addon-kopien som Nightfall Godot `ed83b27`; target-testen
består **300/300**, og addon-sync-checken passerer. WebXR runtimefilerne er uændrede;
manifestrevisionen blev ajourført i Nightfall WebXR `a367ecc`, hvor sync-checken også
passerer. G3 mangler kvalitetsdata og en samlet afslutningsaudit; senere algoritme-/
headset-validering er fortsat særskilt arbejde.

## G3 optagede greb: rå dokument og filtreret API hver for sig — 2026-10-13

Den kanoniske `extensions/grasp/recorded_grasps.json` og dens JS-forbrugere er
uændrede. `GSGraspRecordedData` validerer en genereret kopi med eksplicit schema,
posefelter, normaliseret quaternion, fem fingerrækker (valgfri femte tommeltwist),
håndlængde og typed valgfri Grasp Studio-metadata. Ukendte felter og ugyldige poser
afviser dokumentet samlet. Vinkler anatomisk uden for `HARD` bevares som rådata.

JS `RECORDED` bruger `recordedPoses`/`isPose`, som filtrerer geometri-fejl og ikke
validerer metadata. Goldenen gemmer derfor rå dokument, offentligt filtreret array
og accepterede/afviste rå indeks separat. De nuværende ti poser accepteres alle i JS;
regressioner dækker også blandede ugyldige input og duplikater, historiske hashes,
mutable records i et frosset array og uændret opt-in/defaultvalg. Proveniensen er
Grasp Studios dev-server-optagelser og markerede spejlinger, ikke reference-håndens
CharacterCreator-fixture. Ingen optagelses-, spejlings-, closure- eller SDF-algoritme
er portet til Godot.

Verifikation: Godot 4.7.2 **58/58**, fokuseret JS **26/26** inklusive Contracts-
filsammenligningen, golden-freshness og `git diff --check` passerer. Kilden er pushet
som GameSystems `61ec5af`, Godot-kopien som `a207e74`; Godot target-test og sync-check
passerer. WebXR runtimefilerne er uændrede, og manifests følger nu GameSystems
`9995834` (`a367ecc`); Contracts-sync-checken passerer. G3 er fortsat åben for
kvalitetsdata og den samlede kontrakt-/algoritmeaudit.

## G3 reference-hånd: valideret rådata uden ny kildekopi — 2026-10-13

`extensions/grasp/reference_hand.json` forbliver den uændrede kanoniske kilde. En
genereret kopi læses nu af `GSGraspReferenceHandData`, som kontrollerer præcise
feltsæt, schema/proveniens, positiv skala/længde, begge sider, frame-ortogonalitet og
handedness, fem fingerkæder samt punkter/segmentlængder/rest-yaw. Tolerancerne er
`1e-4` for frame-checks og `1e-5` meter for segmentlængder, så den eksisterende
seks-decimal-eksport accepteres.

Goldenen gemmer rå kontrakt plus seks offentlige `referenceHand()`-resultater
(venstre/højre ved default, skala 1 og skala 2) og hashes af hele den lokale importgraf.
Godot tester rådata og direkte side-/skala-/segmentkorrespondancer; den afledte
profil-/håndgeometri er optaget til senere algoritmetests og er ikke portet her.
JS-regressionen fastholder historisk fixture-hash, afrundet output-hash ved `1e-12`
samt caching, uafhængige sider og skalaadfærd. Fixturets eksisterende CharacterCreator-
proveniens fra MIT-character-pluginet bevares; ingen CharacterCreator-runtime kopieres.

Verifikation: Godot 4.7.2 **78/78**, fokuseret JS **23/23** inklusive eksisterende
Contracts-filsammenligning, golden-freshness og `git diff --check` passerer. Kilden er
pushet som GameSystems `ae3d8d9`, Godot-kopien som `c74c1bc`; target-test og sync-check
passerer. Ingen WebXR-runtimefiler ændredes; dens manifests er ajourført til den
aktuelle GameSystems-revision i `a367ecc`. G3 mangler kvalitetsdata og samlet audit;
Godot-geometriens algoritmeparitet hører fortsat til senere porttrin.

## G3 propkatalog som fælles data — 2026-10-13

`DEFAULT_MASS` og de fem mutable `CATALOG`-records er flyttet til
`extensions/grasp/data/catalog.data.json`, inklusive flaskernes lathe-profiler,
dåsecylinderen, kartonens boks og krusets flade primitive-union. Eksportnavne,
`KINDS`-rækkefølge, alle værdier og mutationsegenskaber bevares. Flaskernes eksisterende
MIT-proveniens fra GameSystems-glassilhuetter er fastholdt.

`GSGraspCatalogData` i `gs_grasp_data` validerer propfelter, finite tal, positive mål,
sorterede profilhøjder, RGB-tal, fill-fraktioner og unionens primitive-børn. Der er
ingen Godot-SDF-, mesh-, masse- eller kollisionsalgoritme i dette trin. Goldenen kommer
fra JS-eksporterne med kildehashes; closure-goldenen registrerer også det nye katalog-JSON
som transitiv afhængighed. JS-testen fastholder en hash taget før udtrækket og 18
oprindelige SDF-resultater på indersider, grænser, skuldre og krusets forskudte håndtag.

Verifikation: Godot 4.7.2 **49/49**, lokale JS-checks **20/20**, GameSystems WebXR
**572/572**, Nightfall WebXR **375/375**, golden-freshness og sync-checks passerer.
Kilden er GameSystems `88273b0`, Godot-kopien `f8a0ab8`; Nightfall WebXR fik de
synkroniserede data samt ajourført manifest i `a367ecc`. G3 er fortsat åben for
kvalitetsdata og den samlede port-/algoritmeaudit.

## G3 held-drive-konstanter som fælles data — 2026-10-13

De seks offentlige skalarer fra `held_drive.js` ligger nu i
`extensions/grasp/data/held_drive.data.json`: `STIFFNESS`, `DAMPING`,
`MAX_ACCELERATION`, `MAX_TORQUE`, `MAX_HOLD_FORCE` og `HAND_MOTION_SAMPLES`.
Alle eksportnavne og værdier bevares. JS-regressionen fastholder en SHA-256 fra de
oprindelige eksporter samt kendte lineære/vinklede spring-resultater og det vægtede
vindue med to håndmålinger. Algoritmerne er uændrede.

`GSGraspHeldDriveData` indlæser sit eget skema i `gs_grasp_data` og afviser manglende
felter, ikke-endelige/forkert typede tal, negative tuningværdier og et sample-antal,
der ikke er et positivt heltal. Golden-generatoren bruger JS-eksporterne og registrerer
hashes for datafilen, held-drive-modulet og dets math-afhængighed. Dette er en datalæser;
Godot-drive/sampling-algoritmer og fysikadaptere er ikke ændret.

Fokuseret verifikation: Godot 4.7.2 **55/55**; lokale JS-checks **18/18**, GameSystems
WebXR **570/570**, Nightfall WebXR **375/375**, golden-freshness og sync-checks passerer.
Kilden er GameSystems `f368638`, Godot-kopien `7fcd4cc`, og Nightfall WebXR har
held-drive-data samt opdaterede manifests (`a975d83`). G3 mangler fortsat
kvalitetsdata og samlet audit; held-drive-/sampling-algoritmerne er ikke porteret.

## G3 closure-defaults som selvstændig datakontrakt — 2026-10-13

`CLOSURE`, `PAD_RADIUS`, `REFERENCE_HAND` og `THUMB_TILT` ligger nu i den versionerede
`extensions/grasp/data/closure.data.json`. JS-eksporterne bevarer alle værdier, den
frosne `CLOSURE` og de mutable radius-/reference-objekter. En SHA-256-regression er
taget fra de oprindelige eksporter før udtrækket; også `Math.PI / 3` bevarer præcis
samme floating-point-værdi. Den eksisterende tilladte `grasp/data/`-sync kopierer
datasættet ind i demoen, og regressionen sammenligner demoens offentlige eksporter.

`GSGraspClosureData` i `gs_grasp_data` indlæser et separat skema og afviser bl.a.
forkerte typer, ikke-endelige tal, manglende fingre, negative afstande, nul march-step
og brøkdele af iterationsantal. Godot-goldenen kommer fra JS-eksporterne og registrerer
hashes for closure-modulet og alle dets lokale importafhængigheder. Ingen closure-,
fingermodel- eller koordinatkonverteringsalgoritme er portet i dette trin.

Fokuseret verifikation: Godot 4.7.2 **38/38** for closure-data og **35/35** for
validator-data; **16/16** lokale JS-checks, GameSystems WebXR **568/568** og Nightfall
WebXR **375/375**. Kilden er GameSystems `350e2c0`, Godot-kopien `a507998`, WebXR-
synkroniseringen `c32a637`; golden- og sync-checks passerer. G3 mangler fortsat
samlet audit og Godot-algoritmeparitet for closure/contact.

## G3 humanoid-data: første Godot-forbruger — 2026-10-13

`gs_humanoid` har nu en lille Godot-læser, der afviser forkert skema, manglende eller
duplikerede canonical joints, ekstra/manglende rigs og ufuldstændige maps. Generatoren
kopierer den fælles humanoid-JSON og laver en Godot-golden fra JS-eksporternes
canonical-led og fire rig-maps. JS-golden fastholder samtidig de fire maps' historiske
52-leds værdier. Det giver et selvstændigt, headless-testbart dataprodukt før den større
Skeleton3D-/retargeting-port.

Verifikation ved første humanoid-slice: Godot 4.7.2 **10/10**, GameSystems WebXR-demoen
**566/566**, fokuseret JS **1/1** og `gen_golden.mjs --check`. De efterfølgende G3-
poster ovenfor dækker nu også validator, closure, held-drive, catalog, reference hånd,
recordings og baked data med egne schema-tests og goldens.

## G3 grasp-validator-data og nested sync — 2026-10-13

Validatorens `HARD`, `COMFORT` og `GATES` er flyttet til
`extensions/grasp/data/validator.data.json`; JavaScript beholder de samme mutable
eksporter. `gs_grasp_data` indlæser og strukturtjekker grader, fingergrænser, komfort-
bånd og kontaktgrænser, uden at implementere G4-clamping eller kontaktalgoritmer.
Godot-goldenen bygges fra validatorens offentlige JS-eksporter, og JS-regressionen
fastholder den historiske SHA-256 samt kendte clamp/fallback-værdier.

For at datafilen når forbrugerne spejler shared sync-helperen og Contracts WebXR-syncen
nu den eksplicit tilladte `grasp/data/`-mappe, samtidig med at `grasp/tools/` forbliver
udeladt. Demoens og Grasp Studios midlertidige grasp-fixtures kopierer nu undermapper
rekursivt.

Verifikation: Godot 4.7.2 **35/35** for validator-data og **10/10** for humanoid maps;
GameSystems WebXR-demo **566/566**, Nightfall Contracts WebXR **375/375**, Grasp Studio
**17/17**, og begge WebXR-/Studio-produktionsbuilds lykkes (med eksisterende Vite-chunk- og
worker-advarsler). Nightfall Contracts Godot-kopien passerer samme data-test **35/35**
med `--xr-mode off`. Golden-generatorens `--check` og Contracts'
`sync_extensions --check` passerer. G3 er stadig åben for katalog-/closure-/held-drive-
data, kvalitetsniveauer og Godot-validering af de allerede JSON-formaterede greb.

## Godot OpenXR- og VR-guide-review — 2026-10-13

Sol-reviewet fandt en fejl i recenter-rådet: appen må ikke kalde `center_on_hmd()` for
Local eller Local Floor, hvor runtime flytter kameraet; Stage bevarer origin, så appen
skal reagere på signalet. `godot_openxr.md` skelner nu eksplicit mellem rummene, herunder
orienterings-only recenter efter virtuel bevægelse. `active_ragdolls.md` præciserer, at
avatarens tilpasning er bounded skulder-/torso-pose, ikke fri knoglelængdeskala. Sol har
godkendt begge rettelser mod Godots 4.7-dokumentation. Alle **10** VR-guiders lokale links
løser, og `git diff --check` passerer. De øvrige seks guider i Sol-reviewet havde ingen
handlingskrævende fund.

## XR-profilskift ind i standardtest-runneren — 2026-10-13

Nightfalls `test_xr_profile_transitions.gd` dækkede allerede controller-/håndprofilskift,
tracker-erstatning, friske inputkanter og afbrudt backpack-træk, men stod uden for
`run_native_suite.py`'s registrerede checks. En `xr-input`-suite gør den nu automatisk
synlig for native- og fast-test-runnerne og knytter ejerskab til Godot OpenXR-guiden.
`owner_doc`-stien følger den eksisterende repo-relative konvention og er godkendt af Sol.
Fokuseret kørsel består **18/18** i både native- og snapshot-runnerne. Backpakkens
runtime-dokumentation beskriver dækningsgrænserne; headsetovergang og fysisk komfort
er stadig ikke valideret.

## Reproducerbar Blender-eksport af våben — 2026-10-13

Våbenbyggeren fjernede nu UV-lag fra texture-free PBR-meshes og afviser ved
eksportkontrol, hvis `TEXCOORD_0` sniger sig ind igen. Dokumenterede Blender-kørsler
bruger `PYTHONHASHSEED=0` og én tråd. To isolerede genbygninger af Morrow, Tern, Rook
og Shear gav byte-identiske GLB-, katalog- og valideringsfiler; modellerne blev samlet
ca. **30 % mindre** (1.069.040 → 742.844 bytes). Våbenkatalog, rifle/pistol-varianter,
backpack-våben og Shear XR-replay bestod **4/4 Godot-processer** på Godot 4.7.2. Sol
har reviewed og godkendt kode, assets og dokumentation. Blender-/Godot-headsetvisning og
håndpasform er stadig ikke valideret.

## Brandstationsdemo: første scenarie-målsætning — 2026-10-13

Brandstationsdemoen viser nu en scenarie-status: **aktiv** indtil pallet, spredningskasse
og dieselpyt alle er slukket, og naborummet holder sig på højst 80 °C og 0,25 smoke density.
Når begge mål er opfyldt, viser skærmen **secured**. Status læses fra den samme thermal-
kerne som sprinklerne, portaludvekslingen og røgvisualerne; grænserne er demo-/spilværdier,
ikke bygningssikkerhedskrav. Status fejler lukket, hvis et target eller naborum mangler.
Tre autorbare presets (`training`, `standard`, `high_risk`) ændrer brændstof-/burn-rate på
fireobjekterne og vandtankens kapacitet/hovedets flow. Standard bevarer de hidtidige værdier;
træning sænker brandbelastningen og forøger vand, mens højrisiko øger palletbelastningen og
sænker flowet til 180 ml/s med en 750 ml reserve. I en fast manuel sprinklerøvelse sikres
alle tre profiler med vand tilbage; tiden til missionstatus stiger monotont (2,6 / 3,2 / 4,2 s),
og brugt reserveandel stiger også (ca. 2,1 / 3,1 / 80,8 %). Sikkerhedsgrænsen for naborummet
er konstant på tværs af presets. Godot 4.7.2-testen består nu **45/45**; den dækker faktisk
burn-rate, succes med endelig væskemængde, tid og relativ ressourcebelastning, standard-default,
ugyldigt preset og synlig missionstatus. Sol-review godkendt.
**N** starter nu en frisk missionrunde ved at genetablere kernel- og visual-state, væskeblandinger,
finite supplies, batteri/net/sikring og dør; den valgte sværhedsgrad bevares. Regressionen
producerer først faktisk vand-spray med visual og kildekvittering, muterer derefter scenariet til
dieselbrand, åbnet dør og blæst sikring, og genstarter via inputruten. Den verificerer baseline,
rydning af rundens sprayeffekt og bevarelse af en host-ejet child-node. Samlet demo-test:
**48/48**; `git diff --check` er ren, og Sol har godkendt implementering og test. Headset-/spilleracceptance
er fortsat åben.

## Rumåbninger til røg og varme — 2026-10-12

Tilføjet `gs_thermal_portals` som et selvstændigt, bounded adapterlag over den native
thermal-kerne. Authorer kan forbinde eksisterende rum med døre, lemme eller ventiler og
ændre åbningen fra lukket til fuldt åben. Adapteren udveksler røg og ilt under en
equal-volume gameplay-antagelse og udveksler varme vægtet efter rummenes varmekapacitet.
Den bruger en 50 ms fast tick, simultane snapshots, konservative deltas og én atomisk
batchopdatering; den modellerer ikke luftstrøm, tryk, geometri eller CFD.

Verifikation på Godot 4.7.2 headless: portaladapter **241/241**, atomisk rum-batch
**14/14**, eksisterende thermal-kontrakt **53/53**. Ved fuld registry-størrelse
(64 rum, 256 brændstofobjekter, 1.024 links, 128 portaler) måltes **2,589 ms mean /
4,270 ms P95 / 5,878 ms max** pr. tick på desktop. Det er lokal desktopmåling, ikke
headset-evidens. Nightfall har nu den genererede addon-kopi og to målrettede native suitechecks.
Headset/standalone-profilering og mission-runtime integration er fortsatte opgaver.
Guide: [thermal portals](../godot/addons/gs_thermal_portals/README.md).
Fire-station-demoen har nu to visuelle rum og en dør på **H**, som åbner/lukker den
samme portal. Integrationstesten beviser, at lukket dør holder naborummet ved ambient
uden røg, og at åben dør udveksler begge kanaler. Demo-kontrakten består **32/32**;
tests dækker også H-toggling og panelgeometri. Demo-guiden er reviewed af Sol. Nightfall har fortsat kun den genererede addon og
kontraktchecks; scenedemoens wiring findes i GameSystems.

## Typet automatisk pytantænding — 2026-10-12

`GSPuddleFireAdapter` kan nu automatisk tænde en typet diesel-/benzinpyt, når en
varmekilde i samme authored rum ligger inden for værtens radius og overstiger
væsketypens gameplay-autoantændingstærskel. Adapteren kontrollerer ilt, vådhed,
skum, brændstoftilstand og at kvitteringen indeholder nok energi til at nå
brandmålets antændelsestemperatur, før væske trækkes. En allerede brændende mål-
proxy kan ikke bruge en ekstra pytteportion. Fire-station-demoen tænder nu den
blandede diesel/vand-pyt fra den nærliggende varme palle; vandet bliver tilbage.
Tærsklerne er spilværdier, ikke kemiske eller sikkerhedsmæssige specifikationer.

Autoantændingen er hysteret på targetets vådhed, så den varme kilde ikke antænder
igen på næste fixed tick efter vandkvælning. Ved generiske supply-adapters kræves
nu `deposit`-rollback: en underlevering tilbageføres, før targetets varme ændres;
afvist rollback rapporteres eksplicit. Præcist utilstrækkelig energi afvises uden
epsilon. For blandinger prøves næste brændstoftype, hvis den første ikke kan levere nok
energi til at nå targetets antændelsestemperatur.

Verifikation på Godot 4.7.2: thermal/fire **51/51**, typed pytter **66/66**,
sprinklerkerne **54/54** og fire-station-integration **27/27**. Regressionen for en
supply-callback, der ændrer rummets ilt under withdraw, bekræfter fuld refundering
uden varmeændring på brandmålet. Mere detaljeret fordampning, damptænding og
væskedynamik er fortsat særskilt arbejde.

## Atomiske manuelle pytteoverførsler — 2026-10-12

De manuelle `burn_fuel_puddle`- og `extinguish_from_puddle`-stier kræver nu en
rollback-capable typed store. De validerer den faktiske withdraw-kvittering, afviser
overtræk og sammenligner brandmålet før commit. Hvis en generisk store-callback ændrer
brandmålet, eller varme-/væskekommit afvises, tilbageføres den præcise kvittering; afvist
rollback rapporteres særskilt. En legitim delvis levering giver fortsat en tilsvarende
delvis varmeeffekt.

Verifikation på Godot 4.7.2: thermal/fire **53/53**, typed pytter **66/66**,
sprinklerkerne **54/54** og fire-station-integration **27/27**. Nye regressioner dækker
ændret måltemperatur inde i både brændstof- og vandwithdraw.

## Native kamera-feed: pixelverifikation — 2026-10-12

Kamera-addonets kontrakt er nu en del af `godot/tests/README.md`, så kildeprojektets
samlede native suite dækker API- og schedulingkontrakten. Godot 4.7.2
består **552 checks fordelt på 14 scripts**, når `gs_cameras` headless-suiten køres
sammen med de øvrige 13 scripts. En separat graphics-enabled Vulkan-kørsel på RTX 3080 Ti
består kameraets **79/79** checks og verificerer feedets scenegeometri og environment-
baggrund samt de samme center-/hjørnepixels på den registrerede monitor. Det er desktop-
GPU-evidens, ikke headset-framepacing eller XR-compositoracceptance.

## VR performance guide: Steam Frame execution paths — 2026-10-12

Clarified that PCVR streamed from a host and games running directly on Steam Frame are
separate profiling targets. The guide now names Windows/Linux PC, ARM64 Linux and Android
APK execution paths and links Valve's current recommendation, so teams choose a build path
from their renderer and workload rather than inferring it from the headset CPU. Sol review
also found missing Godot WebXR startup requirements and a physics-rate caveat. The guides now
cover secure-context/user-gesture startup, async session signals and failure/end handling,
WebGL2/Compatibility, cross-origin isolation options, plus physics tick-rate profiling.
All VR guide relative links resolve; `git diff --check` passes.
Guides: [VR performance](vr/performance_vr.md); [Godot/WebXR porting](vr/godot_webxr_porting.md).

## Optional Godot spatial fire spread — 2026-10-12

Added `gs_fire_spread` as a separate, bounded composition adapter. It registers up to 256
thermal objects and transfers distance-falloff heat from burning objects only to dry,
flammable, fueled neighbors in the same authored room. It snapshots source state before the
pass, so newly ignited targets begin spreading on the next interval, and preflights all
target heat before any mutation. It does not trace occlusion or simulate airflow.

Verification: spatial spread **7/7**, fire-station composition **13/13**, thermal **42/42**;
cross-room isolation, range, delayed chain spread, fixed-tick rejection, demo ignition, and
no-partial-update thermal preflight are covered. The demo also proves one 0.3 s frame matches
three 0.1 s frames with the sprinkler active. Sol approved the guide and demo scheduling.
A room-aware 3D grid skips distant targets; the 256-object benchmark measured 5.15 ms dense
and 2.63 ms sparse average per tick on a Ryzen 7 5700G desktop. Quest/Steam Frame profiling
remains open.
Guide: [Godot thermal](godot_thermal.md); [fire-station demo](../godot/demos/sprinkler_fire/README.md).

## Godot circuit-to-fire heat bridge — 2026-10-12

Added a standalone `gs_electricity_thermal` composition adapter. Hosts bind passive circuit
components to authored thermal objects and transfer positive per-component joule receipts into
the fire/thermal kernel as kilojoules. Heat is aggregated and preflighted per target before any
thermal object changes. `GSElectricityNetworkPump` now exposes the merged per-component receipt
for its pump-on and pump-off parts of a single sprinkler-owned network interval, so other loads
can share the circuit and heat bridge without advancing the network twice.

Verification: adapter **6/6**, electricity **24/24**, sprinklers **54/54**. Direct-network
and pump-owned receipt paths, invalid receipt rejection, passive component bindings, and
no-partial-heat preflight are covered. Quest/Steam Frame profiling remains open.
Guide: [Godot electricity](godot_electricity.md); source: `godot/addons/gs_electricity_thermal/`.

## Native Godot electricity and sprinkler circuit — 2026-10-12

Added bounded DC network simulation with ideal sources, finite internal-resistance batteries,
wires, switches, instant fuses, resistive loads, energy-boundary integration, battery views,
versioned restore plans, and a network-powered sprinkler adapter. The fire-station scene now
routes its pump through a battery, wire, switch and fuse; an overload branch trips the fuse
until the fault is disconnected and the fuse replaced.

Verification: electricity **24/24**, fire-station composition **11/11**, JavaScript network/pump
reference contracts **28/28**, Godot editor parsing and scene launch smoke pass. Sol approved
the updated guide and addon README. The model is gameplay-scale DC, not AC, conductor thermal simulation or device profiling.
Guide: [Godot electricity](godot_electricity.md).

## Godot fire-station composition demo - 2026-10-12

The runnable, asset-free 3D scene now composes spatial fire spread, the bounded thermal fire,
finite water, and a finite-battery pump on the switch/fuse circuit. Its 13/13 integration
contract covers spread ignition, active-sprinkler frame-partition equivalence, fuse trip,
water debit and the automatic sensor. Sol reviewed the demo without remaining blockers.
It is not a headset comfort or performance result.
Usage: [fire-station demo](../godot/demos/sprinkler_fire/README.md).

## Native Godot fire/sprinkler checkpoint — 2026-10-12

Thermal, liquid tank, battery, battery-pump and sprinkler kernels now expose independent,
versioned checkpoints. Thermal restore stages the full room/object/link graph before commit;
the other stores validate bounded mutable state atomically and require their authored adapters.
Sprinkler restores head config/latches/time only when its registered supply IDs and optional
power-provider presence match. Hosts pause at one save boundary; restore thermal, tanks,
batteries, pump state, then sprinkler state. Bottle source snapshots remain host-coordinated.

Verification: thermal **42/42**, resource adapters **35/35**, sprinkler **54/54**; Godot editor
scan passes. Sol review found that provider order alone is not a cross-system transaction; the guide now requires staged preflight/atomic world swap or full rollback. A regression verifies failed staged restore leaves the active world untouched. Thermal and sprinkler checkpoints now preserve runtime insertion order; reversed-ID multi-object/head tick replay passes. Sol's final checkpoint review was approved, and the authored scene wiring is now covered by the fire-station demo above. Headset profiling and richer occlusion/airflow fire behavior remain open.
Guides: [thermal](godot_thermal.md), [supply adapters](godot_resource_adapters.md),
[sprinkler](godot_sprinklers.md).


## Native sprinkler-batteripumpe — 2026-10-12

Den native Godot-sprinkler kan nu bruge den udskiftelige `power_fraction(requests, dt)`-kontrakt.
`GSSprinklerBatteryPump` kobler den til det eksisterende `GSBatteryAdapter`, begrænser fælles flow
pr. fixed tick efter både pumpens ml/s-kapacitet og leveret Wh, og undlader at trække væske ved
tomt batteri. Uden provider er sprinklerflow fortsat uændret. Den senere native
`gs_electricity` provider og fire-station-demo bruger samme kontrakt.

Verifikation: sprinkler-pumpe-suite **47/47**, thermal **42/42**, resource-adapters **35/35**.
Sol har godkendt pumpe-implementationen og guiden. Checkpoint-opfolgningen er dokumenteret nedenfor.
Guide: [Godot sprinkler](godot_sprinklers.md).

Mål oprettet 2026-10-10: find, løs og verificér konkrete forbedringer. Når aktive opgaver er løst,
fortsættes med nye fund i brandsystemet eller de øvrige systemer. En tom opgaveliste afslutter ikke målet.

## Afsluttet native typede pytter: HIGH-stream host-checkpoint — 2026-10-12

`GSPuddleStore` bevarer separate komponenter og stabile ID'er gennem merge,
delvist forbrug og fordampning. Managerens dråber bevarer eksplicit identitet fra
pour-parcels, splash og HIGH hole-stream FIFO. Benzin/diesel/foam består indtil
eksplicit forbrug, fordampning, cleanup eller bogført budget-eviction; legacy
water/wine/unknown beholder visuel levetid med faktisk bogført fordampning.
Kvalitetsgrænser og world-lifecycle er fortsat afgrænsede. Managerens version 2
liquid-checkpoint inkluderer nu aktive HIGH hole-streams med akkumulator, typed
FIFO, landing-geometri, flight clock, stopfade og stabil stream-ID. Bottle-source
checkpointet gemmer samme stream-ID pr. hul; hosten skal tage begge snapshots i
samme paused/fixed-tick transaktion og gendanne manageren før flaskerne.

Første runde er godkendt af Sol og pushet som `438036b`. Reviewet fandt, at HIGH
hole-stream FIFO beholdt identitet, men brugte seneste mutable landingspunkt.
Opfølgningen indfanger endpoint, normal, hit/miss, flight delay og splash-radius
per batch; flytning af kilden flusher gammel accumulation før ny trajectory.
Hver stream har højst 256 ventende batches med eksplicit lost-receipt ved overflow.
Sols opfølgende review fandt også, at en lang tidligere flyvetid kunne blokere
en allerede klar kort batch. Parallelle batchfelter indsættes nu samlet efter
due time, så høj→lav-kilde-regressionen leverer den korte batch, mens den lange
fortsat er airborne.
Neck-snap-spurtens tidligere 5% væske-mint er rettet: source fill, visuel fill og
fysisk masse debiteres før manageren modtager spurtens faktiske typede volumen.

Verificeret opfølgning: puddle **53/53**, bottles **29/29**, pour receivers **22/22**;
første rundes resource adapters **29/29**. Det beviser managerens og store-overgangenes ledger,
ikke alle kilde-flaskens brudruter eller et native brandsystem.
API og begrænsninger: [native_puddles.md](native_puddles.md).

Low-tier hole-accumulatorer flushes nu ved terminal flaske-break, og intakte
flasker kan checkpoint/restore kildefyldning, typed sub-drop-mængde, farve og hul-
topologi atomisk. HIGH-stream persistence er implementeret i manager- og
flaskesnapshots; 66-check integrationssuite passeret, afsluttende Sol-review godkendt. Næste selvstændige
WebXR beholder sit separate pool-/thermal-/sprinklersystem. Se næste afsnit for
den native Godot-fire/thermal-kerne. Næste opgaver er sprinklerstyring og supply,
derefter spatial brandspredning og koordinerede flaske-checkpoints.

## Native Godot thermal/fire — første vertikale snit — 2026-10-12

`gs_thermal` er et selvstændigt bounded Godot-addon med rum, temperatur, oxygen,
røg, finite brændstof, authored varmeforbindelser og 20 Hz fixed steps. Den valgfrie
`GSPuddleFireAdapter` bruger kun faktiske store-receipts: petrol/diesel giver
gameplay-varme, mens vand/skum slukker. Runtime varme holdes inden for den dokumenterede
tilstandsgrænse, også når rum, forbrænding eller forbindelser leverer varme. Alle budgets
og retningslinjer er beskrevet i [Godot thermal-guiden](godot_thermal.md); de 33 fokuserede
checks består.
Sol har reviewet både koden og guiden uden resterende blockers. Det er ikke endnu
samme feature-scope som WebXR: sprinklerplanlægning, spatial spredning,
checkpoint-koordinering og headsetmålinger mangler fortsat.

## Afsluttet VR-vejledninger — 2026-10-12

`docs/vr/` samler ni guides og et indeks om AI-agenters arbejdsgang, Godot/OpenXR,
portering mellem Godot OpenXR, Godot WebXR-export og den separate Three.js/WebXR-app,
VR-kontroller og interaktion, IK/avatarstørrelse, active ragdolls, NPC-adfærd samt
VR- og generel spilperformance. Godot 4.7-start, Steam Frame/Index input og adskillelsen
mellem Steam Frame standalone og PCVR er tydeliggjort med aktuelle officielle referencer.
Sol reviewede alle guides; lokale links og de sidste rettelser er godkendt.
Guides: [VR-indeks](vr/README.md).

## Native Godot sprinkler — første selvstændige kerne — 2026-10-12

`gs_sprinklers` forbinder den eksisterende typed supply-tank med thermal-rum gennem
uafhængige sprinklerhoveder, automatisk temperatur-responstid, manuel test, ventil,
proportional deling af næsten tom forsyning og typed spray-receipts. Vand køler, skum
undertrykker, og andre væsker bevarer deres identitet i receipt, så hosten kan aflevere
dem til pyt-systemet. Per-head mål og fixed-step-arbejde er begrænset. Den fokuserede
suite er siden udvidet til 54/54 med batteri- og netværkspumpe, flowbegrænsning og
power-kvitteringer. Sol har godkendt kerne og guider; grid, fire-station-demo og koordineret
checkpoint er implementeret. Headset-profilering er fortsat åben.
Guide: [Godot sprinkler](godot_sprinklers.md).

## Afsluttet gs_bottles pour-quality-runde — 2026-10-12

Pour-strålen følger nu flaskens aktive distance-LOD og per-pour quality ceiling. De fire
kvaliteter bruger cachede rør med 440/252/126/50 vertices. Landingsstænk bærer faktisk væske,
så deres kadence er ens for alle visuelle tiers; en manager-volumentest dækker dette. Alle kvaliteter
bevarer samme væskedræning, per-tick-parcel, receiver-hit og puddle-regnskab.

En Nightfall-integrationstest fandt en frame, hvor den renderede liquid-LOD stadig kunne være HIGH,
efter runtime-kvaliteten var sat til LOW. `_stream_mode()` begrænser nu først til den aktuelle
containerkvalitet og derefter til en gyldig distance-LOD. Regressionstesten simulerer dette stale tier.

Verifikation: addon-kontrakt **30/30**, Nightfall `game-systems` **26/26**, fuld GameSystems
Node-suite **559/559**, produktionsbuild består. Godot-headset-frame-time er ikke målt.

## Afsluttet GearInventory root-rebind-runde — 2026-10-12

Scene-adapteren afviser nu skift af owner-root, mens inventory-ledgeren stadig har
registrerede genstande hos den owner. Det forhindrer, at håndbårne eller world-ejede
genstande bliver hængende under en gammel scene-root, mens ejerskabet fortsat peger
på den nye. Samme root er et sikkert no-op; root-skift er tilladt, når owneren er tom.

Verifikation: GameSystems scene-adapter **82/82**; Nightfall rygsæk-/inventory-udsnit
**13/13 processer, 502 checks**; sync `--check` består. Sol-review uden blocker.

## Afsluttet flow-emitter-batch-runde — 2026-10-12

Flow gennemfører nu alle aktive emittere, også når en effekt-, flow- eller supply-observer
kaster efter et væsketræk. Begge receipts og emitter-ledgeren bevares; første fejl rejses
efter batchen. Genindtrædende `step()` afvises, og pulser tælles ikke fejlagtigt med i den
holdte dyserate.

Verifikation: flow-suite **20/20**, fuld WebXR-demo Node-suite **534/534**, flow-browser-smoke
**17/17**, produktionsbuild består; Sol-review uden blocker.

## Afsluttet electricity-step observer-runde — 2026-10-12

Hvis `electricity:changed` eller `electricity:energy`-observere kaster, afslutter et igangværende
`step()` nu stadig batteri- og belastningsregnskabet for det allerede simulerede tidsrum, og
rejses derefter med den første observerfejl. `evaluate()` færdiggør også sin notifikationsbatch
før fejlen kastes. Reelle solverfejl bevares som fejl i selve evalueringen.

Verifikation: fokuseret electricity-suite **18/18**, fuld WebXR-demo Node-suite **536/536**,
produktionsbuild og Sol-review består.

## Afsluttet sprinkler-power-provider-runde — 2026-10-12

Sprinklerhovederne samler nu temperatur-, trigger- og flowændringer før commit. Hvis den rene
`powered(headId)`-gate kaster, forbliver hele tick-fasen ventende og kan genforsøges uden delvis
head-state eller væsketræk. Pumpefraktionen kan derimod allerede have fremrykket elnettet; dens
fejl forbruger derfor fasen og efterlader sprinkler-state uændret, så batterienergi ikke debiteres
igen ved retry.

Verifikation: sprinkler-suite **18/18**, fuld GameSystems Node-suite **538/538**, produktionsbuild
og Sol-review består.

## Afsluttet delvist startertræk-runde — 2026-10-12

Hvis et adapterbatteri består startens reservekontrol, men kun leverer en del af starterens
energi, forsøger bilen nu at tilbageføre præcis det leverede beløb. `drawnWh` reduceres med den
faktiske refund; en adapter, der ikke kan opfylde den reversible transfer-kontrakt, giver en
konkret fejl i stedet for stiltiende energitab.

Verifikation: vehicle-suite **18/18**, fuld GameSystems Node-suite **538/538**, produktionsbuild
og Sol-review består. Næste særskilte auditpunkt er observerfejl, der kastes efter et batteri-
eller væsketræk allerede har ændret adapterens egen ledger.

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

## Nyt løbende delmål — fysisk VR-backpack

Færdiggør og verificér et selvstændigt, genbrugeligt VR-backpack-system med fysisk adgang inspireret af
*The Walking Dead VR*: spilleren når tasken hen over skulderen, åbner den med hånden, ser
afgrænsede lommer og tager faktiske genstande ud. Slotting skal være fysisk og let at lære, ja/nej
feedback skal være tydelig ved forkert lomme eller manglende plads, og våben skal kunne skiftes uden
flad inventory-menu. Inventory-ledgeren ejer slot og genstand; spilobjekter ejer ammunition, væske
og gameplay-tilstand. Samspil bruger stabile ID'er og atomiske overførsler.

NightfallContractsGodot har nu en fungerende håndbetjent rygsæk med tre indvendige lommer,
udvendige mounts, reach-/occlusion-regler, weapon-/magasin-integration og et Blender-authored,
tekstureret canvas asset integreret i runtime-scenen. De fire visuelle meshgrupper bevarer de
eksisterende slot-/håndtagsankre, bruger 13.982 trekanter og tilføjer ingen kollidere eller
løbende fysik. Asset-, importer- og hinge-kontrakter er grønne. Den seneste backpack-kørsel
består 9/9 processer og 370 headless-checks, inkl. grebsadgang, kollisionsbegrænset træk,
feedback, våbenintegration og asset-regression; dette beviser ikke headset-fit. Det aktive
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

Nyt afsluttet lifecycle-deltrin: `active_entry_changed` udsendes nu under loadoutens
mutationslås. Synkrone observers kan ikke starte et nested weapon switch/restore eller
ændre registry entries midt i den forrige transitions notifikation. Kildekontrakten
verificerer, at alle observers ser det allerede committede aktive entry, de reentrante
forsøg afvises, og låsen frigives bagefter. Godot-test **30/30**, Sol-review godkendt;
ændringen er synkroniseret til Nightfall.

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
**213 checks samlet**, addon sync-check og Nightfall adapter-kontrakten 65/65 består på Godot 4.7.2.
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

Astra-bilens Blender-kilde, GLB'er og ønskede panel-/ressourceintegration er siden færdiggjort; se den afsluttede bil- og kamerarunde nedenfor.
Forsyning og sprinkler er implementeret i kerne og branddemo. Genopfyldning, blandinger, endelig volumen,
varmeudløsning, ventil, valgfri power gate og checkpoint er verificeret; detaljer i
[supply_sprinklers.md](supply_sprinklers.md). Bilens endelige batteri- og brændstofadaptere er integreret.
Det fysiske DC-strømskab, ledninger, endelige netbatterier og sikringer er også implementeret og driver
kontrolrummets kamera/skærm-system; se [electricity_system.md](electricity_system.md). De oprindelige
sprinkler-, bilasset-, strøm- og kameraopgaver fra den oprindelige liste er altså gennemført. Køretøjets
motoruafhængige chassis-/affjedringsadapter er nu koblet til den bevægelige WebXR-bil: terræn-rays støtter hjulene,
en synlig barriere stopper chassisbevægelsen, og accepteret pose/hjulleje synkroniseres til drivlinje og mesh.
Mere avanceret terræn, ekstra udfjedring og headsetmålinger er fortsat åbne delmål. `webxr-demo`-suiten består
Checkpoint-restore nulstiller også affjedringens transientfjederhistorik og genberegner hjul-/karrosserivisualer mod aktuelt terræn, selv mens bilen er pauset. `webxr-demo` består **558/558** Node-tests; browser-smoken for bevægelse, kollision og restore består **8/8** checks.
Headset-performance er ikke målt; det løbende mål fortsætter med nye fund.

## Afsluttet bil- og kamerarunde

- Astra xhigh leverede Blender-kilde, high/low GLB, PBR-materialer, syv åbnelige dele og interaktiv bildemo.
- Bilen bruger fælles supply-/energy-adaptere, kan bruge lokale simple stores og kan få afhængigheder slået fra.
- Brændstof og batteri kan tømmes; tankklap, starter, lys og let kørselsmodel er verificeret.
- Kameraextension og kontrolrumsdemo: tre feeds, fysisk skærm, delte targets, round-robin og kvalitet med faste budgets.
- Kameraernes strøm-/skærmflag og feedvalg gemmes; genopladning af demobatteriet genskaber billedet.
- 201/201 GameSystems-tests, produktionsbuild, 8/8 bil- og 9/9 kamera-browserchecks består.
- Bil: [vehicle_system.md](vehicle_system.md). Kamera: [camera_system.md](camera_system.md).

Bilens checkpoint-provider er implementeret. `createVehiclePhysicsAdapter()` tilbyder chassis-sweep,
collision-skin, fire hjulraycasts og dæmpet compression/heave/pitch/roll; WebXR-labben bruger nu laget
med synlig barrieretest og bevægelig chassisvisualisering. Avanceret terræn og headset-fit er fortsat åbent.
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

- Dynamisk geometry og flere materialeeffekter; overflade-/højdeafhængig, endeligt doseret skumvirkning er nu implementeret.
- Bilens lette collision-/affjedringsintegration i WebXR-labben er nu implementeret; videre terræn-/køredynamik kræver særskilt acceptance.
- Brand-/røgfeedback i Godot-branddemoen viser nu en afgrænset, lav-omkostnings røgvisual
  pr. rum fra thermal-kernens tæthed; lukket dør holder naborummet visuelt klart, åben dør
  aktiverer dets feedback. `fire_station_demo_tests.gd` dækker begge tilstande. Demoens mål
  og sværhedsgrad er fortsat en separat åben opgave.
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

Første integrationstrin er nu gennemført: `GSBackpackInteraction` ejer den delte
over-skuldervalidering, og NightfallContracts-riggen bruger den til cargo-udtag
via gear-inventory-adapterens normale retrieve-gate. Våbens særlige transfer til
`equipped` fortsætter gennem sin egen validerede callback/rollback. Næste backpack-
gennemgang dækker håndtracking/controller-skift, kropsrammens bevægelse, inventory-
restore og feedback i rigtige VR-flow; komfort og frame pacing kræver fortsat fysisk
Steam Frame-test.

Nyt afsluttet genbrugsdeltrin: den deterministiske lokale håndtagstrækmodel er nu en del af
`gs_backpack` som `GSBackpackHandlePull`. Den deler hånd-/handlingsejerskab, 3,5 cm dødzone,
20 cm loft, udjævning og retur ved tracking-tab mellem værtsprojekter; Nightfall beholder
rumlige sweep-forespørgsler, kropsankring og visning i sin scene-adapter. GameSystems-kontrakten
består nu 34 checks og interaktionsbroen 10; Nightfalls ni målrettede rygsækprocesser plus
`game-systems` består 10/10. Dette er stadig syntetisk/headless-validering, ikke headsetaccept.

Nyt afsluttet backpack-delmål: mislykkede lagringsforsøg ved en åben indvendig
lomme får lokal `FULL`, `WRONG ITEM`, `TOO LARGE` eller `INVALID SIZE` feedback.
Inventory-ledgeren afgør fortsat ejerskab og kapacitet; afvisninger ændrer hverken
genstandens placering eller ledger. Varslerne udløber efter 1,25 s, forældes straks
ved lukning, restore eller relevant ejerskift, og ældre timere kan ikke fjerne nyere
varsler. Den levende backpack-regression flytter også den løste hofteforankring
gennem translation, yaw og lavere crouch-højde og verificerer, at samme cargo-node,
slot-ejer og lokale pasform bevares. Fire fokuserede rygsæksuiter består med
**152/152** checks. Headsetlæsbarhed er ikke verificeret. Næste backpack-gennemgang
dækker syntetiske controller-/håndtracking-skift og tracking-tab under udtag.

Kropsramme-regressionen er nu dækket i den eksisterende `review-backpack-live`-test.
Den flytter det løste holster-anker gennem translation, yaw og lavere crouch-højde og
verificerer, at samme node, lokale slot-fit og inventory-ejer består. Headless-testen
validerer transform-/ejerskabskontrakten, ikke avataranimation eller headsetkomfort.
Nyt afsluttet input-deltrin: et kort tracking-tab, mens hånden aktivt trækker
rygsækkens håndtag, annullerer trækket uden at ændre cargo-ejerskab. Tracking-
reacquisition starter ikke det gamle træk igen, og offset falder under 2 cm.
Testen beviser også, at en fulgt, fri hånd kan tage en genstand ud af en åben lomme;
samme udtag med tabt tracking lader genstanden blive i slot og ledger. Approach,
input, live og release består **112/112** checks. Sol har godkendt testen.
Næste trin dækker et reelt skift mellem controller- og håndtracking. NightfallContracts
har nu desuden en valgfri OpenXR EXT hand-interaction-profil: håndens grasp/pinch
føder de eksisterende grip-, trigger- og backpack-Interact-actions, og pose-actions
genbruger de eksisterende håndankre. Frame og Touch-profilerne bevares. Det statiske
action-map valideres headless; runtime-skift, Operations Menu, haptik og ergonomi
med optisk håndtracking kræver stadig headset-afprøvning.

Nyt afsluttet input-deltrin: rygsækkens Interact-kilde holdes nu adskilt fra den
hånd, der bærer cargo og leverer trækkets pose. Det understøtter Touch og EXT
hand-interaction-profilens venstre Interact, mens højre hånd flytter rygsækken;
slip af den indledende knap annullerer trækket selv hvis den modsatte knap fortsat
holdes. NightfallContracts' ni rygsæksuiter består nu med **391/391** kontroller.
Sol-review godkendte både input-routing og atomisk `bind_player()` lifecycle:
afvist player-/equipped-root-rebind bevarer roots, spillerreference, approach-
historik og drop-rute; manglende equipped-root fjernes kun, når intet registreret
item eller checkpoint-reset længere afhænger af den. Det er syntetisk XR-
verifikation; faktisk OpenXR-profilskift og headset-ergonomi mangler fortsat
enhedstest.

Våbenasset-validatoren kontrollerer nu de eksporterede grebsankre for afstand
mellem primær-/støttegreb, forreste støttegreb på rifler og nærhed til våbnets
mesh-bounds. Blender 5.2.2 validerede Morrow, Tern, Rook og Shear i isoleret
output; GLB-kilderne i projektet blev ikke overskrevet. Sol-review godkendt.
Det er layoutkontrol, ikke headset-måling af håndpasform.

## Afsluttet væske-/batteri-observerfejl-runde

Sprinkleren færdiggør nu spraydosis, alle targets/heads og supply-notifikationer,
hvis en `thermal:cooled` eller `thermal:extinguished` observer kaster; første
observerfejl rejses efter fixed-tick-bogføringen. Bilen batcher valgfri batteri- og
brændstofnotifikationer gennem start og step, så energi-/brændstofregnskab, bevægelse
og senere biler er konsistente før observerfejlen kastes. Sol-review uden blocker.

Verifikation: **548/548** samlet Node-suite, **75/75** fokuserede strøm-/væske-/biltests,
**52/52** thermal/firetests, Vite-build samt `git diff --check` består. Browser-buildens
eksisterende advarsler om bundlestørrelse og tredjeparts worker-import er uændrede.

## Afsluttet rygsæk-/våbenprofil-runde

NightfallContracts' fysiske backpack-rig bruger nu det genbrugelige `GSBackpackInteraction`
til skulderadgang og kontrolleret cargo-udtag; våbens særlige transfer til `equipped` bevarer
sin særskilte callback/rollback. De fem våben bevarer fælles gameplay-kode, men skydevåbnenes
range, recoil/recovery, understøttet affyringsfeedback, haptik og mundingsglimt ligger nu i en
valideret `shot_profile`. Kestrel beholder sine gamle standardværdier; glas- og almindelig
ballistik bruger samme variant-range. Astra implementerede profilerne, Luna tilføjede direkte
test af rude inden for og uden for rækkevidde samt kildekatalogets parser-/valideringstilfælde.
Sol-review er godkendt uden blocker. GameSystems katalogtest består **26/26**; Nightfall
shot-profile-test består **38/38**; addon `--check` består. Headsetfølelse for recoil/haptik
er ikke verificeret.

## Afsluttet Godot UID-artifact-runde

De 26 manglende `.gd.uid`-sidecars for allerede versionerede scripts og tests i
GameSystems' Godot-kilder er nu versionsstyrede. Samlet kontrol finder 42 sidecars,
alle med eksisterende og versionerede mål, uden dublerede UID'er. NightfallContracts'
genererede addon-kopier forbliver uden GameSystems' sidecars, som fastlagt af
`sync_addons.py`; hele addon-synckontrollen passerer.

## Afsluttet termisk portal-flow-runde

Authored portalgeometri skalerer nu ventilens rumluftudveksling efter åbningens
areal, normaliseret mod 1,8 m². Smalle vinduer og sprækker udveksler varme, røg
og ilt langsommere end dørstore åbninger; vents uden portal bevarer hidtidig
flow-rate. Rumspecifik varmekapacitet og `setPosition`-rumskift bevares.
Verifikation: thermal-air, thermal-portals og thermal-numerics **38/38 tests**;
fuld GameSystems Node-suite **559/559**, Vite-produktionsbuild og branddemoens
synlige browserkontrol **24/24** består.

## Afsluttet lavkvalitets-lækagebogføring

Hvis en flaske knustes, kunne små lækagemængder, der allerede var trukket fra
flaskens fyldning, blive stående i hullets sub-dråbe-akkumulator. Shatter-forløbet
overfører nu hver rest én gang til managerens dråberegnskab før den resterende
flaskefyldning splashes. Resten beholder den væsketype/farve, den blev samlet med;
identitetsskift flusher den gamle rest før ny væske akkumuleres. Ugyldig rumlig
overførsel går til managerens eksplicitte removal-kvittering.

Verifikation: Godot puddle-suite **66/66**, bottle source-checkpoint suite **14/14**,
Nightfall bottle-cap/physics suites **257/257**. Managerens liquid-checkpoint
inkluderer nu HIGH-streamtransport, og flaske-checkpointet gemmer stream-ID pr.
hul. Sol-review fandt og hjalp med at lukke normaliserings-, v2-payload- og
staging-/kapacitetsfejl. Hosten skal stadig
tage manager-/kilde-snapshots i samme paused/fixed tick, bevare flaskeidentitet og
pose samt gendanne manageren før flaskerne. Den native brandstationsdemo integrerer
nu også automatisk pytantænding fra en nærliggende varm palle og sprinklerens typed
spray-kvitteringer til vedvarende, synlige vand-/dieselpytter. Demoen kontrollerer
kvitteringernes runoff- og volumenregnskab. Verifikation på Godot 4.7.2: demo
**32/32**, thermal/fire **53/53**, sprinklere **54/54**. Headset-/standalone-
profilering af den sammensatte scene er fortsat åben.

## Afsluttet spatial fire-spread hot-path-runde

Den faste nabo-gennemgang genbruger nu et read-only tomt bucket-/room-grid-fallback,
og hvert kildeobjekts position læses én gang pr. spread-tick. Kilde-/målrækkefølge,
parakkumulering og varmeberegning er uændret. Sol reviewede ændringen og bekræftede,
at fallback-arrays kun læses. Fire-spread-suite består **7/7**, sprinklerdemoens
integrationstest **13/13**, og addon-sync-check består.

Samme maskine (Godot 4.7.2, Ryzen 7 5700G, 256 objekter, 200 ticks) målte tæt scenarie
fra **5195/6468 µs avg/p95** til **4323/4631 µs**; spredt scenarie fra **2193/2384 µs**
til **1909/2032 µs**. Det er desktop-syntetiske mikrobenchmarks. En ny headless måling af
den sammensatte brandstations-host med 256 spread-objekter bruger 20 warmup- og 200
måleticks og kræver, at spray og runoff faktisk sker. En gentagelse målte 6.717 ml spray,
4.812 ml runoff og **1733/1987/2858 µs avg/p95/max** på samme Ryzen 7 5700G. Målingen
inkluderer simulation og demo-stateopdateringer, men ingen rendering; Steam Frame og
headset-framebudget er fortsat umålt. Gentag med
`godot/demos/sprinkler_fire/benchmark_fire_station.gd`.

## Afsluttet sprinklerintegration til brændende dieselpyt — 2026-10-13

Det automatiske vandhoved i brandstationsdemoen inkluderer nu dieselpyt-brandproxyen
blandt sine tre mål. Den ligger ca. 3,29 m fra hovedet og modtager sin andel af den
begrænsede vandmængde; efter tilstrækkelig dosis når vådheden slukningsgrænsen, mens de
resterende 800 ml diesel bevares. En integrationstest tænder pytten, aktiverer
sprinkleren og kontrollerer både thermal-kvitteringen, slukning og typed fuel-ledger.

Verifikation på Godot 4.7.2: brandstationsdemo **36/36**, sprinklerkerne **54/54**.
Sol reviewede target-rækkevidde, dosisfordeling og fuel-regnskab og godkendte ændringen.
Headsetvalidering af sprinklerens visuelle dækning er fortsat åben.
