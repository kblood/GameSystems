# Brandsystem v2 — spilbar model med røg og brændstofpytter

2026-10-10. Bygger videre på de selvstændige GameSystems-extensions. Første runtime: Three.js/WebXR.

Et løbende forbedringsmål er aktivt. Status og næste opgave: [improvement_backlog.md](improvement_backlog.md).

## Checkpoint-milepæl — historisk status (2026-10-10)

Brandstationen gemmer nu hele sin simulation og applikationstilstand, også midt under hældning.
Browsergemning overlever genåbning, og JSON-filer kan eksporteres/importeres. Ugyldige data valideres samlet før commit.
Se [checkpoint_system.md](checkpoint_system.md) for kontrakter, afgrænsninger og restore-planer.
Ved denne milepæl bestod de samlede suites med **170/170 GameSystems** og **339/339 Contracts**;
checkpoint-browserkontrollen bestod med **8/8** scenarier. Dette er den daværende checkpoint-verifikation;
se den aktuelle verifikation længere nede for nuværende suite- og brandbrowserresultater.

## Seneste forbedringsrunde

Pyt-snapshots indlæses nu atomisk. De bevarer vådhed, temperatur, skum, flammer og varmeforbindelser og tilfører
ikke ekstra varme gennem en ny antændelse. Ugyldige værdier, id-konflikter og kapacitetsfejl ændrer ikke den eksisterende verden.
`thermal.replaceObjects` er et offentligt API til valideret, afgrænset udskiftning; eksisterende forbindelser til bevarede id'er består.
`configure` validerer alle felter før commit, og den automatiske spredningsgraf er stabil på tværs af registreringsrækkefølge.

Pytter gemmer nu `sources`, som fordeler hver væskekomponent på dens oprindelse. Flaskedepositioner mærkes med
`sourceKey` (standard `bottles`), mens slangen bruger `hose`. `sourceVolumes` på forbrændings-/fjernelses-events
fortæller bridgen, hvor mange ml den tilkoblede kilde skal afgive. Ukendte ældre snapshots bliver `untracked` og
gætter ikke på en kilde. Slangevand kan dermed opsamles uden at fjerne diesel fra dunkens regnskab.

`bottles.removePuddleVolume` bogfører opsamling i `removedMl`; `consumePuddleVolume` bogfører forbrænding i `burnedMl`.
`pools.clear()` bogfører manuel rydning. Kilde-reset og scene-teardown bruger `clear({account:false})`, fordi kilden selv
ejer nulstillingen. En bridge skal frakobles før genbinding; dobbelte bindinger afvises for at undgå dobbelte debiteringer.
Brand-labbens **Opsaml valgt pyt** fjerner både volumen og gamle flamme-/grafikobjekter.

Seneste verifikation (2026-10-11): GameSystems `npm test` består med **464/464**, produktionsbuildet består,
og brandstationens produktionsbrowserkontrol består med **23/23** scenarier. Den aktuelle browserrapport ligger i
`webxr-demo/test-results/fire/report.json`. Browserkontroller for andre labs indgår ikke i dette brandresultat.

## Hvad systemet kan

Demoen har en [tidsbegrænset brandmandsudfordring](mission_system.md) med sværhedsgrad,
beskyttet rum, gemt fremdrift og en sammenhængende kontrolperiode efter slukning.

Selvstændige [brandalarmer](alarm_system.md) reagerer på rumvarme/røg med dwell,
latchet advarsel, dæmpning og reset. Demoens lamper og statuspanel viser alarmen.

Elektriske ledningstab kan overføres via en selvstændig receipt-adapter; se
[electrical_heat.md](electrical_heat.md) for binding, budget, strøm-ejerskab og demo.

- Objekter har brændbarhed 0–1, antændelsestemperatur, varmekapacitet, brændstof og effekt under forbrænding.
- Temperatur stiger før antændelse. Nabogenstande kan opvarmes og antændes via en cachet rumlig nabograf.
- Varmeoverførsel i nabografen mellem direkte forbundne rum skaleres med åbningens `open` (0–1).
  Flere parallelle åbninger bruger den stærkeste tilgængelige varmevej. Valgfri portal-bounds
  begrænser spredning til åbningens område; der beregnes ikke luftstråler.
  Eksplicitte `connect`-links er fortsat materialeforbindelser med deres egen conductance.
- `setPosition(id, position, roomId)` flytter position og rum samlet, invaliderer nabografen og udsender
  `thermal:changed`. Indflytning i iltfattig luft slukker straks en igangværende brand, mens varme og
  brændstof bevares. `null` betyder udendørs luft; udeladt rum bevarer det nuværende rum.
- Antændelse og slukning har forskellige temperaturgrænser, så en igangværende flamme ikke flimrer ved én tærskel.
- Rum har en begrænset iltreserve samt varme og røg. Døre/vinduer forbinder reservoirs; udvendige åbninger giver frisk luft.
- `airConductance` kobler genstandens temperatur til dens rums lufttemperatur. Varm luft kan opvarme og
  antænde genstande uden spatial nærhed til flammer; varme genstande kan afgive varme tilbage til luften.
  Feltet kan sættes ved `add` eller `configure` og gemmes med genstanden. Standard 0 er frakoblet;
  nye bygninger i branddemoen bruger 0,5. Gamle gemninger uden feltet indlæses som 0.
- Lukker man rummet, falder brandens effekt, og den kan gå ud, mens varmt brændstof og røg bliver tilbage.
- Ny ventilation kan antænde stadig varmt brændstof igen. Vand køler; skum/overfladedækning begrænser forbrændingen.
- Røg stiger og samler sig ved loftet. Den kan blive i rummet efter slukning og overføres til et naborum via en åben portal.
- Vand, diesel og olie kan ligge i vedvarende, logiske pytter. Brændbare komponenter har deres egne gameplay-profiler.
- Et hurtigt brændende `powder`-objekt og en tidsstyret `blast` giver abstrakte krudt-/bombeeffekter til spil.

Alle profilværdier, ladningsstyrker og brandtærskler er spilparametre. De er ikke specifikationer for rigtige materialer,
krudtsammensætninger eller eksplosive konstruktioner. Iltreserven er normaliseret: 1 betyder almindelig frisk luft,
ikke en fysisk iltkoncentration på 100 procent.

## Afgrænsning og performance

### Dynamiske objekter i events

Thermal-events må fjerne eller udskifte objekter, også med samme id. Simulationen
kontrollerer den konkrete objektinstans før videre behandling/notifikation. Nye objekter
indgår fra næste fixed step; ændret nabo-topologi genbygges også under catch-up-opdateringer.
Fjernes et allerede planlagt objekt, udføres dets senere arbejde ikke. Vand til en planlagt
brand stopper dens kommende forbrænding. Iltregnskabet bruger faktisk frigivet energi,
så et slettet planlagt objekt ikke forbruger luft. Rum kan fjernes efter deres objekter.
Dispose afbryder resterende trin og events.

Reentrant `step` og `restore`/restore-commit under et termisk trin afvises eksplicit.
Gem/restore hele verden mellem host-opdateringer, når alle ejere har færdigbehandlet
deres kvitteringer. Events er ikke en checkpoint-barriere. Rate-/profilændringer kan
påvirke kommende fixed steps; denne lifecycle-dækning er ikke en generel event-transaction.

Restore-notify bruger snapshots af de objekter og rum, der fandtes ved rundens start.
Fjernede eller udskiftede instanser springes over; nye instanser indgår ikke i den samme
restore-runde, heller ikke hvis de genbruger et id. Der er derfor højst én restore-notifikation
pr. oprindelig, stadig levende instans. Dispose stopper resterende notifikationer.
Nested restore, notify, restore-commit og step under thermal-notify afvises; guard frigives
også, hvis en direkte observer kaster. Pools bruger tilsvarende batch-/restore-guards.
Almindelige mutations-API'er kan stadig udsende deres egne events; en observers egen
event-feedback-løkke er ikke en ny restore-batch og skal styres af eventbrugeren.
Checkpoint-coordinatoren rapporterer observerErrors efter commit og ruller ikke en gyldig
indlæsning tilbage alene fordi en observer fejlede. Notifikationer er afledt lifecycle,
ikke en ekstra tilstand, der gemmes i filen.

### Rumprofiler

Antalsbudgets er heltal: maxObjects (standard 512), maxRooms (64), maxNeighbours (6),
maxVents (4096) og maxLinks (8192). De to sidste kan være 0 for scener uden åbninger
eller authored varmeforbindelser. Oprettelse og restore bruger samme lokale grænser;
et snapshot fra en større ejer afvises før commit, hvis den nye ejer har et lavere budget.
Budgetværdier er ejer-konfiguration og behøver ikke være identiske, når de gemte antal passer.
Automatiske neighbour-links er fortsat begrænset af maxNeighbours, særskilt fra maxLinks.

`connect` må opdatere en eksisterende forbindelse ved fyldt budget. `connectNearby`
validerer radius/conductance og hele kandidat-batchen før mutation, så et overskredet
link-budget ikke efterlader en delvist ændret graf. Endpoint-par bruger entydig JSON-
encoding, også hvis ids indeholder skilletegn. Vent-ids valideres ved oprettelse.
Stats viser vents/connections og de valgte maxVents/maxLinks. JSON-state har derudover
sin egen byte-/nodegrænse; antalsbudgetter ophæver ikke disse serialiseringsgrænser.

`hasConnections(id)` er et direkte opslag i det afledte endpoint-indeks for authored
links. Ukendte/fjernede ids giver false. Indekset vedligeholdes ved connect, atomiske
connectNearby-batches, removal, scoped replacement, restore og dispose. Samme-id
replacement bevarer eksisterende material-links som hidtil. AutoSpread-neighbours
indgår ikke i denne query. Indekset serialiseres ikke og genbygges ved restore.

Pytternes cold-eviction bruger nu dette opslag. Lokal kontrol med 300 uvedkommende
objekter/forbindelser, én beskyttet linked pool og 2.000 skift mellem to kolde pytter
lavede tidligere 4.000 komplette thermal-captures og tog ca. 652 ms; med indeks var
der 0 captures og ca. 76 ms i samme testcase. Tiderne er enkelte lokale Node-CPU-
målinger, ikke headset-/FPS-resultater; nulsnapshot-reglen testes separat.

`addVent` kan få `portal:{min:[x,y,z],max:[x,y,z]}` i verdenskoordinater. Det er en
axis-aligned, ikke-tom åbning med mindst to positive dimensioner; den kan også være en plan.
Segmenter gennem åbningen bruger direkte afstand. Ellers beregnes en konservativ rute
via de nærmeste punkter i portal-boksen. Ruten skal være inden for spreadRadius for
direkte nabovarme. Det giver varme omkring en nærliggende dørkant, men stopper spring
gennem en massiv del af en rumskillevæg langt fra døren. Der er ingen fuld pathfinding,
geometrisk raycast eller tryk-/luftsimulation i denne beregning.

`heatPath({roomId,position},{roomId,position},radius)` giver rutelængde eller null og bruges
også af pool-interest, både til aktivering og beskyttelse af aktive pytter. `setVentPortal`
kan ændre authored åbning og invaliderer det cachede opslag/nabograf. Bounds i capture,
ventState og staged restore er detached. Legacy/gemte vents uden portal beholder den
abstrakte regel med direkte afstand gennem en hvilken som helst åben forbindelse.
Branddemoens nye dørportal matcher åbningen i væggen. Forkert ikke-null portal i en
gemning afvises som layout-mismatch; legacy null forbliver understøttet.

Rumluftens heat/smoke/oxygen-reservoirs udveksles stadig via flow/open, uanset portalens
placering. De abstrakte game-blast-hits bruger rutelængde og open-faktor; dette er ikke
en fysisk trykmodel. `connectNearby` respekterer portalen ved authoring. Eksisterende
eksplicitte connect-links er materialeforbindelser og gates ikke bagefter af døren.

Rum accepterer `heatCapacityPerVolume` (positiv, standard 1200), `heatFraction` (0–1,
standard 0,08) og `coolingRate` (ikke-negativ pr. sekund, standard 0,005) ved addRoom.
De effektive gameplay-værdier beskriver varmeophobning og varmetab uden bygningsgeometri.
`configureRoom(id, values)` kan ændre profilen samt temperature, oxygen og smoke samlet;
ugyldige felter/værdier afvises før mutation. Iltmangel slukker eksisterende flammer straks,
og thermal:room notificerer visninger. Geometri og volume ændres ikke gennem denne API.
Ændring af kapacitet er en authored konfigurationsændring med bevaret temperatur, ikke
en fysisk byggeproces. Værdier gemmes pr. rum; v1-gemninger uden dem bruger standarderne.

Ventilation overfører ilt/røg efter rumvolumen og varme efter de to rums effektive
kapaciteter. Temperaturen kan ikke overskyde ligevægten, og rum-til-rum-udveksling
bevarer varmeenergi, også når kapaciteterne er forskellige. Udvendige åbninger kobler
mod ambient. Branddemoens profilvalg gælder valgt genstands rum og gendannes fra thermal-state.

Rum-/genstandsudveksling beregnes samtidigt for hvert rum ved de eksisterende fixed steps.
Rummets game-tuned varmekapacitet er volume*heatCapacityPerVolume (standard 1200). Den implicitte udveksling bevarer den
vægtede varmeenergi og holder temperaturer mellem de deltagende starttemperaturer, også ved
stor conductance. Forbrænding, objekters separate `cooling` og rummets passive vægkøling
beregnes stadig som selvstændige tilførsler/tab. Der er én kobling pr. aktivt koblet objekt;
ingen voxel-, airflow- eller alle-mod-alle-beregning. Kolde objekter i kold luft forbliver idle.
Udendørs genstande har ingen room-reservoir-kobling. Objektet følger nyt rum ved setPosition.

Luftkoblingens nodegrupper og beta-vægte caches, og kolde/equal-temperature-rum sættes i
hvile. Varme, vand, forbrænding, heaters, links, vents og blast-varme vækker relevante rum.
Flytning mellem rum, ændret kapacitet/conductance, objektudskiftning og restore genbygger
cachen. Render-frame-raten ændrer ikke disse fixed-step-regler. Caches er afledt data og
gemmes ikke i checkpoints. `stats()` viser airNodeChecks, airExchanges og airRebuilds.
En scene med 512 koblede kolde objekter kontrolleres én gang og kræver derefter ingen
gentagne air-node-checks, indtil en relevant ændring sker. Den almindelige gennemgang af
objekter, varmeforbindelser og rum samt gameplay-events er stadig under eksisterende budgets.

Thermal-kerneberegningerne bruger stabil vægtet blanding og begrænsede overførsler, så
store, men repræsenterbare temperaturer og røgmængder ikke skaber `Infinity` eller `NaN`
under passiv udveksling. Direkte `addHeat`, `addFuel` og `water` kontrollerer også den
resulterende gemte tilstand før commit; en handling, hvis temperatur, brændstof, vådhed
eller køleenergi ikke kan repræsenteres endeligt, afvises atomisk med `RangeError`.
Det holder gemninger gyldige uden at skjule ubogført energi eller væske gennem vilkårlig
clamping. Det ændrer ikke den game-tunede fysik ved normale værdier.
Ved ekstremt store temperaturer eller heaterbidrag forudsiger et for-tjek alle fixed steps,
inklusive temperaturudveksling gennem rum, vents, links og automatisk spredning. Hvis den
passiv udveksling efterfulgt af heateren ville gå ud over talområdet, afvises step’et før
clock eller pending-tid flyttes. For udendørs objekter medtages også antændelse, brændstof
og brandvarme i forudsigelsen. Hvis heaterens koblede komponent indeholder rumforbrænding
eller en blast, som for-tjekket ikke kan modellere sikkert, afvises det ekstreme step før
clock eller pending-tid flyttes. Direkte blast-skade validerer alle måltemperaturer, før
skaden skrives, så `Infinity` ikke kommer ind i thermal-state; fejlen kan dog opstå efter,
at ladningens fuse-clock er udløbet.

Lokal Node-CPU-kontrol: 512 objekter, 8 rum, autoSpread fra, 200 warmup-trin, tre prøver
med 3.000 trin à 0,05 s. Median før/efter cacheændringen var ca. 447/45 ms på denne maskine.
Det er en konkret idle-kerne-måling, ikke en påstand om hele demoens FPS eller headset-performance.

`assessFireHazards({rooms, objects, hotDormant, hotDormantSummary}, thresholds)` er en renderer-uafhængig,
stateless vurdering, eksporteret fra thermal/index.js. Brug `roomStates()`, `objects()` og
pool-systemets `hotDormant()` som input. Rapporten har `clear`, `reasons`, `rooms` og `outside`;
hver rumrapport indeholder brand-/ladnings-/varmt-brændstof-tal samt `hotAir`, `smoky` og `lowAir`.
Også udendørs brand og hvilende varmt brændstof blokerer clearance. Skum på varmt brændstof
fjerner flammerne, men ophæver ikke advarslen om varme. Metal og opbrugt brændstof tæller ikke som genantændelsesrisiko.

Standardgrænser er `heatLimit:60`, `smokeLimit:.02` og `airLimit:.5`: temperatur skal være under
grænsen, røgtæthed højst grænsen og luftreserve mindst grænsen. Grænser kan vælges af spillet.
Dette er gameplay-kriterier, uden fysiologi eller vurdering af sikkerhed i virkelige bygninger.
Rapporten afledes fra eksisterende tilstand og kræver ingen ekstra checkpoint-provider.
Branddemoen viser begge rum og anvender kriterierne til sit slukningsmål.

## Status i VR

Branddemoen viser rumstatus, relativ luftreserve, sigt, slukningsmål, pause samt vand/skum
på en statusplade i scenen, når HTML-panelet skjules ved XR-entry. Pladen er et HUD:
den tegnes foran scenens geometri/røg for læsbarhed og indgår ikke i slange-raycasts.
Den skjules ved XR-exit og genbruges på tværs af reset og gentagen entry.

`webxr-demo/src/world-readout.js` er en genbrugelig Three.js-view-helper med
`mesh`, `setVisible`, `update`, `stats` og `dispose`. Den ejer én 1024×640 canvas-texture,
ét material og én plane. Ændret tekst uploades højst 5 Hz efter wall-clock-tid, også ved
simulation-pause; uændret/skjult tekst uploades ikke. Tekst ombrydes og overflow begrænses.
Endelig page cleanup frigiver alle tre GPU-ressourcer én gang. Det er afledt visning og
har ingen checkpoint-state. En ekstra draw call bruges, mens pladen er synlig.

Entry/exit, re-entry, tekstindhold og konkret rendering er kontrolleret med simulerede
XR-events og et direkte browser-render-frame. Et ægte XR-start overtager render-loopet;
syntetiske events har ikke et headset-loop. Headset-komfort, stereolæsbarhed og fysisk
performance skal stadig afprøves på et headset.

Brug `hotDormantSummary:pools.hotDormantSummary()` til et komplet rumoverblik over store verdener.
`hotDormant()` er en begrænset preview (standard én post), som ikke dækker alle rum.
Summary giver `count` og `rooms:[{roomId,count}]`; assessment accepterer enten summary eller
en fuld hotDormant-array, og afviser uoverensstemmende/duplikerede tællinger og dobbelte inputs.
Tællinger opdateres ved pool-mutationer og afledes igen ved restore; hver frame kopierer kun
rumaggregater, ikke alle væskeposter. Udendørs poster bruger roomId:null.

Røg-VFX reserverer per-room plads for aktive brand-/røgkilder. Mange brande i det først
registrerede rum kan ikke fylde hele budgettet, mens et andet rum mangler røgvisning.

Eksisterende skyers opacity følger nu rummets aktuelle smokeDensity, så ventilation
gradvist gør dem svagere. Uden en aktiv røgkilde fjernes partikler, når density er højst
0,003, frem for at blive hængende op til deres gamle levetid. Lokale source-faner er
knyttet til fire-id og room-id og kan ses tidligt, inden room-reservoiret er fyldt.
En eksplicit smokeYield:0 producerer ingen fiktive faner. Når kilden stopper eller
flytter rum, følger gamle skyer kun den tilbageværende røgmængde i deres eget rum.
Dette ændrer hverken termisk tilstand, ilt, volumen-ledger eller checkpoint-data.

Room-bounds bruger en indvendig margin på højst en fjerdedel af hver dimension,
begrænset til 0,05. Partikelcentre forbliver derfor inde i selv smalle bounds; ændrede
bounds clamper eksisterende centre med det samme. Nye bounds efter dispose afvises.
10 Hz-clock håndterer floating-point-grænser, så eksempelvis 0,3 s giver samme tre
visuelle trin som 3×0,1 s. VFX-budget/draw-batch er uændret.
Ved fyldt budget donerer det mest repræsenterede rum en gammel partikel til et underrepræsenteret rum.
Kvalitetsreduktion fjerner ligeledes partikler fra de mest repræsenterede rum.
Hvis antallet af røgfyldte rum overstiger partikelbudgettet, roterer visningens udvalg ved 10 Hz;
der er ikke garanti for samtidig visning af alle rum. Ubrugt reserveret plads kan forekomme
ved svage røgkilder. Loftet på 12/32/80/160 instancer og én draw call er uændret.
`smoke.stats().rooms` er en detached oversigt over partikler pr. rum.
`removeRoomBounds(id)` fjerner rumgrænser og tilhørende VFX straks; fjernede thermal-rum
får også deres gamle partikler ryddet ved næste visuelle simulationstep. Disse ændringer
ændrer ikke thermal-reservoirs, ilt, brand eller checkpoint-data.

Der er ingen fuld luft-, tryk- eller fluidsimulation. Spillet deklarerer rum, åbninger, objekter og deres placering.
Automatisk spredning blokeres mellem rum uden en åben forbindelse. En eksplicit varmeforbindelse kan repræsentere
f.eks. en varmeledende genstand gennem en væg. Grafen fortolker ikke bygningens mesh automatisk.

- Brandkerne: fast 20 Hz, uafhængig af renderingens FPS og grafikkvalitet.
- Kolde, hvilende objekter springer aktive beregninger over; forbindelser uden temperaturforskel udfører ingen varmeudveksling.
- Rumlig hash cachet indtil objekter flytter eller åbninger ændres. Standardgrænse: seks automatiske forbindelser pr. objekt.
- Standardbudgetter: 512 termiske objekter, 64 rum og 128 aktive termiske pytter. Flere logiske pytter bevares
  med kilde, komponenter og position som hvilende poster. Grafik har et separat loft. Se [pool-budget](pool_budget.md).
- Røggrafik: én instanced samling med 12 / 32 / 80 / 160 partikler på minimal/lav/mellem/høj.
  Partiklerne opdateres ved 10 Hz og klippes til deres rum, inklusive loftet.
- Røgmasse, sigtbarhed, ilt, varme og tilbageværende brændstof påvirkes ikke af røggrafikkens budget.

Der er dermed en klar vej til et brandmandsspil eller et spil om at starte og kontrollere virtuelle brande, uden at gøre
al luft og alle materialer til en dyr simulation. Hardwareperformance og headset-komfort er endnu ikke målt.

## Selvstændige moduler

| Extension | Ansvar |
|---|---|
| `thermal` | Objekttemperatur, brændbarhed, forbrænding, spredning, ilt/røg/varme pr. rum, åbninger, spil-ladninger |
| `pools` | Vedvarende væske pr. position/flade, komponenter, brændstof, brændt volumen og JSON-snapshots |
| `smoke` | Billig Three.js-visualisering af den termiske kernes røg; kan fjernes uden at ændre gameplay |
| `bottles` | Eksisterende beholdere, hældning og faldende dråber; leverer depositioner og autoritativt volumeregnskab |

Kernerne i thermal og pools er engine-uafhængige. Pools bruger thermal gennem dets offentlige API. Smoke får
Three.js, scene og thermal-API fra værten. `pools/bottle-bridge.js` forbinder events og volumeforbrug uden interne imports.

## Brug

```js
const fire = await host.load(thermalExtension, { autoSpread: true });
fire.addRoom('kitchen', { volume: 16, floor: 0, ceiling: 2.6 });
fire.addRoom('hall', { volume: 20 });
fire.addVent('door', { a: 'kitchen', b: 'hall', flow: 3, open: 1 });
fire.addVent('window', { a: 'kitchen', flow: 5, open: 1 });
fire.add('chair', {
  material: 'wood', roomId: 'kitchen', position: [0, 0.3, 0],
  flammability: 0.7, ignition: 180,
});
fire.ignite('chair');
fire.setVent('door', 0);
fire.setVent('window', 0);
// host.update(dt) driver kernens faste trin.
```

`configure(id, {...})` ændrer temperatur, brændbarhed, antændelse, brændstof eller effekt.
`water(id, ml)` køler og gør overfladen våd; `suppress(id, coverage)` giver en vedvarende overfladedækning 0–1.
`addHeat`/`setHeater` kan forbindes med andre systemer, eksempelvis elektricitet.
`state`, `objects`, `burningObjects`, `roomState`, `roomStates` og `stats` giver data til spil/AI/UI.
En dør fra mechanics kan drive både `thermal.setVent` og `acoustics.setPortal` med samme åbningsgrad.

De centrale events er `thermal:ignited`, `thermal:extinguished`, `thermal:burned`, `thermal:room` og `thermal:blast`.
Blast-eventet har position, radius, abstrakt styrke og berørte objekter. Værten bestemmer kamera-/lyd-/partikeleffekt,
spilskade og fysisk impuls. Der er ingen destruktion af bygningsmesh eller realistisk trykbølge.

## Diesel og vedvarende pytter

```js
const pools = await host.load(poolsExtension);
const stopBridge = connectBottlePools({ host, bottles, pools });
bottle.liquidKind = 'diesel';
// Eksisterende hældning sender liquid:deposit, når dråberne rammer en registreret flade.
// Fladens materialId bruges som stabil surfaceId; roomFor(event) kan vælge rummets id.
```

Pytter har komponenter i ml. `diesel` og `oil` er brændbare; vand/ukendt/gammel `mixed` bliver ikke gættet som brændstof.
Nye dråber med blandinger bevarer `components`, også når et lavt grafikbudget samler flere dråber.
Flasker, der modtager blandinger, bevarer `liquidComposition` som fraktioner til næste hældning. Farveblanding er separat
og bevarer den anden agents absorbance-/shaderimplementation.

`pools.ignite(id)` og `pools.heat(id, joules)` bruger pyttens antændelsestærskel.
Når pytten brænder, forsvinder kun brændbare ml; vand bliver tilbage. `pools:consumed` kobles via bridgen til
`bottles.consumePuddleVolume`, så `burnedMl` bliver en dokumenteret sink i flaskernes ledger.
VFX-eviction ændrer ikke den logiske pyt. Man kan således komme tilbage til diesel, der stadig ligger på gulvet.

`pools.save()` er et JSON-kompatibelt snapshot med position, komponenter, kilder, temperatur og forbrug.
`pools.restore(snapshot)` genindlæser det. Brandstationens checkpoint-composition gemmer de matchende
kilde-/beholderledgers og rumtilstande sammen med det og kan derfor indlæse efter mere hældning eller nulstilling.
`restorePuddleLedger` består som en lavniveau-kontrol til lokal rewinding uden ændret kildeinventar.

Bridgen er tiltænkt én pool-owner pr. flaske-runtime. Observerede pool- og materialevolumener må ikke lægges oven i
flaskernes world ledger. Vand fra labbens slange har sin egen, begrænsede vandtank.

## Brandstation-demo

Start `npm run dev` i `GameSystems/webxr-demo` og åbn `/fire.html`.

Bygningen har to rum, en dør, et vindue, brændbare genstande og den eksisterende GLB-diesel-dunk.
Vælg genstand/pyt ved at klikke eller med vælgeren. Justér brændbarhed og antændelsestemperatur, tilfør varme eller
antænd, og test rummenes åbninger. Sprøjt vand eller dæk med skum. Dunkens faktiske hældning laver brændstofpytter.
Tidsvælgeren kan sættes til 5×, når man vil afprøve iltmangel og langsom temperaturudvikling.

Der er et enkelt slukningsmål med status for aktive flammer, varmt brændstof og resterende røg. Det er en
systemprototype; der er endnu ingen fuld kampagne, bygningskollaps, personredning eller færdig karakterstyring.
WebXR har basale world-space slukningsknapper og genstandsvalg, men fysisk headset-test er ikke udført.

## Verifikation af første v2-leverance — historisk baseline (2026-10-10)

- 17 nye tests i `webxr-demo/tests/fire-v2.test.js` dækker temperaturtærskler, brændbarhed, spredning/vægge,
  iltmangel/genantændelse, røgudveksling, fair iltbudget, 20 Hz/quality-invarians, idle-budgets, spil-ladning,
  vedvarende pytter, blandinger, snapshots, faktisk dråbedeposition og begge væskeregnskaber.
- GameSystems samlet: **127/127 tests bestået**.
- Contracts efter standardsynkronisering af genererede flaske-filer: **339/339 tests bestået**.
- Produktion: `npm run build` består og bygger `/index.html`, `/systems.html` og `/fire.html`.
- Fire-browserkontrollen havde ved den første v2-leverance **12/12 scenarier bestået**.
- Den oprindelige system-/flaskedemos browserkontrol: **12/12 scenarier bestået**.

Kør `npm run test:fire:browser` efter et build. Rapporter og screenshots ligger i
`webxr-demo/test-results/fire/`. Browserkontrol er udført med Chrome/SwiftShader og dokumenterer ikke headset-FPS.
Til den anden agent: [fire_v2_handoff.md](fire_v2_handoff.md).
