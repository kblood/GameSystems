# Bilens brændstofport og brændbare pytter

Reproduceret fejl: bilens supply-tank havde `petrol`, men de samme 20 ml blev gemt som `unknown` i pools
og kunne ikke antændes. Pools har nu en petrol-preset, så identitet, fuel energy og source-provenance bevares.
Værdierne er game-tuning og ikke specifikationer for virkeligt brændstof.

## API og ejerskab

`vehicles.withdrawFuel(id,liters)` trækker fra den aktuelt tilsluttede fuel-adapter og returnerer faktisk volumen.
`spilledL` tæller dette særskilt fra motorens `consumedL`. En kørende motor stopper straks, når dens afhængige
kilde tømmes. Explicit spild udtager stadig faktisk væske, når motorens forbrug er deaktiveret.

`createVehicleFuelPort(vehicles,id)` giver flow-systemet et supply-kompatibelt `state`/`draw`-interface.
Det omsætter liter til ml og følger adapter-skift uden en ekstra kopi af reserverne. Porten udtager den væske,
som adapteren eksponerer som brugbart brændstof: en petrol-filteradapter lader fx tankens uvedkommende vand blive.
En direkte supply-emitter kan bruges, når applikationen vil spilde hele tankens blanding.

```js
const port = createVehicleFuelPort(cars, 'player');
const flow = createFlowSystem({ supply: port, emit: onDeposit });
flow.add('leak', { tankId: 'player', sourceKey: 'vehicle:player:fuel', rateMlPerSecond: 20, target: floorTarget });
flow.pulse('leak', 100);
```

Petrol/diesel følger samme pool-/thermal-API. Ukendte væsker får ikke opfundet brændstofenergi eller vandkøling.
Forbrænding flytter remaining til burned. Opsamling tæller som removed og fylder ikke bilen op igen.

## Demo og checkpoint

Vehicle Lab har Spill 100 ml, kontinuerlig leak-valve, Ignite spill og Collect spill.
FuelFlap-node i den aktuelle GLB giver en visuel kildeposition, projiceret til gulvet. Labben er stadig en stationær
drivetrain-bench. Pytter/flammer har separate instanced budgets: 16 pools og 48 cones.
Kun gulvspildet er termisk modelleret her; karosseri-/interiørbrand, damp og eksplosionsfysik er ikke implementeret.

Vehicle-scene-provider kan komponere thermal, pools og fuelFlow. En fælles thermal/pool-plan stages først;
bilens kommende spilledL validerer kvitteringen, og bevaret pool-provenance må ikke overstige faktisk emission.
Ventil, brand, forbrug, adapterbinding og reserver gemmes samlet. Ældre scenefiler uden den nye verdensdel afvises atomisk.

6 nye integrationschecks og 305/305 samlet GameSystems-tests består. 8/8 nye browserchecks dækker native spild,
antændelse/opsamling, faktisk instanced fire, whole-scene restore, adapter-skift, leak, forkert kvittering og balance.
Den tidligere vehicle-checkpoint-kontrol består 7/7. Rapport/screenshot: `webxr-demo/test-results/vehicle-spill`.
Fysisk headset er ikke afprøvet.
