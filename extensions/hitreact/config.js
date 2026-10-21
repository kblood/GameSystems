// GameSystems hitreact extension: the tunables. Pure (no three.js). Merged defaults -> global -> enemy type -> per
// character (resolveHitReactConfig, the same pattern as extensions/gore/config.js); validateHitReactConfig() names every
// problem. Units: metres, seconds, radians, N·s.
//
//   enabled          false: hits do nothing to the body (the host keeps its own placeholder)
//   impulseScale     1/(N·s): a hit's impulse becomes a dimensionless kick = impulse × impulseScale (pistol 2.7 N·s -> ~1)
//   chain            spring-damper rotations on the hit chain (the joints from the hit region up to the spine)
//                      kick       rad/s of angular velocity per kick at the hit joint
//                      falloff    share kept per joint further up the chain (0.55: the spine gets a fraction)
//                      maxAngle   per-joint offset clamp (rad)
//                      frequency  Hz, natural frequency of the springs; damping: damping ratio (< 1 wobbles once)
//   root             the pelvis pushed along the impulse (a 3-vector spring in the character frame)
//                      kick       m/s per kick (horizontal, along the hit direction)
//                      legDrop    m/s downward per kick for leg / pelvis hits (the knees give)
//                      maxOffset  m clamp; frequency (Hz), damping (ratio)
//   feet             { plant } feet stay where the animation put them (two-bone leg IK) while the pelvis moves
//   balance          a balance step when the pelvis would be pushed far
//                      stepAt     m: predicted peak pelvis offset that triggers a step
//                      minStep, maxStep  m: step length range; stepGain: step length per metre of predicted offset
//                      stepTime   s per step (out and back); stepHeight: m foot lift; holdTime: s before stepping back
//   stability        when the body loses it
//                      destabilizedAt  instability that makes the state 'destabilized' (a pistol chest hit adds ~1)
//                      downAt          instability that knocks it 'downed'
//                      downHits        this many hits inside hitWindow (s) also knock it down
//                      decay           instability lost per second; minDestabilized: s the stagger lasts at least
//                      regionScale     { head, chest, arm, leg } instability per kick by region class
//   downed           the IK knockdown (used when the ragdoll is off): knees give, the trunk slumps forward
//                      fallSeconds, seconds (on the floor), recoverSeconds (getting up), drop (m pelvis drop), pitch (rad)
//   ragdoll          the active ragdoll (step 2). OPT-IN: enabled false by default. It takes over the body only while
//                    'downed' or 'inert'; 'recovering' blends back to the animated pose.
//                      enabled          false: no physics bodies are ever created (behaviour as without this section)
//                      shotImpulse      N·s per bullet on the hit segment (Nightfall active_ragdoll.gd: 4.5); 0 = the hit's own
//                      knockdownImpulse N·s on the chest along the hit when the body goes down (so it falls away from the shot)
//                      muscleScale      share of the standing muscle torques while downed (Nightfall 'destabilized': 0.06)
//                      muscleFrequency  Hz of the muscle servo (Nightfall 1.5)
//                      minDownedSeconds / maxDownedSeconds  s on the floor before recovering (when settled / at most)
//                      settleSpeed      m/s: every segment slower than this counts as settled; settleSeconds: for this long
//                      linearDamping, angularDamping (cannon 0..1), corpseAngularDamping (inert)
//                      group, mask      collision filter bits of the segments (default: collide with the static world only)
//                      recenter         true: on recovering the host may move its body to where the pelvis landed

export const DEFAULT_HIT_REACT_CONFIG = Object.freeze({
  enabled: true,
  impulseScale: 0.37,
  chain: { kick: 7, falloff: 0.55, maxAngle: 0.55, frequency: 2.6, damping: 0.42 },
  root: { kick: 0.5, legDrop: 0.12, maxOffset: 0.14, frequency: 1.6, damping: 0.75 },
  feet: { plant: true },
  balance: { stepAt: 0.045, minStep: 0.12, maxStep: 0.34, stepGain: 2.2, stepTime: 0.28, stepHeight: 0.07, holdTime: 0.35 },
  stability: { destabilizedAt: 0.6, downAt: 3.2, downHits: 7, hitWindow: 3, decay: 0.9, minDestabilized: 0.3,
    regionScale: { head: 0.8, chest: 1, arm: 0.55, leg: 1.3 } },
  downed: { fallSeconds: 0.7, seconds: 1.8, recoverSeconds: 0.9, drop: 0.46, pitch: 0.55 },
  ragdoll: { enabled: false, shotImpulse: 4.5, knockdownImpulse: 30, muscleScale: 0.06, muscleFrequency: 1.5,
    minDownedSeconds: 1.2, maxDownedSeconds: 4, settleSpeed: 0.25, settleSeconds: 0.4,
    linearDamping: 0.05, angularDamping: 0.35, corpseAngularDamping: 0.7, group: 16, mask: 1, recenter: true },
});

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? merge(base[k], v) : v;
  return out;
}
const clone = v => JSON.parse(JSON.stringify(v));

/** Merges config layers onto the defaults, later layers winning. Throws a TypeError naming every problem. */
export function resolveHitReactConfig(...layers) {
  let cfg = clone(DEFAULT_HIT_REACT_CONFIG);
  for (const layer of layers.filter(Boolean)) {
    if (!isObj(layer)) throw new TypeError('hitreact config layers must be objects');
    cfg = merge(cfg, layer);
  }
  const { ok, errors } = validateHitReactConfig(cfg);
  if (!ok) throw new TypeError(`invalid hitreact config: ${errors.join('; ')}`);
  return cfg;
}

const num = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const bool = v => typeof v === 'boolean';
const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
const range = (lo, hi) => v => num(v, lo, hi);

/** Checks a full (resolved) config. Returns { ok, errors: [string] }. */
export function validateHitReactConfig(cfg) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!isObj(cfg)) return { ok: false, errors: ['config must be an object'] };
  need(bool(cfg.enabled), 'enabled must be a boolean');
  need(num(cfg.impulseScale, 0, 100), 'impulseScale must be in 0..100');
  const section = (name, checks, obj = cfg[name], label = name) => {
    if (!isObj(obj)) { errors.push(`${label} must be an object`); return; }
    for (const [key, ok, msg] of checks) need(ok(obj[key]), `${label}.${key} ${msg}`);
  };
  const hz = [range(0.05, 30), 'must be in 0.05..30 Hz'], ratio = [range(0, 5), 'must be in 0..5'];
  section('chain', [['kick', range(0, 100), 'must be in 0..100 rad/s'], ['falloff', range(0, 1), 'must be in 0..1'],
    ['maxAngle', range(0, Math.PI), 'must be in 0..pi rad'], ['frequency', ...hz], ['damping', ...ratio]]);
  section('root', [['kick', range(0, 20), 'must be in 0..20 m/s'], ['legDrop', range(0, 20), 'must be in 0..20 m/s'],
    ['maxOffset', range(0, 2), 'must be in 0..2 m'], ['frequency', ...hz], ['damping', ...ratio]]);
  section('feet', [['plant', bool, 'must be a boolean']]);
  section('balance', [['stepAt', range(0, 2), 'must be in 0..2 m'], ['minStep', range(0, 1.5), 'must be in 0..1.5 m'],
    ['maxStep', range(0, 1.5), 'must be in 0..1.5 m'], ['stepGain', range(0, 50), 'must be in 0..50'],
    ['stepTime', range(0.05, 3), 'must be in 0.05..3 s'], ['stepHeight', range(0, 0.5), 'must be in 0..0.5 m'],
    ['holdTime', range(0, 10), 'must be in 0..10 s']]);
  if (isObj(cfg.balance)) need(!(cfg.balance.minStep > cfg.balance.maxStep), 'balance.minStep must not exceed balance.maxStep');
  section('stability', [['destabilizedAt', range(0, 1000), 'must be in 0..1000'], ['downAt', range(0, 1000), 'must be in 0..1000'],
    ['downHits', int(1, 1000), 'must be an integer in 1..1000'], ['hitWindow', range(0, 60), 'must be in 0..60 s'],
    ['decay', range(0, 100), 'must be in 0..100 per s'], ['minDestabilized', range(0, 10), 'must be in 0..10 s']]);
  if (isObj(cfg.stability)) {
    section('regionScale', ['head', 'chest', 'arm', 'leg'].map(k => [k, range(0, 100), 'must be in 0..100']), cfg.stability.regionScale, 'stability.regionScale');
    need(!(cfg.stability.destabilizedAt > cfg.stability.downAt), 'stability.destabilizedAt must not exceed stability.downAt');
  }
  section('downed', [['fallSeconds', range(0.01, 10), 'must be in 0.01..10 s'], ['seconds', range(0, 60), 'must be in 0..60 s'],
    ['recoverSeconds', range(0.01, 10), 'must be in 0.01..10 s'], ['drop', range(0, 1.5), 'must be in 0..1.5 m'],
    ['pitch', range(0, Math.PI / 2), 'must be in 0..pi/2 rad']]);
  section('ragdoll', [['enabled', bool, 'must be a boolean'], ['shotImpulse', range(0, 500), 'must be in 0..500 N·s'],
    ['knockdownImpulse', range(0, 2000), 'must be in 0..2000 N·s'], ['muscleScale', range(0, 1), 'must be in 0..1'],
    ['muscleFrequency', range(0, 30), 'must be in 0..30 Hz'], ['minDownedSeconds', range(0, 60), 'must be in 0..60 s'],
    ['maxDownedSeconds', range(0, 600), 'must be in 0..600 s'], ['settleSpeed', range(0, 20), 'must be in 0..20 m/s'],
    ['settleSeconds', range(0, 10), 'must be in 0..10 s'], ['linearDamping', range(0, 1), 'must be in 0..1'],
    ['angularDamping', range(0, 1), 'must be in 0..1'], ['corpseAngularDamping', range(0, 1), 'must be in 0..1'],
    ['group', int(1, 0x7fffffff), 'must be a positive integer (bit mask)'], ['mask', int(0, 0x7fffffff), 'must be an integer bit mask'],
    ['recenter', bool, 'must be a boolean']]);
  if (isObj(cfg.ragdoll)) need(!(cfg.ragdoll.minDownedSeconds > cfg.ragdoll.maxDownedSeconds), 'ragdoll.minDownedSeconds must not exceed ragdoll.maxDownedSeconds');
  return { ok: errors.length === 0, errors };
}
