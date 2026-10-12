# Vehicle system and Aster sedan

`extensions/vehicle` provides an engine-independent vehicle gameplay core and an optional Three.js visual binding. It needs no physics engine, liquid system, electricity network, DOM, renderer, or scene globals. The host wrapper registers it as `vehicle` and advances `step(dt)`.

The included original Aster sedan is modeled in Blender, in meters, with a cabin, saddle upholstery, four seats plus rear center cushion, seat belts, steering wheel, gauges, center display, door cards, mirrors, pedals, engine bay, battery, luggage well, wheels, brake rotors and calipers. Metallic paint uses clearcoat; glass uses transmission; rubber, leather, carpet and metal have separate PBR materials. The Blender source also has a procedural microflake bump; this fine procedural detail is not baked into glTF.

## Files and rebuilding

| File | Purpose |
| --- | --- |
| `scripts/car_aster.py` | Deterministic original Blender generator, including studio and cameras |
| `src/vehicles/aster_sedan.blend` | Editable individual components and non-destructive modifiers, closed at frame 1 |
| `export/vehicles/aster_sedan.glb` | Material-merged runtime asset with all opening animations |
| `export/vehicles/aster_sedan_low.glb` | Lower-triangle runtime variant with the same nodes and animations |
| `export/vehicles/aster_sedan.vehicle.json` | Units, axes, pivot positions, angles and resource defaults |
| `tests/out/vehicle/aster_{closed,open,rear_open}.png` | Cycles render QA, regenerated and gitignored |
| `webxr-demo/vehicle.html` | Interactive inspection and drivetrain bench |

From `GameSystems` in PowerShell:

```powershell
& C:\tools\Blender\blender.exe --factory-startup -b --python scripts/car_aster.py
# Add -- --no-render to export without regenerating preview images.
cd webxr-demo
npm run sync
npm run dev
# Open /vehicle.html
node --test tests/vehicle.test.js
node scripts/vehicle-smoke.mjs --dev
# After npm run build, omit --dev to test the production site.
```

The generator saves the editable `.blend` before joining geometry. The runtime exporter combines geometry by material within each rigid part; it preserves every hinge and wheel transform. High and low both have seven named `Open_<node>` clips (frame 1 closed, frame 31 open). Do not play an opening clip and directly drive the same hinge simultaneously.

Blender uses +Z up and -Y forward. Both GLBs and the metadata use +Y up and +Z forward. The vehicle root is on the ground at its center. Wheels are at 2.82 m wheelbase, with 0.34 m radius. The model is an original design and includes no external meshes, logos or textures.

## Public core

```js
import vehicle, { createVehicleSystem } from './extensions/vehicle/index.js';

// Direct standalone use; default tanks are finite and owned by this car.
const cars = createVehicleSystem({ emit: (type, detail) => {} });
cars.add('player');
cars.start('player'); // { started: true }, or { started: false, reason }
cars.setControls('player', { throttle: 0.5, brake: 0, steer: 0.2, gear: 1, handbrake: false });
cars.step(1 / 60);
const state = cars.state('player');

// Or through the common extension host:
const hostedCars = await host.load(vehicle);
```

Methods: `add`, `state`, `start`, `stop`, `setControls`, `setLights`, `setPart`, `setLocked`, `refuel`, `charge`, `setAdapters`, `setModes`, `step`, `remove`, `setQuality`, `dispose`. Controls use throttle/brake [0, 1], steer [-1, 1], gear -1/0/1 and a boolean parking brake. State is copied, including arrays, part state and resource snapshots. Returned snapshots cannot mutate the simulation.

Fuel and battery are finite by default: 28/52 L petrol and 540/720 Wh at 12.6 V. Starting needs compatible fuel and 0.35 Wh at at least 10.8 V. A running engine consumes an authored idle/throttle fuel rate and drives a 700 W alternator. Lighting and accessory loads drain the battery with the engine off. The alternator supplies running loads first, then charges the battery. Energy and fuel counters report actual transferred amounts. These are tunable gameplay rates, not measured data for a commercial vehicle.

Fuel exhaustion stops the engine and emits `vehicle:stopped`. Start failures distinguish empty or wrong fuel from insufficient starting power. Refueling returns accepted liters and requires a stationary vehicle, engine off, fuel flap at least 80% open, and compatible fuel. A closed or locked panel cannot be opened by refueling. Opening other panels above 0.5 m/s is rejected. Events also include `vehicle:started`, `vehicle:part`, and `vehicle:refueled`.

## Swappable resources

Adapters are synchronous, public-API objects. Each request returns the actual accepted or supplied quantity, from zero to the requested amount. Invalid negative, non-finite or over-reported transfers throw. Adapters must declare `reversible: true`: the `refill`/`charge` operation must be able to return an immediately preceding `consume`/`draw` when the other resource shortens the engine interval, while the store remains enabled and the released capacity remains available. This lets the vehicle settle fuel and power without burning fuel for an interval its power source could not support. Replacing an adapter does not copy, drain, dispose or reset either store.

The shared supply fuel adapter keeps normal direct transfers synchronous. During a vehicle resource settlement it opens a supply batch, applies fuel use, power draw, and any compensating refund without callbacks, then publishes the settled tank state with `flush()`. This prevents observers from filling freed capacity between draw and refund. Vehicle stepping closes the batch even if an adapter throws; public refuel/spill calls remain immediately observable.

```js
// Fuel adapter: liters
const fuel = {
  reversible: true,
  state: () => ({ amountL, capacityL, kind: 'petrol' }),
  consume: liters => actualLitersConsumed,
  refill: (liters, kind) => actualLitersAccepted,
};
// Power adapter: watt-hours
const power = {
  reversible: true,
  state: () => ({ energyWh, capacityWh, voltage, enabled: true }),
  draw: wh => actualWhSupplied,
  charge: wh => actualWhAccepted,
};
cars.setAdapters('player', { fuel, power });
```

Use the shared systems without importing their internals:

```js
import { createSupplySystem, createFuelAdapter } from './extensions/supply/index.js';
import { createEnergyStore } from './extensions/electricity/storage.js';

const supply = createSupplySystem();
supply.add('tank', { capacityMl: 52000, components: { petrol: 28000 } });
cars.add('shared-car', {
  fuel: createFuelAdapter(supply, 'tank', { kind: 'petrol' }),
  power: createEnergyStore({ capacityWh: 720, energyWh: 540, voltage: 12.6 }),
});
```

The supply adapter converts L to mL and consumes only the specified fuel component. Wrong liquids still occupy tank capacity. A custom fuel system may implement stricter contamination rules behind the same interface.

`createFuelStore` and `createBatteryStore` are the small standalone fallbacks. Disable one or both requirements explicitly with `setModes(id, { fuel: 'disabled', power: 'disabled' })`; resource values then remain unchanged. Re-enable with `'adapter'`. No silent infinite reserve is introduced when an adapter empties or is disconnected.

Disabling the battery itself (`setEnabled(false)`, or `set_enabled(false)` in Godot) rejects both draw and charge, including manual and alternator charge, without changing its energy or capacity. Shared electricity stores and network battery adapters follow the same rule; their charge/supply ledgers also remain unchanged. Re-enabling the battery restores transfers from the preserved state. This differs from disabling a vehicle's power requirement: a disabled battery cannot satisfy the normal starter gate.

During `step`, vehicle event callback errors are saved while all vehicles finish resource and motion updates; the first error is rethrown after the batch and the reentrancy guard is cleared. Direct `stop()` calls keep their normal synchronous notification behavior.

## Rendering and physical parts

```js
import * as THREE from 'three';
import { bindVehicleVisual } from './extensions/vehicle/visuals.js';

const binding = bindVehicleVisual(gltf.scene, { THREE });
cars.setPart('player', 'hood', 1); // normalized open fraction, smoothed by step
binding.update(cars.state('player')); // panel transforms, wheel spin, steering, lamps
// Optional simple kinematic motion:
binding.update(cars.state('player'), { moveRoot: true });
binding.dispose();
```

| Part id | glTF pivot node | Axis | Open angle |
| --- | --- | --- | --- |
| `door_fl`, `door_rl` | `Door_FL`, `Door_RL` | +Y | +1.18 rad |
| `door_fr`, `door_rr` | `Door_FR`, `Door_RR` | +Y | -1.18 rad |
| `hood` | `Hood` | +X | -1.10 rad |
| `trunk` | `Trunk` | +X | +1.18 rad |
| `fuel_flap` | `FuelFlap` | +Y | -1.40 rad |

Four `Steer_<FL/FR/RL/RR>` nodes contain corresponding `Wheel_*` spin pivots. Front steering rotates around +Y; rolling rotates around +X. Brake calipers remain on the steering carriers. Every render update derives rotation from the saved rest transform, avoiding accumulated errors. A strict bind rejects a model missing a required panel node.

The lab offers high PBR transmission/shadows and a lower-cost geometry variant with alpha glass and shadows disabled. Quality switches reload only the visual asset; vehicle and adapter state remain alive. The high mesh is suited to close inspection. Browser smoke reports actual draw calls and rendered triangles for both modes in `webxr-demo/test-results/vehicle/report.json`.

The delivered high model is 237,307 triangles / 5.59 MB; low is 79,803 triangles / 2.35 MB. Each has 76 material groups and 92 nodes. Desktop browser QA measured 156 draw calls / 475,386 rendered triangles for high and 83 / 80,261 for low, including the scene and additional render passes. Those are workload counts, not a headset frame-rate measurement.

## Scope and validation

Fuel export now uses `withdrawFuel(id,liters)` and `createVehicleFuelPort` for finite spills/leaks from the active adapter.
The lab demonstrates source-preserving petrol pools and thermal fire with a combined checkpoint; see [vehicle_fuel_spill.md](vehicle_fuel_spill.md).

Panel locks now freeze in-progress motion and pending opening targets pause while travelling.
The longitudinal/bicycle integration now uses bounded RK4 and analytic stop/cap handling. Fuel/power exhaustion
limits engine contribution to the supported interval. Details and measured timestep checks: [vehicle_motion.md](vehicle_motion.md).

The drivetrain uses a lightweight longitudinal/bicycle motion model. It does not provide suspension, terrain contacts, collision bodies, tire slip, deformable bodywork, a transmission model or a rigid-body driving simulator. A host can consume the state and controls to integrate its own physics. Use frame-sized `step(dt)` calls for motion; the lab caps each visual frame to 0.1 s and demonstrates the drivetrain on a stationary platform.
The bicycle model requires a wheelbase of at least 0.1 m. Smaller values make the steering curvature singular or physically meaningless and are rejected when adding a vehicle.

The source geometry, PBR exports, all seven pivots, opening clips, supply/power integration, resource conservation, start gates, locking, refueling access and state isolation are covered by focused tests. Browser smoke operates the actual lab controls, verifies opening transforms, drives the wheels, refuels through the real supply adapter, swaps resource modes and changes mesh quality. Cycles views are inspected separately. No headset performance or tracked-hand interaction claim is made by the desktop lab.

The vehicle core now provides checkpoint capture/prepareRestore/restore with native stores or named external bindings.
The lab persists every registered source, driving state and panel animation, including browser storage and portable files.
See [vehicle_checkpoint.md](vehicle_checkpoint.md) for ownership, validation and input-neutralization contracts.
