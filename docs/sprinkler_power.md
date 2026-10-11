# Sprinklerpumpe på strømnettet

`extensions/sprinklers/power.js` forbinder sprinklerens væskebehov med et almindeligt resistivt DC-net.
Sprinklerkernen fungerer fortsat uden strøm-afhængighed; en simpel boolesk `powered(headId)` kan også bruges.
Den nye `powerFraction(requests,dt)` callback giver en kvittering for faktisk leveret energi i et fixed step.

```js
const pump = createNetworkPump({ network, loadId: 'pump', ratedW: 36 });
const sprinklers = createSprinklerSystem({ supply, thermal, powerFraction: pump.powerFraction });
// pump advances network inside each 0.1 s sprinkler tick.
// Register network and pump separately with the checkpoint coordinator.
```

Adapteren **ejer fremrykning af dette net**. Det samme net må ikke samtidig få `step(dt)` fra hostens
electricity-update eller en anden simulation-loop, da energien ellers debiteres to gange.
Andre belastninger i nettet fremrykkes af pumpens net-step, også når sprinklerens tank er tom.
Adapteren disponerer ikke net eller tank ved dispose; ejerne rydder deres egne ressourcer.

## Flow og energiforbrug

Sprinkleren fordeler en næsten tom tanks væske proportionalt mellem hovederne før power-forespørgslen.
Requests har `id`, `tankId`, tilgængelig `ml` og det normale trins `nominalMl`.
Power-fraktionen skal være endelig og mellem 0 og 1 og valideres, før væsken trækkes ud.

Pumpens nødvendige arbejde skaleres med tilgængelig væske i forhold til det nominelle flow.
Den aflæser lastens løste terminaleffekt og vælger en driftstid, der højst fylder det aktuelle sprinklertrin.
Netværkets `step` returnerer den faktisk leverede terminalenergi, inklusive et batteri, der tømmes midt i intervallet.
Resten af intervallet fremrykkes med pumpelasten afbrudt, så andre belastninger stadig får korrekt simulationstid.
Kvitteringens leverede/nødvendige energi skalerer den afsatte væske.

Det løser to konkrete fejl: en slutspænding på nul mister ikke den energi, der allerede blev leveret tidligere
i trinnet; en næsten tom tank skaber heller ikke en lang hale af væskerester, der bruger fuld pumpeeffekt.
En tom tank eller alle lukkede hoveder giver ingen drift eller forbrug i pumpelasten.

Dette er en fælles gameplay-pumpe, ikke en hydraulisk tryk-/rørsimulator. Flow fordeles af sprinklerens egne
rate- og tankregler. Driftstiden beregnes fra starten af hvert 0,1-sekundstrin; ændringer i netspænding under
trinnet kan give en begrænset afvigelse i arbejdet, mens væsketrækket altid begrænses af den faktiske tank.

## State og brandstation

API: `powerFraction`, `state`, `capture`, `prepareRestore`, `restore`, `dispose`.
State omfatter last-id, ratedW, kumuleret terminalenergi, seneste leverede/nødvendige energi,
fraktion, trintid og væskebehov. Snapshot validerer konfiguration, endelige værdier og energifraktion før commit.

Brandstationen har en 12 V/1 Wh-batterikilde, afbryder, ledning, 5 A-sikring og pumpe-last.
UI viser batteri, watt, volt og sikring og kan afbryde/tilslutte, lave/fjerne en abstrakt fejl, skifte sikring og oplade.
En lille synlig pumpe skifter farve ved drift eller sprunget sikring. Vand/diesel/olie beholder deres væskeidentitet.
Checkpoint registrerer nu `electricity` og `pump` sammen med `fire`, `supply` og `sprinklers`.
Ældre station-snapshots uden alle providers afvises før live tilstand ændres.

Verifikation: 9 nye kerne-/integrationschecks, 237/237 samlet GameSystems-tests og produktionsbuild består.
15/15 sprinkler-/pumpe-browserchecks dækker reelt flow, slukning, væskeidentitet, ledning, afbryder, sikring,
reparation, fladt batteri, opladning, pause og helt checkpoint. Den eksisterende checkpoint-browserkontrol har 8/8 bestået.
Screenshot/rapport: `webxr-demo/test-results/sprinklers`. Headset-performance er ikke målt.
