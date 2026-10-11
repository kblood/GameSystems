# Automatisk aktivering af hvilende pytter

`extensions/pool-interest` er en selvstændig, engine-uafhængig host-extension oven på pools og thermal.
Den aktiverer bevaret brændstof omkring varme objekter, varmelegemer og brande samt i varme rum. Thermal ejer fortsat al
varmeoverførsel, antændelse, ilt, forbrænding og røg; scheduleren antænder ikke fuel direkte.

```js
const interest = await host.load(poolInterestExtension);
// requires: pools + thermal. Radius follows thermal's spreadRadius by default.
// Direct use: createPoolInterestSystem({pools,thermal}), then interest.step(dt).
```

API: `step`, `stats`, `setQuality`, `capture`, `prepareRestore`, `restore`, `dispose`.
Brandstationen indlæser systemet og gemmer det som en separat `pool-interest`-checkpoint-provider.
Thermal-autoSpread overfører varme fra nabogenstande; `airConductance` på pytterne overfører varme fra rumluften.

Hvis thermal eksponerer `heatPath`, bruger source-interesse samme portal-rute som brandens
nabograf. En hvilende pyt på den anden side af en massiv væg vækkes ikke alene fordi en
fjern dør mellem rummene er åben. Protect-listen omfatter tilsvarende kun faktisk reachable
aktive nabopytter. Den eksisterende spatial paging holder kontrol-/aktiveringsbudgettet;
rumvarme-interesse bruger fortsat rummets reservoir uafhængigt af dørplacering.

## Varme rum og store afstande

Rum med temperatur mindst `ambient + minimumRise` indgår i den samme source-roundrobin som varme objekter.
De scanner kun deres eget rum: rumtemperaturer udveksles allerede af thermal gennem åbningerne.
Kun brændbare poster med `airConductance > 0` vækkes af rumluft. Aktive koblede poster i det varme rum
beskyttes før deres første varme-step, så de ikke skiftes ud igen. Fulde, beskyttede budgets rapporterer blocked.
Fjernelse, tørring eller frigørelse af en aktiv plads tillader en senere scanning at fortsætte.

`pools.scanDormantRoom({roomId, maxChecks, limit, cursor, combustibleOnly, coupledOnly})` bruger en
linked room-liste, så hver scanning kun besøger højst maxChecks poster, uanset antal spatial cells eller
rummets størrelse. Resultatet har items/checks/cells/done/cursor; et rumopslag tæller som én cell-budget-enhed.
Cursor genbruges efter save/load. Hvis dens næste post fjernes, genstarter den sikkert fra rummets begyndelse.
Source-id og cursor-fase gemmes i den eksisterende interest-provider. Ingen ekstra termiske simulationstrin
eller varmeenergi tilføres ved aktivering; først thermal-step udfører udvekslingen.

## Budget og valg af poster

Standarderne er én interesse-scanning pr. cirka 0,25 sekund, højst 64 inspicerede pool-poster,
64 besøgte celler og én aktivering pr. opdatering. Lange frame-intervaller sammenlægges i én scanning;
der simuleres ikke et stort antal forsinkede interesse-ticks. Schedulerens arbejde er ikke fysisk energi-integration.
`minimumRise:40` vælger varme objekter relativt til thermal-ejerens ambient; brande og aktive varmelegemer tæller også.
Kvalitet ændrer ikke disse logiske regler.

Varme kilder får skiftevis en tur. Hver kilde beholder sin position i den lokale, rumopdelte søgning,
så en tæt celle med mange ikke-brændbare vandposter kan gennemgås i små portioner uden at kopiere hele cellen.
De kolde celler uden poster tæller også mod besøgsbudgettet. Radius er begrænset til højst 8 meter i scheduleren.
Indsamling af varme kilder og beskyttelse af aktive naboer følger thermal-ejerens objektbudget; det er ikke en
påstand om højst 64 samlede CPU-operationer eller global simulering af alle bevarede poster.

Pytterne får disse supplerende public API'er:

- `scanDormant({position,roomId,radius,combustibleOnly,limit,maxChecks,maxCells,cursor})` returnerer snapshots,
  faktisk inspicerede poster/celler og en JSON-egnet cursor. Genbrug cursoren ved næste kald.
- `hotDormant(limit)` finder tidligere tilført, gemt varme over brændstoffets antændelsestærskel uden fuld historikscan.
- `activate(id,{protect:[...]})` kan beskytte aktive naboposter mod automatisk udskiftning.

Pyt-indexets sammenkædede cellelister understøtter paging og sletning i konstant tid pr. berørt post.
En fjernet næste-post i en cursor får den pågældende celle genstartet sikkert. Flyttet interesse-position
eller ændret rum/filter starter en ny geografisk søgning. Alle poster, kilder og mængder bevares.

## Rum, varme og aktivering

Lukkede rum blokerer interesse på tværs af væggen. `thermal.connectedRooms(roomId)` tillader samme rum
og direkte åbne åbninger mellem to indendørs rum, svarende til thermal-autoSpread-reglen.
En åbning mod det fri forbinder ikke vilkårlige inde-/ude-objekter.

Automatikken kan erstatte en sikker, kold og tør termisk pool-node. Brande, varmelegemer, eksplicitte links,
våde/varme poster og specialkonfigureret thermal-state afbrydes ikke. Naboer, som netop er aktiveret omkring
varmen, beskyttes også, så næste scanning ikke straks udskifter dem, før thermal når at varme dem op.
Ved fyldt fælles thermal-budget prøves en scoped udskiftning af en ejet, kold node, også når pools' eget budget
endnu ikke er fuldt. Hvis ingen sikker plads findes, viser statistikken blocked, og væsken forbliver gemt.
Der opfindes ikke varme eller forbrænding for at få den til at se aktiv ud.

Tidligere tilført latent varme får prioritet, når en plads igen bliver ledig. Branddemoen melder ikke opgaven
færdig, mens sådan gemt varmt brændstof stadig venter. Manuel aktivering/opsamling fungerer fortsat.

## Checkpoint og kontrol

Checkpoint bevarer schedulerens fase, kilde-rotation, rum- og celle-cursors. Pool-snapshots gemmer nu også
`activeOrder` og `hotOrder`, så fremtidige udskiftninger og rækkefølgen af tidligere opvarmede poster er ens efter load.
Ældre pool-snapshots uden disse felter bruger deres eksisterende postrækkefølge. Ugyldige/duplikerede referencer afvises.
Verdens-streaming/chunking er fortsat applikationens ansvar; det logiske lager vokser med bevarede positioner.

14 nye kerne-/integrationschecks og 255/255 samlet GameSystems-tests består. 8/8 nye browserchecks bruger
faktisk host-deposition, native varme-/dørbetjening, normal varmeoverførsel, brændstofledger, budget og fuld reset/load.
De eksisterende 9 pool-budget- og 8 checkpoint-browserchecks består også. Produktionsbuild består.
Rapport og screenshot: `webxr-demo/test-results/pool-interest`. Headset-performance er ikke målt.
