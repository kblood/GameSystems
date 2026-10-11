# Bilens checkpoint og ressourcer

Vehicle-systemet har nu `capture`, `prepareRestore` og `restore`. Snapshot bevarer position, heading,
hastighed, kørt distance, hjulvinkel, motor/rpm, lys, resource modes, alle syv panelers fraction/target/lock
og forbrugstællere. Gear og parkeringsbremse bevares; speeder, styreinput og momentant bremseinput neutraliseres.
De fortsatte panel-targets kan animere videre efter load uden at gentage startmotorens energitræk.

## Ressourceejerskab

En bil oprettet med standardstores ejer selv fuel/battery. De små stores har nu deres egne
`capture`/`prepareRestore`-API'er og gendannes stille sammen med bilen. Native stores kan genbindes ved restore,
selv når bilen midlertidigt bruger registrerede eksterne kilder.

Eksterne kilder får stabile navne:

```js
cars.registerAdapters('shared', { fuel: fuelAdapter, power: powerAdapter });
cars.registerAdapters('simple', { fuel: simpleFuel, power: simpleBattery });
cars.add('player', { adapterKey: 'shared' });
cars.bindAdapters('player', 'simple');
```

Et anonymt adapter-sæt kan stadig bruges til gameplay med `setAdapters`, men checkpoint afviser det med
en konkret fejl om manglende registreret key. Der gættes ikke på kildeidentitet, og eksterne reserver omskrives
ikke gennem kunstig refuel/consume. Ejerne skal stage deres egne ressourcer og levere `resourceStates` til bilens plan:

```js
const carPlan = cars.prepareRestore(data, {
  resourceStates: {
    shared: { fuel: stagedFuelState, power: stagedPowerState },
    simple: { fuel: simpleFuelPlan.state(), power: simplePowerPlan.state() },
  },
});
```

Quantity, kapacitet, type, voltage og enabled skal stemme med det gemte adapter-view før nogen bil ændres.
Model/settings, ids, panels, typed booleans, ranges og poses valideres samlet. Planens public state-view er detached.
En senere udskiftning/fjernelse af bilinstansen afvises før commit.

## Samlet scenegemning

Tilføjelse: scenegemningen kan også komponere thermal/pools/fuelFlow, inklusive spilledL og aktiv lækageventil.
Se [vehicle_fuel_spill.md](vehicle_fuel_spill.md). De registrerede kilder validerer også faktisk afgivet brændstof.

`extensions/checkpoint/vehicle-scene.js` er en public-API-composition til demoscenen.
Den bevarer supply-tankens blanding/provenance, det fælles Wh-store, begge standalone stores og bilens navngivne binding.
Også kilder, der ikke er tilsluttet nu, gemmes. Bilens resource-view kontrolleres mod disse kommende owner-states.
Alle planer klargøres før live commit; den generelle checkpoint-koordinator håndterer rollback og observers.

Vehicle Lab har pause, gem/restore i browserlager og JSON-export/import. Mode/quality valideres sammen med bilen.
Indlæsning rydder slider-input og en ventende, gammel bremsetimer. Forældede fil-/asset-loads annulleres ved teardown.
High/low er kun rendering; begge assets har samme paneltopologi, og quality-restore kan indlæse den rette GLB.

## Begrænsninger og kontrol

Gemningen er for samme author-konfiguration og registrerede kilder. Den indlæser ikke vilkårlige bilmodeller
eller eksterne hardwarekilder. Native API'er og den konkrete scene-composition er forskellige niveauer:
en anden kildearkitektur skal stille sine egne staged resource views til rådighed.
Labben viser stadig bilen på sin platform; den logiske motion-state gemmes, mens visual binding kan bruge
`moveRoot:true` i et egentligt spil. Collision/suspension og fysiske headsetkontroller er fortsat ikke implementeret.

10 nye checkpoint-/ejerskabstests, 290/290 samlet GameSystems-tests og de eksisterende 11 vehicle-tests består. 7/7 nye browserchecks
bekræfter native kørsel/paneler, pose og visuel hinge-restore, neutral input, faktisk side-reload,
portable download/import i en ny runtime og atomisk afvisning af ukorrekte kilder.
Den eksisterende vehicle-browserkontrol består stadig 8/8. Screenshot/rapport: `webxr-demo/test-results/vehicle-checkpoint`.
