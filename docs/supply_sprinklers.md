# Væskeforsyning og sprinkler

`extensions/supply` og `extensions/sprinklers` er selvstændige, engine-uafhængige systemer.
Sprinkleren afhænger af forsyningens og thermal-systemets public API. Rendering tilhører applikationen.

## Forsyning

`createSupplySystem()` tilbyder `add`, `state`, `all`, `fill`, `draw`, `transfer`,
`capture`, `prepareRestore`, `restore` og `dispose`. Alle mængder er milliliter.
Hver tank har fast kapacitet, komponentmængder og ledger: initial + fyldt − udtaget = tilbage.
Påfyldning returnerer accepteret og afvist mængde; overskud forsvinder ikke stiltiende.
Udtagning og overførsel bevarer blandingens forhold. `draw(...,{kind})` kan udtage en bestemt komponent.
Flytning til en fuld tank trækker kun den mængde, der faktisk kan være der.
Ukendte væsketyper bevares med deres eget navn i forsyningen.

`createFuelAdapter(supply,tankId,{kind:'petrol'})` giver bilen `state`, `consume` og `refill` i liter.
Diesel i en benzintank optager plads, men tæller ikke som benzin, der kan drive motoren.
Dette er en enkel komponentmodel; motors skadevirkning fra forkert brændstof simuleres ikke.

## Sprinkler

Hoveder tilføjes med tank-id, position, rum, flade, gulvhøjde, rækkevidde, flow,
udløsningstemperatur og responstid. `setOpen` styrer forsyningsventilen, `trigger` tillader manuel
udløsning og `reset` repræsenterer udskiftning af et udløst hoved. Udløsningen fastholdes efter afkøling.

Den fælles forsyning deles proportionalt mellem samtidige hoveder, også ved næsten tom tank.
En valgfri `powered(headId)` callback kan afbryde pumpen. Standard er en forsyning uden strømkrav.
En valgfri `powerFraction(requests,dt)` kan også skalere flow med faktisk leveret energi;
branddemoen bruger nu [pumpens DC-kobling](sprinkler_power.md).
Kun vanddelen bruger `thermal.water`. Diesel/olie udsendes med uændret identitet til `liquid:deposit`,
så pools kan oprette brændbare pytter. Kilder navngives `sprinkler:<headId>`.

Simuleringen kører i faste 0,1-sekundsskridt med højst 256 hoveder som standard og højst
10 sekunders catch-up pr. kald. Kvalitet ændrer ikke forbrug eller slukning.
`step()` kan ikke kaldes igen fra en synkron sprinkler-/sprayobserver eller pumpe-callback.
Restore-forberedelse og commit afvises også midt i et fixed step; restore-notifikationer
kan ikke starte en ny step/restore. Head-ændringer og `dispose()` afvises også fra en aktiv
step/restore-callback. `capture()` er kun tilgængelig mellem steps og afvises, mens et helt
fixed step venter eller restore-notifikationer kører. Guard'en frigives også ved callback-fejl. Fixed-step-fasen
forbruges normalt før eksterne callbacks køres, så fejl efter et forsyningsudtag ikke kan få samme
faste tick til at blive afspillet og debitere tanken igen. Undtagelsen er `powered(headId)`, som
skal være en ren boolesk gate: hvis den kaster før tick-state ændres, bevares hele fasen til retry.
`powerFraction(requests,dt)` kan fremrykke et eksternt elnet; dens fejl forbruger fasen, selv om
sprinklerhovederne endnu ikke er ændret. Host-callbacks bør validere input og undgå skjulte
sideeffekter i booleske gates. Fejl fra tick-events gemmes, til alle
spray-/depositions-events for fixed steppet er sendt, hvorefter den første fejl kastes.
Hvis et catch-up-kald afbrydes, mens hele fixed steps stadig venter, afvises checkpoint
capture indtil værten fortsætter med `step(0)` eller næste frame-delta og tømmer de ventende
steps. Det holder gemte `pending` under ét fast step, som restore-kontrakten kræver.
Sensoren nærmer sig rummets/de nærliggende varme objekters temperatur eksponentielt. Modellen
simulerer ikke luftstrøm, hydraulisk tryk eller separate temperaturlag ved loftet.
Vandets køleeffekt fordeles ligeligt mellem objekter i samme rum under hovedet og inden for rækkevidden.
Pool-targets køles kun gennem væskedepositionen, så samme vanddosis ikke anvendes to gange. Væskeandelen
for hvert pool-target tilføres direkte til den eksisterende pyt; andele for øvrige targets danner fortsat
en gulvpyt under hovedet. Dermed behøver en pyt ikke ligge inden for gulvdepositionens merge-radius for at
blive ramt af sprinkleren. Overfladevædning og pyt bruger samme spray som gameplay-effekt; det er derfor
ikke en detaljeret massemodel for vand bundet til materialer og afløb.
Pytterne bevares nu som hvilende logiske poster uden for det aktive termiske budget; se [pool_budget.md](pool_budget.md).

## Endeligt batteri

`extensions/electricity/storage.js` eksporterer `createEnergyStore` med endelig energi i Wh,
`state`, `draw`, `charge`, `setEnabled`, `capture` og `prepareRestore`.
`supplyWatts(watts,seconds)` returnerer leverede joule. Batteriet er en adapter til bil/pumpe;
Dette standalone-store behøver ikke et helt DC-net. `electricity` understøtter nu også endelige batterier i
selve nettet og en tilsvarende `batteryAdapter`; se [electricity_system.md](electricity_system.md).

## Demo, gemninger og kontrol

Brandstationen har to synlige hoveder, fælles 3-litertank, påfyldning med vand/diesel/olie,
ventil, hovedudskiftning og visning af temperatur/flow. Starttanken er tom, og ventilen er lukket.
Spray tegnes med begrænsede linjer frem for fysisk simulerede dråber.
Forsyning og sprinkler er separate checkpoint-providers; volumen, temperatur, udløsning og
fixed-step-fase gemmes sammen med branden. Ældre filer uden disse providers afvises før ændring
af scenen, fordi de ikke beskriver hele den nuværende station.

Verifikation: 12 nye kerne-/adaptertests, 182/182 samlet GameSystems-suite, produktionsbuild,
8/8 sprinkler-browserchecks, 13/13 brand-browserchecks og 8/8 checkpoint-browserchecks består.
Browserrapport og screenshot: `webxr-demo/test-results/sprinklers`. Headset-performance er ikke målt.
