# Elektrisk varme som selvstændig adapter

`createElectricalHeatAdapter` eksporteres fra thermal/index.js. Den kobler passive
strømkomponenters faktisk leverede energi til thermal-objekter uden at eje eller
opdatere netværket. Bindings er authored og immutable under adapterens livstid.

```js
let heatBridge;
const network = createElectricitySystem({emit(type, receipt) {
  if (type === 'electricity:energy') heatBridge?.consume(receipt);
}});
// Add circuit components and thermal objects before creating the bindings.
heatBridge = createElectricalHeatAdapter({network, thermal, bindings: [
  {componentId: 'wire', thermalId: 'cable-insulation', fraction: .7},
]});
// Exactly one circuit owner calls network.step(dt), e.g. a host or pump adapter.
```

Binding-targetet kan være varmebestandigt metal eller brændbar isolering/spilmateriale.
Thermal ejer fortsat afkøling, spredning, antændelse og ild; varmeadapteren tilføjer kun joules.
Et komponent-id kan fordele energi til flere thermal-targets, med samlet fraction højst 1.
Wire/switch/fuse/load er tilladt; batterier og sources er ikke varmelaster. Batteriets
interne tab er ikke modelleret som en særskilt passiv komponent i denne adapter.

`consume({seconds,energyJ})` bruger receipt-energi, aldrig den efterfølgende instantaneous
power, som allerede kan være nul efter batteritømning. Afbrudte kredse, sprunget fuse
og udtømt batteri tilføjer derfor ingen fiktiv varme. Ugyldige receipts/bindings afvises
før varme tilføres. Fjernede targets tælles som skippedJ; de får ingen ghost-varme.
Resultatet indeholder deliveredJ/skippedJ/transfers og duplicate. Samme receipt-objekt
behandles kun én gang via WeakSet. Kopierede receipts har ingen netværksidentitet;
feed derfor kun den originale electricity:energy-event én gang, ikke også step-resultatet.

Budget: højst 64 bindings som standard. API: consume, bindings (detached), dispose.
Der er ingen egen simulation eller vedvarende energireserve. Netværket gemmer strøm/
batteri og thermal gemmer resulterende varme; ingen ny checkpoint-provider er nødvendig.
Bindings er en del af spillets authored topology, og skal genskabes ved runtime-reset.

Branddemoens pumpenetværk kobler wire-tab til metalgenstanden ved pumpen. Dårlig ledning
øger resistance fra 0,02 til 1,5 og giver mere varme samt mindre terminaleffekt til pumpen.
Den lille forsyning og metal-target betyder, at dette ikke nødvendigvis skaber en brand;
et spil vælger brændbart target og varmeegenskaber selv. UI viser ledningstab og metaltemperatur.
Strømindstilling og temperatur gemmes/gendannes med de eksisterende providers.
