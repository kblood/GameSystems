// The flamethrower as a state machine: tank + trigger + pilot + nozzle cone. Pure (no three.js). One update(dt, aim) per
// frame fills the reused cone object ({ origin, direction, length, radius, dt, active, intensity, baseRadius }); the game
// applies damage and ignition from it. The weapon applies nothing to the world.
//
// Rules per frame:
//   valve open    = trigger held and fuel in the tank; fuel drains at nozzle.flowMlPerSecond
//   burning       = valve open, pilot lit and the valve open for at least pilot.igniteDelay
//   pressure      = 1, or below sputter.belowMl falling towards sputter.minPressure with a seeded sputter
//   flame length  = ramps towards range × pressure while burning (rampSeconds), shrinks to 0 after (fadeSeconds); the
//                   cone stays active while the dying tail is longer than minLength
//   unlit spray   = valve open without a lit pilot: fuel leaves but nothing burns (state().unlitMl; the game may make a puddle)
//   backfire      = opt-in: trigger held, pilot lit and the tank empty (or sputtering) -> a seeded roll; on a hit the
//                   'backfire' event fires with { origin, radius }, the pilot goes out and relights after relightSeconds
import { resolveFlamethrowerConfig } from './config.js';
import { createFuelTank } from './tank.js';
import { createTrigger } from './trigger.js';
import { createPilotLight } from './pilot.js';
import { makeCone, coneRadius } from './nozzle.js';

export const FLAMETHROWER_EVENTS = Object.freeze(['ignite', 'extinguish', 'empty', 'dry-fire', 'refuel', 'pilot-lit', 'pilot-out', 'backfire']);

/**
 * @param {object} [config]   a config layer (resolveFlamethrowerConfig) or an already resolved config
 * @param {{ seed?: number, onEvent?: (type: string, detail: object) => void }} [options]
 */
export function createFlamethrowerCore(config = {}, { seed = 9137, onEvent = null } = {}) {
  const cfg = resolveFlamethrowerConfig(config);
  const tank = createFuelTank({ capacityMl: cfg.tank.capacityMl, fuelMl: cfg.tank.startMl ?? cfg.tank.capacityMl });
  const trigger = createTrigger();
  const pilot = createPilotLight(cfg.pilot);
  const cone = makeCone();
  const n = cfg.nozzle;
  cone.baseRadius = n.baseRadius;
  let openFor = 0, burning = false, pressure = 1, sputtering = false, time = 0, cooldown = 0, disposed = false;
  let burnSeconds = 0, burnedMl = 0, unlitMl = 0, backfires = 0, lastBackfire = null, wasEmpty = tank.empty;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const emit = (type, detail) => { if (onEvent) onEvent(type, detail); };

  function setAim(aim) {
    if (!aim) return;
    const o = aim.origin, d = aim.direction;
    if (o) { cone.origin[0] = o[0] ?? o.x; cone.origin[1] = o[1] ?? o.y; cone.origin[2] = o[2] ?? o.z; }
    if (d) {
      const x = d[0] ?? d.x, y = d[1] ?? d.y, z = d[2] ?? d.z, len = Math.sqrt(x * x + y * y + z * z);
      if (len > 1e-9 && Number.isFinite(len)) { cone.direction[0] = x / len; cone.direction[1] = y / len; cone.direction[2] = z / len; }
    }
  }

  function pressureFor(fuel) {
    const s = cfg.sputter;
    if (fuel >= s.belowMl || s.belowMl <= 0) { sputtering = false; return 1; }
    sputtering = true;
    const base = s.minPressure + (1 - s.minPressure) * (fuel / s.belowMl);
    return base * (0.65 + 0.35 * random());
  }

  const api = {
    config: cfg,
    tank,
    trigger,
    pilot,
    /** Trigger down/up. Returns true when it changed. */
    setTrigger(on) {
      const changed = trigger.set(on);
      if (changed && on && tank.empty) emit('dry-fire', { fuelMl: 0 });
      return changed;
    },
    /** Pours ml into the tank; returns the ml accepted (the rest stays with the caller). */
    refuel(ml) {
      const accepted = tank.refill(ml);
      if (accepted > 0) { wasEmpty = false; emit('refuel', { ml: accepted, fuelMl: tank.fuelMl }); }
      return accepted;
    },
    /** Puts the pilot out (water, the game's own hazard). */
    douse() { if (pilot.douse()) { emit('pilot-out', { reason: 'doused' }); return true; } return false; },
    /** Relights the pilot on the next update. */
    relight() { return pilot.relight(); },
    /**
     * Advances the weapon. aim = { origin:[x,y,z]|{x,y,z}, direction:[x,y,z]|{x,y,z} } in world space (optional: the last
     * aim is kept). Returns the cone (the same object every frame; copy what you keep).
     */
    update(dt, aim) {
      if (disposed) return cone;
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be a finite number >= 0');
      dt = Math.min(dt, 0.25);
      time += dt; cone.dt = dt;
      setAim(aim);
      trigger.tick(dt);
      if (pilot.tick(dt)) emit('pilot-lit', {});
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);

      const valve = trigger.held && !tank.empty;
      const wasBurning = burning;
      let drained = 0;
      if (valve) {
        pressure = pressureFor(tank.fuelMl);
        drained = tank.drain(n.flowMlPerSecond * dt);
        openFor += dt;
        burning = pilot.lit && openFor >= cfg.pilot.igniteDelay;
        if (burning) { burnedMl += drained; burnSeconds += dt; } else unlitMl += drained;
      } else { openFor = 0; burning = false; if (!trigger.held) sputtering = false; }

      const target = burning ? n.range * pressure : 0;
      if (cone.length < target) cone.length = Math.min(target, cone.length + n.range * dt / n.rampSeconds);
      else cone.length = Math.max(target, cone.length - n.range * dt / n.fadeSeconds);
      cone.radius = coneRadius(cone.length, n.spreadDeg);
      cone.active = cone.length > n.minLength;
      cone.intensity = cone.active ? (burning ? pressure : Math.min(1, cone.length / n.range)) : 0;

      if (burning && !wasBurning) emit('ignite', { fuelMl: tank.fuelMl });
      if (!burning && wasBurning) emit('extinguish', { fuelMl: tank.fuelMl });
      if (tank.empty && !wasEmpty) emit('empty', { drainedMl: drained });
      wasEmpty = tank.empty;

      const b = cfg.backfire;
      if (b.enabled && trigger.held && pilot.lit && cooldown <= 0 && (tank.empty || sputtering)) {
        const level = tank.empty ? 1 : 1 - tank.fuelMl / Math.max(1e-9, cfg.sputter.belowMl);
        if (random() < b.chancePerSecond * dt * level) {
          backfires++; cooldown = b.cooldownSeconds;
          lastBackfire = { origin: [...cone.origin], radius: b.radius, time };
          pilot.douse();
          if (burning) { burning = false; emit('extinguish', { fuelMl: tank.fuelMl }); }
          emit('backfire', { origin: lastBackfire.origin, radius: b.radius, time });
          emit('pilot-out', { reason: 'backfire' });
        }
      }
      return cone;
    },
    /** The cone of the last update (the same object every frame). */
    flameCone() { return cone; },
    /** A fresh snapshot of the weapon (allocates: call it for HUDs and saves, not per hit test). */
    state() {
      return {
        trigger: trigger.held, fuelMl: tank.fuelMl, capacityMl: tank.capacityMl, fuelFraction: tank.fraction, empty: tank.empty,
        pilotLit: pilot.lit, pilotRelighting: pilot.relighting, pilotRelightIn: pilot.relightIn,
        firing: burning, spraying: trigger.held && !tank.empty && !burning, sputtering, pressure: trigger.held && !tank.empty ? pressure : 0,
        active: cone.active, length: cone.length, radius: cone.radius, intensity: cone.intensity,
        backfire: { enabled: cfg.backfire.enabled, count: backfires, cooldown, last: lastBackfire && { ...lastBackfire, origin: [...lastBackfire.origin] } },
        totals: { burnSeconds, burnedMl, unlitMl, ...tank.totals(), pulls: trigger.pulls },
        time,
      };
    },
    dispose() { disposed = true; trigger.set(false); burning = false; cone.active = false; cone.length = 0; cone.radius = 0; cone.intensity = 0; },
  };
  return api;
}
