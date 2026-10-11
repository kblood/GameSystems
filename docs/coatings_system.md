# Doseret skum og overfladedækning

`extensions/coatings` er et selvstændigt, engine-uafhængigt system på thermal/pools' public API.
Det omsætter skum fra flow eller sprinkler til overfladedækning. Coverage ligger i thermal/pools' eksisterende
`blanket`; der oprettes ikke en anden konkurrerende blanket-store.

```js
const coats = await host.load(coatingsExtension);
coats.add('chair', { areaM2: 1.155, normal: [0,1,0], heightM: .32 });
coats.apply('chair', 20, { normal: [0,1,0], jetDirection: [0,-1,0] });
```

API: `add`, `state`, `apply`, `deposited`, `step`, `capture`, `prepareRestore`, `restore`, `setQuality`, `dispose`.
`coatings:applied` beskriver en dosis; `coatings:changed` giver den aktuelle coverage ved ændring eller nedbrydning.
Pool-dilution og frisk skum offentliggør én endelig ændring per deposition.

## Gameplay-model

Normaldosis er 80 ml pr. m² for fuld dækning. Små flader dækkes mere af samme dosis end store.
Retentionsfaktoren er 1 på en opadvendt flade, 0,5 på en lodret flade og 0,1 på en underside,
ganget med strålens indfaldsvinkel. En stråle parallelt med den valgte flade tilfører ingen dækning.
Dette er tunable spilparametre, ikke en fysisk formulering eller et tryknet.

Den eksisterende thermal-model dæmper brandintensitet med coverage og slukker ved mindst 95% blanket.
Skum alene opfinder ikke en vandkøleeffekt. Dækning bliver gradvist mindre; lodrette flader og større højde
giver mere afløb, og varme øger nedbrydningen. Hvis brændstoffet stadig er varmt, kan thermal senere genantænde det.
Default-decay er langsom og kan konfigureres. Quality ændrer ikke logisk dosering eller dækning.

Statisk geometry metadata har default-loft på 256 profiler. Pool-areal afledes af dens radius, med en lille
minimumsflade; kun aktive, dækkede pools får løbende nedbrydning. Hvilende coverage bevares ligesom øvrig latent state.
Geometrien er én effektiv flade pr. objekt, ikke et per-triangle lag eller simulation af bobler og materialefilm.

## Væske og integration

`foam` er nu en ikke-brændbar pool-komponent. `pools:deposited` angiver tilført komponentmængde og tidligere
volumen/coverage. Når en pyt vokser, spredes dens eksisterende blanket over større areal; den nye skumdosis tilføjes bagefter.
Opsamling, kilde-provenance og volumen bruger fortsat pools/supply/flow-ledgerne.

Flow mod registrerede objekter giver skumcoverage fra hit-normal og stråleretning. Gulv-/pool-deposition får
coverage gennem den faktisk modtagende pyt. En skumfyldt sprinkler fordeler coverage-andelen på de ramte
objekters topflader. Fluidandelen for eksisterende pool-targets deponeres direkte i de pågældende pytter;
resten sendes til gulvet. Hver pyt får dermed sin væske og coating gennem én deposition uden dobbelt dosis.

Ligesom vandkøling plus gulvpyt er dette en gameplay-effekt og en projektion: overfladedækningen er ikke en
anden beholdning af fysisk skumvolumen. Faktisk væskemængde tælles én gang hos supply/flow/pools.

## Brandstation og gemninger

Slangen har nu vand- og skumtilstand med henholdsvis 1,2- og 0,6-litertank. UI kan vælge 20/75/150 ml skumdosis,
holde et kontinuerligt skumflow, genopfylde og vælge skum til den strømforsynede sprinkler.
Medieskift rydder holdte input. XR-knapperne VAND/SKUM vælger medie; direkte aim bruger aktuelle hit-normaler.
Overflader og pytter tones lyst efter coverage, og readout viser lager og dækning.

Fire-scene-provider validerer coatings' authored geometry mod den kommende thermal-plan. Coverage, kilder,
forbrugt volumen, medie, dosisvalg og visning gemmes sammen med øvrig brandtilstand. Ældre station-topologier
uden de nye tanke/profiler afvises før live state ændres.

## Kontrol

12 nye kerne-/integrationschecks og 280/280 samlet GameSystems-tests består. Produktionsbuild består.
12/12 nye browserchecks dækker delvis/større dosis, faktisk slukning, synlig coverage, fluid-identitet, hold, medieskift,
refill, checkpoint, forkert geometry, quality, source-balance og den skumfyldte powered sprinkler.
De tidligere flow-/brand-/checkpointchecks består også (17, 13 og 8).
Rapport/screenshot: `webxr-demo/test-results/coatings`. Fysisk headset er ikke afprøvet.
