// GameSystems flamethrower extension: the tunables. Pure (no three.js). Layers merge onto the defaults
// (resolveFlamethrowerConfig); validateFlamethrowerConfig() names every problem. Full reference: docs/flamethrower_system.md.
//
//   tank        { capacityMl, startMl (null = full) }
//   nozzle      { range (m, full-pressure flame length), spreadDeg (full cone angle), flowMlPerSecond (fuel drained while the
//               valve is open), baseRadius (m, flame radius at the nozzle), rampSeconds (time to reach full length),
//               fadeSeconds (time for the tail to die after release), minLength (m, shorter than this the cone is inactive) }
//   pilot       { enabled (false: no ignition at all, the weapon only sprays raw fuel), startLit, igniteDelay (s from valve
//               open to flame), relightSeconds (s to relight after douse() or a backfire) }
//   sputter     { belowMl (tank level where pressure starts to fall), minPressure (pressure at an almost empty tank, 0..1) }
//   backfire    { enabled (opt-in hazard), chancePerSecond (at an empty tank with the trigger held and the pilot lit; scaled by
//               how empty the tank is while sputtering), radius (m, around the nozzle), cooldownSeconds }
//   visual      { sparksPerSecond (flame puffs sent to fire-fx while burning), pilotSize (m) }
export const DEFAULT_FLAMETHROWER_CONFIG = deepFreeze({
  tank: { capacityMl: 6000, startMl: null },
  nozzle: { range: 5, spreadDeg: 16, flowMlPerSecond: 150, baseRadius: 0.03, rampSeconds: 0.3, fadeSeconds: 0.2, minLength: 0.15 },
  pilot: { enabled: true, startLit: true, igniteDelay: 0.08, relightSeconds: 1.2 },
  sputter: { belowMl: 300, minPressure: 0.25 },
  backfire: { enabled: false, chancePerSecond: 0.5, radius: 0.9, cooldownSeconds: 2 },
  visual: { sparksPerSecond: 90, pilotSize: 0.035 },
});

function deepFreeze(o) { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); }
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? merge(base[k], v) : v;
  return out;
}
const clone = v => JSON.parse(JSON.stringify(v));

/** Merges config layers onto the defaults, later layers winning. Throws a TypeError naming every problem. */
export function resolveFlamethrowerConfig(...layers) {
  let cfg = clone(DEFAULT_FLAMETHROWER_CONFIG);
  for (const layer of layers.filter(Boolean)) {
    if (!isObj(layer)) throw new TypeError('flamethrower config layers must be objects');
    cfg = merge(cfg, layer);
  }
  const { ok, errors } = validateFlamethrowerConfig(cfg);
  if (!ok) throw new TypeError(`invalid flamethrower config: ${errors.join('; ')}`);
  return cfg;
}

const num = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const bool = v => typeof v === 'boolean';

/** Checks a full (resolved) config. Returns { ok, errors: [string] }. */
export function validateFlamethrowerConfig(cfg) {
  const errors = [];
  if (!isObj(cfg)) return { ok: false, errors: ['config must be an object'] };
  const section = (name, checks) => {
    const s = cfg[name];
    if (!isObj(s)) { errors.push(`${name} must be an object`); return; }
    for (const [key, ok, msg] of checks) if (!ok(s[key])) errors.push(`${name}.${key} ${msg}`);
  };
  section('tank', [['capacityMl', v => num(v, 1, 1e6), 'must be in 1..1e6 ml'], ['startMl', v => v === null || num(v, 0, 1e6), 'must be null or in 0..1e6 ml']]);
  section('nozzle', [['range', v => num(v, 0.1, 50), 'must be in 0.1..50 m'], ['spreadDeg', v => num(v, 0.5, 120), 'must be in 0.5..120 degrees'],
    ['flowMlPerSecond', v => num(v, 0, 1e5), 'must be in 0..1e5 ml/s'], ['baseRadius', v => num(v, 0, 1), 'must be in 0..1 m'],
    ['rampSeconds', v => num(v, 0.001, 10), 'must be in 0.001..10 s'], ['fadeSeconds', v => num(v, 0.001, 10), 'must be in 0.001..10 s'],
    ['minLength', v => num(v, 0, 5), 'must be in 0..5 m']]);
  section('pilot', [['enabled', bool, 'must be a boolean'], ['startLit', bool, 'must be a boolean'], ['igniteDelay', v => num(v, 0, 10), 'must be in 0..10 s'],
    ['relightSeconds', v => num(v, 0, 60), 'must be in 0..60 s']]);
  section('sputter', [['belowMl', v => num(v, 0, 1e6), 'must be in 0..1e6 ml'], ['minPressure', v => num(v, 0, 1), 'must be in 0..1']]);
  section('backfire', [['enabled', bool, 'must be a boolean'], ['chancePerSecond', v => num(v, 0, 100), 'must be in 0..100'],
    ['radius', v => num(v, 0, 10), 'must be in 0..10 m'], ['cooldownSeconds', v => num(v, 0, 600), 'must be in 0..600 s']]);
  section('visual', [['sparksPerSecond', v => num(v, 0, 2000), 'must be in 0..2000'], ['pilotSize', v => num(v, 0, 1), 'must be in 0..1 m']]);
  if (isObj(cfg.tank) && num(cfg.tank.startMl) && num(cfg.tank.capacityMl) && cfg.tank.startMl > cfg.tank.capacityMl) errors.push('tank.startMl must not exceed tank.capacityMl');
  return { ok: errors.length === 0, errors };
}
