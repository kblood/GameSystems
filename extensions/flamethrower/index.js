// GameSystems flamethrower extension: a handheld flamethrower weapon. The weapon simulates tank, trigger, pilot light and
// nozzle cone and reports the flame cone each frame; the game applies damage and ignition (e.g. thermal.addHeat on what
// coneExposure() says is inside). Engine-free except three-layer.js and createFlamethrower, which take THREE as a
// parameter. Visuals are optional through a fire-fx instance (extensions/fire-fx), passed in as `fx`.
// Reference: docs/flamethrower_system.md.
//
//   config.js       tunables and defaults, resolveFlamethrowerConfig / validateFlamethrowerConfig (pure)
//   tank.js         fuel tank and canister (pure)
//   trigger.js      trigger state (pure)
//   pilot.js        pilot light / ignition (pure)
//   nozzle.js       cone geometry and hit helpers: coneRadius, coneExposure, pointInCone, coneBounds (pure)
//   weapon.js       createFlamethrowerCore(config, { seed, onEvent }): the state machine (pure)
//   three-layer.js  procedural mesh, GLB adoption, nozzle aim (THREE passed in)
import { createFlamethrowerCore } from './weapon.js';
import { buildProceduralFlamethrower, adoptFlamethrowerModel, nozzleAim } from './three-layer.js';

export { DEFAULT_FLAMETHROWER_CONFIG, resolveFlamethrowerConfig, validateFlamethrowerConfig } from './config.js';
export { createFuelTank, createCanister } from './tank.js';
export { createTrigger } from './trigger.js';
export { createPilotLight } from './pilot.js';
export { makeCone, coneRadius, coneRadiusAt, coneExposure, pointInCone, coneBounds } from './nozzle.js';
export { createFlamethrowerCore, FLAMETHROWER_EVENTS } from './weapon.js';
export { buildProceduralFlamethrower, adoptFlamethrowerModel, nozzleAim } from './three-layer.js';

let instances = 0;
const UP = Object.freeze([0, 1, 0]);

/**
 * Creates a flamethrower.
 *
 * @param {object}  options
 * @param {object}  options.THREE          the three.js namespace
 * @param {object}  [options.scene]        if given and `parent` is not, the weapon object is added here
 * @param {object}  [options.parent]       Object3D to attach the weapon to (a controller grip); wins over scene
 * @param {object}  [options.fx]           a fire-fx instance (createFireFX); null: no flame visuals (mesh and pilot glow only)
 * @param {number|{capacityMl:number, fuelMl?:number}} [options.tank]  tank capacity in ml, or capacity and start fuel
 * @param {number}  [options.range]        flame length in m at full pressure (config nozzle.range, default 5)
 * @param {number}  [options.spreadDeg]    full cone angle in degrees (nozzle.spreadDeg, default 16)
 * @param {number}  [options.flowMlPerSecond]  fuel use while the valve is open (nozzle.flowMlPerSecond, default 150)
 * @param {boolean} [options.backfire]     enable the empty-tank backfire hazard (backfire.enabled, default false)
 * @param {object}  [options.model]        a GLB scene (gltf.scene) to use instead of the procedural mesh
 * @param {object}  [options.config]       a full config layer (resolveFlamethrowerConfig); the shorthands above win
 * @param {number}  [options.seed]         seed for sputter and backfire rolls
 * @param {(type:string, detail:object)=>void} [options.onEvent]  'ignite' | 'extinguish' | 'empty' | 'dry-fire' | 'refuel' |
 *                                         'pilot-lit' | 'pilot-out' | 'backfire' ({ origin, radius, time }: the game hurts the player)
 * @param {string}  [options.id]           prefix of the fire-fx flame ids (default flamethrower<n>)
 * @returns {{ object, mountPoint, nozzle, core, setTrigger(on:boolean):boolean, refuel(ml:number):number,
 *   update(dt:number, aim?:{origin, direction}):object, flameCone():object, state():object, douse():boolean,
 *   relight():boolean, dispose():void }}
 *   update() without aim fires along the nozzle's -Z in world space. flameCone() / update() return the same cone
 *   object every frame: { origin:[3], direction:[3], length, radius, baseRadius, dt, active, intensity }.
 */
export function createFlamethrower({ THREE, scene = null, parent = null, fx = null, tank, range, spreadDeg, flowMlPerSecond, backfire,
  model = null, config = {}, seed, onEvent = null, id } = {}) {
  if (!THREE?.Object3D) throw new TypeError('createFlamethrower needs THREE');
  const layer = { nozzle: {}, tank: {}, backfire: {} };
  if (typeof tank === 'number') layer.tank.capacityMl = tank;
  else if (tank && typeof tank === 'object') { if (tank.capacityMl !== undefined) layer.tank.capacityMl = tank.capacityMl; if (tank.fuelMl !== undefined) layer.tank.startMl = tank.fuelMl; }
  if (range !== undefined) layer.nozzle.range = range;
  if (spreadDeg !== undefined) layer.nozzle.spreadDeg = spreadDeg;
  if (flowMlPerSecond !== undefined) layer.nozzle.flowMlPerSecond = flowMlPerSecond;
  if (backfire !== undefined) layer.backfire.enabled = !!backfire;
  const core = createFlamethrowerCore([config, layer].reduce(mergeLayer, {}), { seed, onEvent });
  const cfg = core.config;

  const built = model ? adoptFlamethrowerModel(THREE, model) : buildProceduralFlamethrower(THREE);
  const { object, mountPoint, nozzle, pilot } = built;
  const host = parent ?? scene;
  host?.add(object);

  const prefix = id ?? `flamethrower${++instances}`, pilotId = `${prefix}:pilot`;
  const aim = { origin: [0, 0, 0], direction: [0, 0, -1] }, tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const puffOpts = { kind: 'puff', speed: 0, spread: 0, life: 0.5, size: 0.06 };
  const pilotPos = [0, 0, 0];
  let pilotShown = false, puffAcc = 0, disposed = false;

  function syncPilot(lit) {
    if (pilot) pilot.visible = lit;
    if (!fx) return;
    if (lit) {
      pilotPos[0] = aim.origin[0]; pilotPos[1] = aim.origin[1] - 0.01; pilotPos[2] = aim.origin[2];
      if (!pilotShown) pilotShown = fx.addFlame({ id: pilotId, position: pilotPos, normal: UP, size: cfg.visual.pilotSize, intensity: 0.7 });
      else fx.moveFlame(pilotId, pilotPos);
    } else if (pilotShown) { fx.removeFlame(pilotId); pilotShown = false; }
  }

  return {
    object, mountPoint, nozzle, core,
    setTrigger(on) { return core.setTrigger(on); },
    refuel(ml) { return core.refuel(ml); },
    douse() { return core.douse(); },
    relight() { return core.relight(); },
    update(dt, aimIn) {
      if (disposed) return core.flameCone();
      if (aimIn) {
        const o = aimIn.origin, d = aimIn.direction;
        aim.origin[0] = o[0] ?? o.x; aim.origin[1] = o[1] ?? o.y; aim.origin[2] = o[2] ?? o.z;
        aim.direction[0] = d[0] ?? d.x; aim.direction[1] = d[1] ?? d.y; aim.direction[2] = d[2] ?? d.z;
      } else nozzleAim(nozzle, aim, tmpV, tmpQ);
      const cone = core.update(dt, aim);
      syncPilot(core.pilot.lit);
      if (fx && cone.active) {
        // Flame stream: puffs that fly the cone length in their lifetime and spread to the cone's radius.
        puffAcc += cfg.visual.sparksPerSecond * cone.intensity * cone.dt;
        const count = Math.floor(puffAcc);
        if (count > 0) {
          puffAcc -= count;
          puffOpts.speed = cone.length / puffOpts.life * 1.7;
          puffOpts.spread = Math.tan(cfg.nozzle.spreadDeg * Math.PI / 360);
          puffOpts.size = 0.04 + cone.radius * 0.25;
          fx.spark(cone.origin, cone.direction, count, puffOpts);
        }
      } else puffAcc = 0;
      return cone;
    },
    flameCone() { return core.flameCone(); },
    state() { return core.state(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      core.dispose();
      if (fx && pilotShown) fx.removeFlame(pilotId);
      object.parent?.remove(object);
      for (const o of built.owned) o.dispose?.();
    },
  };
}

function mergeLayer(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeLayer(base[k], v) : v;
  return out;
}
