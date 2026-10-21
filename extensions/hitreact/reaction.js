// GameSystems hitreact extension: the hit reaction's math and state. Pure (no three.js, plain arrays), engine-agnostic.
// Everything is in the CHARACTER frame (humanoid canonical: +X = the character's left, +Y up, +Z forward, metres).
//
//   const r = createHitReaction(resolveHitReactConfig())
//   r.hit({ region, point, direction, impulse, heads })   // heads: posed joint heads (fkPositions), for lever arms
//   const f = r.update(dt)   // { state, changed, offsets: { joint: [ax, ay, az] }, root, step, collapse, active }
//   r.kill() -> 'inert' (terminal until reset); r.recover() ends 'downed' when the host owns recovery (ragdoll)
//
// A hit kicks spring-dampers: an angular velocity on every joint of the hit chain (the joints from the hit region up to
// the spine; the lever arm from the joint to the hit point crossed with the impulse direction gives the axis) and a linear
// velocity on the pelvis along the impulse. The springs pull back to zero (the animated pose), so the push decays. A
// large predicted pelvis excursion triggers a balance step. Instability accumulates per hit (scaled by region) and
// decays; past thresholds the state goes standing -> destabilized -> downed, and many hits in a short window also knock
// the body down. The states are the ai extension's physical states (world.setPhysicalState) with the same meaning.
import { vAdd, vSub, vScale, vDot, vCross, vLen, vNorm } from '../humanoid/index.js';

export const PHYSICAL_STATES = Object.freeze(['standing', 'destabilized', 'downed', 'recovering', 'inert']);
const TAU = Math.PI * 2;

/** Region (gore region ids, canonical joints or guard zones) -> head | chest | arm | leg (same rule as ai regionClass). */
export function regionClass(region = '') {
  const r = String(region);
  if (/head|cranium|jaw|neck/i.test(r)) return 'head';
  if (/arm|hand|shoulder/i.test(r)) return 'arm';
  if (/leg|foot|toes/i.test(r)) return 'leg';
  return 'chest';
}

const sideOf = r => (/^left/i.test(r) ? 'left' : /^right/i.test(r) ? 'right' : null);

/**
 * The hit chain of a region: canonical joints from the hit joint up to the spine, nearest first. Arms run through the
 * shoulder and the chest; the head through the neck; legs and the pelvis turn the hips (the feet are re-planted by IK).
 */
export function hitChain(region = 'chest') {
  const r = String(region), cls = regionClass(r), side = sideOf(r);
  if (cls === 'arm' && side) {
    const start = /hand/i.test(r) ? 'Hand' : /lower/i.test(r) ? 'LowerArm' : /shoulder/i.test(r) ? 'Shoulder' : 'UpperArm';
    const arm = ['Hand', 'LowerArm', 'UpperArm', 'Shoulder'];
    return [...arm.slice(arm.indexOf(start)).map(j => side + j), 'upperChest', 'chest', 'spine'];
  }
  if (cls === 'head') return /neck/i.test(r) ? ['neck', 'upperChest', 'chest', 'spine'] : ['head', 'neck', 'upperChest', 'chest', 'spine'];
  if (cls === 'leg' || /pelvis|hips|belly/i.test(r)) return ['hips', 'spine'];
  if (/^spine$/.test(r)) return ['spine'];
  if (/^chest$/.test(r)) return ['chest', 'spine'];
  return ['upperChest', 'chest', 'spine'];
}

/**
 * One implicit-Euler step of a critically/under-damped spring x'' = -w^2 x - 2 z w x' (w = 2 pi frequency) on a
 * 3-vector; x and v are updated in place. Unconditionally stable for any dt.
 */
export function springStep(x, v, dt, frequency, damping) {
  if (!(dt > 0)) return x;
  const w = TAU * frequency, k = w * w, c = 2 * damping * w, den = 1 + dt * c + dt * dt * k;
  for (let i = 0; i < 3; i++) { v[i] = (v[i] - dt * k * x[i]) / den; x[i] += dt * v[i]; }
  return x;
}

/** Peak displacement of the spring started at rest with speed v0 (m or rad). Analytic (continuous time). */
export function peakDisplacement(v0, frequency, damping) {
  const w = TAU * frequency, z = Math.max(0, damping), s = Math.abs(v0);
  if (!(w > 0) || s === 0) return 0;
  if (z < 1 - 1e-6) {
    const wd = w * Math.sqrt(1 - z * z), t = Math.atan2(wd, z * w) / wd;
    return s / wd * Math.exp(-z * w * t) * Math.sin(wd * t);
  }
  if (z <= 1 + 1e-6) return s / (w * Math.E);                    // critical: x = v0 t e^-wt, peak at t = 1/w
  const r = Math.sqrt(z * z - 1), a = w * (-z + r), b = w * (-z - r), t = Math.log(b / a) / (a - b);
  return s / (a - b) * (Math.exp(a * t) - Math.exp(b * t));
}

/** Clamps a 3-vector to length max; when clamped, removes the outward part of v (in place). */
function clampLen(x, v, max) {
  const l = vLen(x);
  if (l <= max || l === 0) return;
  const n = [x[0] / l, x[1] / l, x[2] / l], out = vDot(v, n);
  for (let i = 0; i < 3; i++) { x[i] = n[i] * max; if (out > 0) v[i] -= n[i] * out; }
}

const unit = (v, fallback) => { const n = Array.isArray(v) && v.length >= 3 && v.every(Number.isFinite) ? vNorm(v) : [0, 0, 0]; return vLen(n) > 0.5 ? n : fallback; };
const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/** The balance step for a push: which foot, and the step vector (character frame, horizontal). */
export function chooseStep(push, peak, cfg, heads = null) {
  const d = vNorm([push[0], 0, push[2]]);
  if (vLen(d) < 0.5) return null;
  const length = Math.min(cfg.maxStep, Math.max(cfg.minStep, peak * cfg.stepGain));
  let side;
  if (Math.abs(d[0]) >= Math.abs(d[2])) side = d[0] >= 0 ? 'left' : 'right';            // sideways: the leading foot (+X = left)
  else if (heads?.leftFoot && heads?.rightFoot) {
    // forward / back: the trailing foot steps through
    side = vDot(heads.leftFoot, d) <= vDot(heads.rightFoot, d) ? 'left' : 'right';
  } else side = 'right';
  return { side, vector: vScale(d, length) };
}

export function createHitReaction(config, { externalRecovery = false } = {}) {
  const cfg = config;
  const springs = new Map();            // joint -> { x, v }
  const root = { x: [0, 0, 0], v: [0, 0, 0] };
  let state = 'standing', changed = null, stateTime = 0, instability = 0, clock = 0, collapse = 0, hitTimes = [], step = null, external = externalRecovery;

  const spring = j => { let s = springs.get(j); if (!s) springs.set(j, s = { x: [0, 0, 0], v: [0, 0, 0] }); return s; };
  const setState = next => { if (next === state) return; changed = changed ?? state; state = next; stateTime = 0; };

  const api = {
    get state() { return state; },
    get instability() { return instability; },
    get config() { return cfg; },
    set externalRecovery(v) { external = !!v; },
    get externalRecovery() { return external; },

    /**
     * A hit in the character frame. impulse: N·s. heads: posed joint heads (character frame) for lever arms and the
     * balance foot; without them the chain axis is up × direction. Returns what happened.
     */
    hit({ region = 'chest', point = null, direction = null, impulse = 0, heads = null } = {}) {
      if (!cfg.enabled || state === 'inert') return { ignored: true, state };
      const kick = Math.max(0, Number(impulse) || 0) * cfg.impulseScale;
      const dir = unit(direction, [0, 0, -1]), cls = regionClass(region), chain = hitChain(region);
      const out = { ignored: false, kick, regionClass: cls, chain, step: false, state };
      if (state === 'standing' || state === 'destabilized') {
        const fallbackAxis = vNorm(vCross([0, 1, 0], dir));
        chain.forEach((j, i) => {
          const share = cfg.chain.kick * kick * Math.pow(cfg.chain.falloff, i);
          if (!(share > 0)) return;
          let axis = fallbackAxis;
          if (point && heads?.[j]) {
            const r = vSub(point, heads[j]), t = vCross(r, dir), l = vLen(t);
            if (l > 1e-3) axis = vScale(t, 1 / Math.max(l, 0.15));     // short levers turn less (up to |r| ~ 15 cm full)
          }
          const s = spring(j);
          for (let k = 0; k < 3; k++) s.v[k] += axis[k] * share;
        });
        const flat = vNorm([dir[0], 0, dir[2]]), pelvis = cls === 'leg' || /pelvis|hips|belly/i.test(region);
        const add = vAdd(vScale(flat, cfg.root.kick * kick), [0, -(pelvis ? cfg.root.legDrop : 0) * kick, 0]);
        for (let k = 0; k < 3; k++) root.v[k] += add[k];
        // balance step when the pelvis would travel far (predicted from the spring)
        const peak = peakDisplacement(Math.hypot(root.v[0], root.v[2]), cfg.root.frequency, cfg.root.damping);
        if (cfg.feet.plant && peak > cfg.balance.stepAt && !step) {
          const choice = chooseStep(root.v, peak, cfg.balance, heads);
          if (choice) { step = { ...choice, phase: 'out', t: 0 }; out.step = true; }
        }
      }
      instability += kick * (cfg.stability.regionScale[cls] ?? 1);
      hitTimes.push(clock);
      while (hitTimes.length && clock - hitTimes[0] > cfg.stability.hitWindow) hitTimes.shift();
      const st = cfg.stability;
      if (state !== 'downed' && (instability >= st.downAt || hitTimes.length >= st.downHits)) { setState('downed'); step = null; }
      else if (state === 'standing' && instability >= st.destabilizedAt) setState('destabilized');
      else if (state === 'destabilized') stateTime = 0;                  // a new hit extends the stagger
      out.state = state;
      out.downed = state === 'downed';
      return out;
    },

    /** Advances the springs and the state. Returns this frame's offsets (character frame). */
    update(dt) {
      dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      clock += dt; stateTime += dt;
      for (const [j, s] of springs) {
        springStep(s.x, s.v, dt, cfg.chain.frequency, cfg.chain.damping);
        clampLen(s.x, s.v, cfg.chain.maxAngle);
        if (vLen(s.x) < 1e-5 && vLen(s.v) < 1e-4) springs.delete(j);
      }
      springStep(root.x, root.v, dt, cfg.root.frequency, cfg.root.damping);
      clampLen(root.x, root.v, cfg.root.maxOffset);
      instability = Math.max(0, instability - cfg.stability.decay * dt);
      while (hitTimes.length && clock - hitTimes[0] > cfg.stability.hitWindow) hitTimes.shift();

      // states
      if (state === 'destabilized' && stateTime >= cfg.stability.minDestabilized && instability < cfg.stability.destabilizedAt * 0.5
        && vLen(root.x) < cfg.balance.stepAt) setState('standing');
      else if (state === 'downed' && !external && stateTime >= cfg.downed.fallSeconds + cfg.downed.seconds) setState('recovering');
      else if (state === 'recovering' && stateTime >= cfg.downed.recoverSeconds) { setState('standing'); instability = 0; hitTimes = []; }

      // IK knockdown weight (the ragdoll replaces it when the host runs one)
      if (state === 'downed') collapse = Math.min(1, collapse + dt / cfg.downed.fallSeconds);
      else if (state === 'recovering') collapse = Math.max(0, collapse - dt / cfg.downed.recoverSeconds);
      else if (state !== 'inert') collapse = 0;

      // balance step: out (lifted arc), hold while the pelvis is still out, back (lifted arc)
      let stepOut = null;
      if (step) {
        const b = cfg.balance;
        step.t += dt;
        let s = 1, lift = 0;
        if (step.phase === 'out') {
          const u = step.t / b.stepTime; s = smooth(u); lift = Math.sin(Math.PI * Math.min(1, u)) * b.stepHeight;
          if (u >= 1) { step.phase = 'hold'; step.t = 0; }
        } else if (step.phase === 'hold') {
          if (step.t >= b.holdTime && vLen(root.x) < b.stepAt * 0.5) { step.phase = 'back'; step.t = 0; }
        } else {
          const u = step.t / b.stepTime; s = 1 - smooth(u); lift = Math.sin(Math.PI * Math.min(1, u)) * b.stepHeight;
          if (u >= 1) step = null;
        }
        if (step) stepOut = { side: step.side, offset: [step.vector[0] * s, lift, step.vector[2] * s], phase: step.phase };
      }
      if (state === 'downed' || state === 'inert') stepOut = null;

      const offsets = {};
      for (const [j, s] of springs) offsets[j] = [...s.x];
      const frame = { state, changed, offsets, root: [...root.x], step: stepOut, collapse,
        active: springs.size > 0 || vLen(root.x) > 1e-5 || vLen(root.v) > 1e-4 || !!stepOut || collapse > 0 };
      changed = null;
      return frame;
    },

    /** Ends 'downed' (the host's ragdoll decided the body settled). */
    recover() { if (state === 'downed') setState('recovering'); },
    /** Dead: 'inert' until reset(). */
    kill() { setState('inert'); step = null; },
    /** Forces a state (the host's own placeholder, a scripted knockdown). Keeps the springs. */
    setState(next) {
      if (!PHYSICAL_STATES.includes(next)) throw new TypeError(`hitreact setState: ${next} (one of ${PHYSICAL_STATES.join(', ')})`);
      setState(next);
    },
    reset() {
      springs.clear(); root.x.fill(0); root.v.fill(0); step = null; hitTimes = [];
      state = 'standing'; changed = null; stateTime = instability = collapse = 0;
    },
  };
  return api;
}
