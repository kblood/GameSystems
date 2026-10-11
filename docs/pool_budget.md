# Pytter: vedvarende data og separate budgets

Det tidligere `maxPools`-loft mistede nye væskers mængde, komponenter og position, når registret var fuldt.
`maxPools` begrænser nu **aktive termiske pytter**, mens logiske poster fortsat bevares som `active:false`.
Eksempel: `maxPools:1`, 20 ml diesel ved [0,0,0] og 40 ml ved [5,0,0] giver to poster, én termisk node
og 60 ml tilbage i ledgeren. `pools:budget` indeholder `id`, `ml` og `retained:true`; deposit returnerer posten.

## Livscyklus og public API

`createPoolsSystem({thermal, airConductance:0})` og pools-extensionens samme option vælger
rumluftkoblingen på nye poster. Branddemoen bruger 0,5. Koblingen gemmes pr. post og
bevares ved merge, deaktivering, aktivering og restore; legacy poster uden feltet bruger 0.
Pool/thermal-checkpoints skal være enige om værdien for aktive noder. Pytter ejer deres
profil, så ændringer direkte i den underliggende termiske node bør undgås.
Interest-scheduleren kan vække koblede brændbare pytter fra varm rumluft uden en spatial radius.

Hvilegrænsen tillader op til ambient + 0,1 °C, så svag udveksling med næsten kold rumluft
ikke låser alle aktive pladser. Temperaturen gemmes præcist ved deaktivering og genaktivering;
der fjernes ingen varmeenergi. Højere varme, vådhed, brand, varmelegeme, links og authored
termiske ændringer beskytter fortsat. Interest-schedulerens protect-list beskytter desuden
koblede aktive pytter i varme rum, også inden deres første termiske step.

- `state(id)`/`all()` bevarer ml, komponenter, kilde, position, rum og aktive/hvilende status.
- `stats()` giver records, active, dormant og maxActive i konstant tid.
- Forbindelsesbeskyttelse bruger `thermal.hasConnections(thermalId)`, når den er tilgængelig,
  frem for at kopiere et komplet thermal-checkpoint pr. kandidat. Ældre thermal-adapters
  beholder capture/links-fallback. Reglen beskytter authored links, mens pool-interest
  beskytter relevante automatiske varme-/rumforbindelser via sin protect-liste.
- `hotDormantSummary()` giver et detached `{count,rooms:[{roomId,count}]}` over alle varme,
  hvilende brændstofposter. Tællinger vedligeholdes ved mutationer og rekonstrueres ved restore;
  opslagets arbejde følger antal berørte rum. `hotDormant(limit=1)` er fortsat kun en preview.
- `activate(id)` aktiverer en hvilende post. Ved fuldt budget kan en sikker, kold post flyttes til hvilende tilstand.
- `deactivate(id)` lykkes kun for en kold, tør og ubrændende post uden varmelegeme, blast, eksplicitte varmeforbindelser
  eller specialkonfigurerede termiske parametre. Varme, brand og andre agenters authored state bliver ikke stiltiende stoppet.
- `ignite(id)` forsøger aktivering og returnerer false, hvis ingen sikker plads findes.
- `heat`, `cool` og `foam` bevarer deres påvirkning også på en hvilende post. Hvilende brændstof brænder ikke;
  varme, tørring og automatisk spredning simuleres først igen ved aktivering.
- `remove(id)` opsamler også hvilende væske og debiterer den rigtige kildes ledger via sourceVolumes.
- `visible(limit)` begrænser grafikkens snapshotliste separat og prioriterer aktive, ikke-tomme pytter.
- `nextDormant()` finder næste ikke-tomme hvilende pyt, så den kan vælges eller opsamles i et spil.

Aktivering bruger en atomisk scoped thermal-replacement, så fejl ikke efterlader en gammel node slettet.
Hvis thermal-systemets samlede objektbudget også er fuldt, forbliver den nye væske gemt som hvilende data.
Alle temperaturoperationer bruger thermal-ejerens ambient-værdi, inklusive indledende påfyldning og køling.

## Opslag, rendering og persistens

Sammenlægning bruger et sparsomt celleindeks pr. flade og rum. Et opslag kontrollerer kun lokale celler
ved almindelige pytradier. Meget store radier bruger et fallback over samme gruppe.
Ved overlappende authored pytter vælges den tidligst registrerede post, også efter restore.
En separat liste af ikke-tomme poster og en cachet remainingMl betyder, at branddemoens render/ledger-visning
ikke skal kopiere hele den voksende historik hver frame. `all()` og fuld snapshot er stadig proportional med data.

`gamesystems.pools.v1` er udvidet med et valgfrit boolesk `active`-felt. Gamle snapshots uden feltet er fuldt aktive
og accepteres inden for deres aktive budget. Nye snapshots kan indeholde flere logiske poster end `maxPools`.
Et snapshot med for mange aktive poster eller brændende/varmelegeme-aktiverede hvilende poster afvises atomisk.
Full-scene checkpoint kræver kun termiske noder for de aktive poster; hvilende metadata gemmes af pool-ejeren.

Logisk lager vokser med antallet af bevarede positioner. Det har ikke et kunstigt loft, der sletter væske;
verdens-chunking og streaming er applikationens ansvar. En enkelt JSON-restore har hostens 2 MiB valideringsbudget.
Dette begrænser inputfilen, ikke allerede levende logiske data. Modellen hævder ikke fuld global brandsimulering
af alle hvilende poster. [Pool-interest](pool_interest.md) aktiverer nu automatisk omkring varme og brande;
viewport-interesse og verdens-chunking er stadig videre integrationsopgaver.

## Branddemo og verifikation

Brandstationen tegner højst 128 pool-instanser og tilbyder »Vis næste gemte pyt« og »Opsaml gemt pyt«.
Kilder debiteres uændret korrekt, også når almindelige flaskedråber skaber en hvilende pyt.

13 nye budget-/persistens/index-tests plus én virkelig flaske-/kildeintegrationstest består.
Der er blandt andet 1.000 logiske poster med kun én aktiv termisk node og 16 grafiske snapshots.
9/9 nye browserchecks bruger faktisk host-deposition: 140 poster/1.400 ml, 128 termiske pytter/instanser,
aktivering, ild, opsamling, helt checkpoint, quality og reset.
De eksisterende brand-, sprinkler- og checkpoint-browserkontroller består også (13, 8 og 8 checks).
Rapport/screenshot: `webxr-demo/test-results/pool-budget`. Headset-performance er ikke målt.
