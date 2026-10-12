# Strømnet, batterier og strømskab

`extensions/electricity` er en engine-uafhængig, selvstændig DC-net-extension.
`source`, `battery`, `wire`, `switch`, `fuse` og `load` forbinder terminaler `a` og `b`.
Ledninger, afbrydere, sikringer og belastninger har modstand; batterier har også intern modstand.
Modellen er beregnet til gameplay med begrænset regnearbejde, ikke dimensionering af virkelige installationer.

```js
const net = createElectricitySystem();
net.add('battery', { kind: 'battery', a: 'positive', b: 'ground', voltage: 12,
  capacityWh: 600, energyWh: 400, resistance: .08 });
net.add('fuse', { kind: 'fuse', a: 'positive', b: 'bus', resistance: .02, rating: 5 });
net.add('lamp', { a: 'bus', b: 'ground', resistance: 12 });
const interval = net.step(1 / 60);
console.log(net.state('lamp').volts, interval.energyJ.lamp);
```

## API og energimodel

API: `add`, `state`, `all`, `configure`, `setEnabled`, `replaceFuse`, `remove`, `evaluate`, `step`,
`charge`, `draw`, `batteryAdapter`, `capture`, `prepareRestore`, `restore`, `setQuality`, `dispose`.
`configure` validerer alle ændringer før commit; terminaler/kind/kapacitet ændres ikke med denne metode.
`charge`/`draw` arbejder i Wh og klamper til faktisk plads/energi. `batteryAdapter(id)` giver en
udskiftelig `state/draw/charge`-adapter til bilen eller andre systemer.
Når et batteri er deaktiveret (`enabled=false`), returnerer både `draw` og `charge` nul;
energi, kapacitet og energi-ledger bevares. Det gælder også `batteryAdapter` og den
selvstændige `createEnergyStore`. Genaktivering fortsætter fra den bevarede energi.

Batteriets `voltage` er den nominelle elektromotoriske spænding; `volts` er terminalspændingen under last.
`power` er terminaleffekt med fortegn: negativ betyder leveret strøm, positiv betyder absorberet strøm.
`step(dt).energyJ` integrerer hver komponents terminaleffekt i joule med samme fortegn.
Batteriets kemi-ledger bruger nominelt voltage × strøm; forskellen til terminaleffekten er tab i intern modstand.
Ledgeren følger initialWh + chargedWh − suppliedWh = energyWh.

Et tomt, aktiveret batteri kan ikke drive strøm, men kan genoplades fra en tilsluttet kilde med højere spænding.
Et fuldt batteri tager ikke mere ladning ind, men kan stadig levere strøm til belastninger.
Begrænsningerne afgøres før sikringer trips, så hypotetisk strøm fra et tomt batteri ikke springer en sikring.
Ved flere spændingsniveauer fjernes udtømte drivende kilder før det afgøres, om et fuldt batteri faktisk lades.

Intervallet deles ved batteriernes tom/fuld-grænser. Belastningen modtager kun energien frem til grænsen;
resten af intervallet løses igen med de tilbageværende kilder. Der køres ikke tusindvis af faste mikrotrin.
Sikringer tripper straks over deres rating og forbliver sprunget indtil udskiftning. Ingen lysbue/varmetid simuleres.
Ledningsbrud simuleres med `enabled=false`; tilbagekobling følger den aktuelle topologi.

Standardbudget: højst 256 komponenter, 128 terminaler og 10 sekunders update.
Lineære matricer løses kun, når net/kildegrænser ændres. Kvalitet ændrer ikke det logiske net eller energi.
Uforenelige ideelle kilder giver en eksplicit fault med endelige nulværdier i det berørte net.
Modellen simulerer ikke AC, batterialdring, temperaturafhængig kemi, kapacitans, induktans eller trykte kredsløb.

Synkrone observers kan læse `state()`/`all()` under solve- og energihændelser, men kan ikke starte
et nyt solve/step, ændre komponenter eller committe restore midt i operationen. Capture er også
begrænset til mellemrummet mellem operationer, så checkpoint ikke kan indeholde en halv solver-
iteration. Guard'en frigives ved fejl, hvorefter netværket kan evalueres eller ændres normalt igen.
`electricity:energy` udsendes som en kopi af resultatet; observere kan gemme eller ændre eventet
uden at ændre den autoritative receipt, som `step()` returnerer.
Hvis en observer kaster under `evaluate()`, færdiggør solver'en alle hændelser og rejs derefter den første
observerfejl. Under `step()` bliver også batteri- og belastningsregnskabet for hele intervallet færdig,
før solve- eller energikvitteringsfejlen kastes videre; ingen løst last får gratis simulationstid.

## Checkpoint og integration

Checkpoint bevarer komponentparametre, afbrydere, sprunget sikring og batteriernes endelige energi/ledger.
Topologi og ledger valideres før live net erstattes. Commit beregner voltages stille før observers kører.
De eksisterende autonome Wh-stores i `electricity/storage.js` kan fortsat bruges, når et helt net ikke behøves.
Bilen er testet med `batteryAdapter`: starter og netbelastning debiterer samme batteri, og tomt batteri hindrer start.

`webxr-demo/security.html` har et synligt skab med åbnelig låge, batteri, afbryder, sikring og kabler.
Kamera og skærm drives af det faktiske net. UI kan tage ledningen ud, afbryde strøm, skabe/fjerne en
abstrakt kortslutning og skifte sikringen. Fejlen er en ekstra modstandsbelastning i spillet.
Det lille 2 Wh-batteri og 20× tid gør tømning hurtig at afprøve.
Net, kameraer og applikation gemmes samlet som `security-station-v2`; den tidligere demo-providerstruktur afvises.

Verifikation: 13 nye kerne-/integrationschecks og 15/15 kamera-/strømskab-browserchecks består.
Den eksisterende værkstedsdemo består stadig 12/12 browserchecks. Screenshot/rapport: `webxr-demo/test-results/cameras`.
Headset-performance er ikke målt. Branddemoens sprinklerpumpe er nu koblet på et tilsvarende net og anvender
intervallets faktiske energi til væskeflow; se [sprinkler_power.md](sprinkler_power.md).
