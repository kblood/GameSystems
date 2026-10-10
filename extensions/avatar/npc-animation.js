// GameSystems avatar extension; from the Contracts character plugin (src/npc-animation.js; MIT, Copyright (c) 2026 Kasper
// Olesen), imports flattened. Source of truth: GameSystems/extensions/avatar.
// Procedural humanoid animation. Host placement is authoritative; no motion/physics integration.
import { worldToPose, fkPositions } from '../humanoid/index.js';
import { solveTwoBone } from './twobone.js';
import { fingerStateFromCurls, fingerWorldDeltas, blendFingerStates } from './fingers.js';
import { clamp, lp, ry, rx, rz, qMul, qConj, qRotate, qFromTo, qFrameZY, qAlignFrames, qSlerp, vAdd, vSub, vNorm, vScale, vLerp, wrapAngle } from './qx.js';
import { frameDelta } from './lifecycle.js';
import { buildTorso, torsoAt } from './bodyvolume.js';

const ID = [0, 0, 0, 1], TAU = Math.PI * 2, SIDES = ['left', 'right'];
const finite3 = value => value?.length >= 3 && value.slice(0, 3).every(Number.isFinite);
const num = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const STATES = new Set(['idle', 'alert', 'attack', 'reload', 'hurt', 'dead']);
export function localAimPoint(point, position, yaw, scale = 1) {
  if (!finite3(point)) return null;
  return vScale(qRotate(ry(-yaw), vSub(point, position)), 1 / scale);
}
function seedPhase(seed) {
  let h = 2166136261;
  for (const c of String(seed ?? 0)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296 * TAU;
}
function approach(a, b, limit) {
  const d = vSub(b, a), length = Math.hypot(...d);
  return vAdd(a, vScale(d, Math.min(1, limit / (length || 1))));
}
function turn(a, b, limit) {
  const dot = Math.abs(a.reduce((sum, v, i) => sum + v * b[i], 0));
  const angle = 2 * Math.acos(clamp(dot, -1, 1));
  return qSlerp(a, b, Math.min(1, limit / (angle || 1)));
}

export function createNPCAnimator(initialRig, options = {}) {
  const seed = seedPhase(options.seed ?? options.id);
  let rig = initialRig, clock = seed, phase = seed / TAU, move = 0, recoil = 0, hurt = 0, death = 0;
  let state = 'idle', aimYaw = 0, aimPitch = 0, combatWeight = 0, reloadWeight = 0, previous = null, settled = null;
  let feet = {}, wrists = {}, torso = buildTorso(rig, options.body);
  const gripFingers = fingerStateFromCurls({ thumb: .72, index: .16, middle: .9, ring: .92, little: .92 });
  const firingFingers = fingerStateFromCurls({ thumb: .72, index: .7, middle: .9, ring: .92, little: .92 });
  const supportFingers = fingerStateFromCurls({ thumb: .8, index: .85, middle: .9, ring: .92, little: .92 });
  const clearContacts = () => { feet = {}; previous = null; };
  return {
    setRig(next) { if (next !== rig) { rig = next; torso = buildTorso(rig, options.body); clearContacts(); wrists = {}; settled = null; } },
    reset() { clock = seed; phase = seed / TAU; move = recoil = hurt = death = aimYaw = aimPitch = combatWeight = reloadWeight = 0; state = 'idle'; clearContacts(); wrists = {}; settled = null; },
    update(input = {}, dt) {
      dt = frameDelta(dt);
      const next = STATES.has(input.state) ? input.state : 'idle';
      if (next === 'dead' && state === 'dead' && settled) return { ...settled, events: [] };
      clock += dt;
      if (next !== state) { if (next === 'hurt') hurt = 1; if (state === 'dead') { death = 0; settled = null; clearContacts(); } state = next; }
      const position = finite3(input.position) ? [...input.position] : [0, 0, 0];
      const yawWorld = num(input.yaw), scale = num(input.scale, 1) > 0 ? num(input.scale, 1) : 1;
      const H = rig.H, k = rig.eyeHeight / 1.553;
      const world = p => vAdd(position, vScale(qRotate(ry(yawWorld), p), scale));
      const local = p => localAimPoint(p, position, yawWorld, scale);
      const speed = clamp(Math.abs(num(input.speed, input.moving ? 1.3 : 0)), 0, 8) / scale;
      const moving = !!input.moving && speed > 0.01 && state !== 'dead';
      const repair = previous && (Math.hypot(...vSub(position, previous.position)) > Math.max(0.75 * scale, speed * scale * dt * 3)
        || Math.abs(wrapAngle(yawWorld - previous.yaw)) > 0.65 || Math.abs(scale / previous.scale - 1) > 0.02);
      if (repair) feet = {};
      let velocity = qRotate(ry(yawWorld), [0, 0, Math.sign(num(input.speed, 1)) * speed * scale]);
      if (previous && !repair && dt > 0 && Math.hypot(...vSub(position, previous.position)) > 1e-6) velocity = vScale(vSub(position, previous.position), 1 / dt);
      previous = { position, yaw: yawWorld, scale };
      move += ((moving ? Math.min(1, speed / 0.25) : 0) - move) * lp(dt, 0.12);
      const stride = Math.min(rig.legLength * 0.23, Math.max(0.04 * k, speed * 0.15));
      const cadence = moving ? speed * 0.6 / (2 * stride) : 0;
      const oldPhase = phase;
      phase += cadence * dt;
      recoil = Math.max(clamp(num(input.recoil), 0, 1), recoil * Math.exp(-dt * 18));
      hurt *= Math.exp(-dt * 5);
      if (state === 'dead') death = Math.min(1, death + dt / 0.85);
      const combat = state !== 'idle' && state !== 'dead';
      combatWeight += clamp((combat ? 1 : 0) - combatWeight, -dt * 2.8, dt * 2.8);
      reloadWeight += clamp((state === 'reload' ? 1 : 0) - reloadWeight, -dt * 3, dt * 3);
      const aim = finite3(input.aimPoint) ? input.aimPoint : [0, rig.eyeHeight, 10];
      const origin = [0, (H.leftUpperArm[1] + H.rightUpperArm[1]) / 2 - 0.14 * k, 0.12 * k];
      const direction = vSub(aim, origin);
      const yaw = clamp(Math.atan2(direction[0], direction[2]), -1.15, 1.15);
      const pitch = clamp(Math.atan2(direction[1], Math.hypot(direction[0], direction[2])), -0.85, 0.85);
      aimYaw += (yaw - aimYaw) * lp(dt, 0.09); aimPitch += (pitch - aimPitch) * lp(dt, 0.09);
      const aimQ = qMul(ry(aimYaw), rx(-aimPitch - recoil * 0.12));
      const breath = Math.sin(clock * 1.7) * 0.004 * (1 - death);
      const W = {
        hips: qMul(rx(move * 0.035 - hurt * 0.14), rz(hurt * 0.14 + breath * 0.35)),
        spine: qMul(ry(aimYaw * 0.1), rx(-aimPitch * 0.08 - recoil * 0.035)),
        chest: qMul(ry(aimYaw * 0.2), rx(-aimPitch * 0.16 - recoil * 0.06 + breath)),
        upperChest: qMul(ry(aimYaw * 0.35), rx(-aimPitch * 0.25 - recoil * 0.08 + breath)),
        neck: qMul(ry(aimYaw * 0.75), rx(-aimPitch * 0.75)), head: aimQ,
      };
      const root = [Math.sin(clock * 0.63) * 0.002 * k * (1 - death), -0.035 * k, 0];
      const targets = {}, events = [], contacts = {};
      for (const [i, side] of SIDES.entries()) {
        const foot = side + 'Foot', rest = [H[foot][0] * 0.85, rig.ankleHeight, H[foot][2]];
        const u = ((phase + i * 0.5) % 1 + 1) % 1;
        const oldU = ((oldPhase + i * 0.5) % 1 + 1) % 1;
        let f = feet[side];
        if (!f) f = feet[side] = { pos: world(rest), from: world(rest), to: world(rest), swing: false, yaw: yawWorld, landingEvent: false };
        if (moving && u < 0.4) {
          if (!f.swing) { f.from = [...f.pos]; f.swing = true; f.landingEvent = !repair && (oldU >= 0.4 || u < oldU); }
          // Predict only the landing target, never the actor's placement. Swing travels in host motion direction.
          const ahead = vScale(velocity, (0.4 - u) / cadence + stride / Math.max(speed, 0.01));
          f.to = vAdd(world(rest), ahead);
          const t = u / 0.4, smooth = t * t * (3 - 2 * t);
          f.pos = vLerp(f.from, f.to, smooth); f.pos[1] = position[1] + rig.ankleHeight * scale + Math.sin(Math.PI * t) * 0.12 * k * scale;
          f.yaw = yawWorld;
        } else if (f.swing && dt > 0) {
          const floor = position[1] + rig.ankleHeight * scale;
          if (moving) {
            f.pos = [...f.to]; f.pos[1] = floor; f.swing = false;
            if (f.landingEvent && oldU < 0.4 && !repair) events.push({ type: 'footstep', side, position: [f.pos[0], position[1], f.pos[2]] });
          } else {
            // Idle owns explicit flat contacts: settle an interrupted swing without inventing footsteps.
            f.pos = approach(f.pos, [f.pos[0], floor, f.pos[2]], dt * 0.8 * k * scale);
            f.swing = Math.abs(f.pos[1] - floor) > 1e-6;
          }
        }
        let target = local(f.pos);
        // A host discontinuity or unsupported long stance is repaired silently, not reported as a landing.
        if (Math.hypot(target[0] - rest[0], target[2] - rest[2]) > rig.legLength * 0.55 || Math.abs(target[1] - rig.ankleHeight) > 0.2 * k && !f.swing) {
          f.pos = world(rest); f.from = [...f.pos]; f.to = [...f.pos]; f.swing = false; f.yaw = yawWorld; target = rest;
        }
        targets[side] = target;
        contacts[side] = { planted: !f.swing && state !== 'dead', position: [...f.pos] };
      }
      let P = fkPositions(H, { joints: worldToPose(W), root });
      // Lower the pelvis enough for exact planted endpoints; finite length-preserving IK then owns both legs.
      let drop = 0;
      for (const side of SIDES) {
        const A = P[side + 'UpperLeg'], T = targets[side], L = rig.len[side + 'UpperLeg'] + rig.len[side + 'LowerLeg'];
        drop = Math.max(drop, A[1] - T[1] - Math.sqrt(Math.max(0, (L * 0.998) ** 2 - (A[0] - T[0]) ** 2 - (A[2] - T[2]) ** 2)));
      }
      root[1] -= Math.min(0.18 * k, Math.max(0, drop));
      P = fkPositions(H, { joints: worldToPose(W), root });
      for (const side of SIDES) {
        const ul = side + 'UpperLeg', ll = side + 'LowerLeg', foot = side + 'Foot';
        const solved = solveTwoBone(P[ul], targets[side], rig.len[ul], rig.len[ll], [0, 0.15, 1]);
        const upper = qAlignFrames(rig.dir[ul], rig.axes[ll], vNorm(vSub(solved.mid, P[ul])), solved.bendNormal);
        W[ul] = upper;
        W[ll] = qMul(qFromTo(qRotate(upper, rig.dir[ll]), vNorm(vSub(solved.end, solved.mid))), upper);
        W[foot] = ry(wrapAngle(feet[side].yaw - yawWorld)); W[side + 'Toes'] = W[foot];
        if (Math.hypot(...vSub(solved.end, targets[side])) > 0.003 / scale) contacts[side].planted = false;
      }
      P = fkPositions(H, { joints: worldToPose(W), root });
      const clearance = target => {
        // Conservative wrist envelope only, not garment/object collision or a physical grasp solve.
        const b = ['upperChest', 'chest', 'spine', 'hips'].find(n => target[1] >= P[n][1]) ?? 'hips';
        const p = vAdd(H[b], qRotate(qConj(W[b]), vSub(target, P[b]))), e = [0, 0, 0];
        if (!torsoAt(torso, p[1], e)) return target;
        const a = e[0] + 0.035 * k, d = e[1] + 0.035 * k, z = p[2] - e[2];
        const r = Math.hypot(p[0] / a, z / d);
        if (r >= 1) return target;
        const out = r > 1e-5 ? [p[0] / r, p[1], e[2] + z / r] : [0, p[1], e[2] + d];
        return vAdd(P[b], qRotate(W[b], vSub(out, H[b])));
      };
      for (const [side, sign] of [['left', 1], ['right', -1]]) {
        const sh = side + 'Shoulder', ua = side + 'UpperArm', la = side + 'LowerArm', hand = side + 'Hand';
        W[sh] = qMul(W.upperChest, rz(sign * breath * (side === 'left' ? 1 : 0.6)));
        const upperPos = vAdd(P[sh], qRotate(W[sh], vSub(H[ua], H[sh])));
        const gunOffset = side === 'right' ? [-0.12 * k, -recoil * 0.025 * k, (0.29 - recoil * 0.09) * k] : [-.084 * k, (-.01 - recoil * .025) * k, (.335 - recoil * .09) * k];
        const idleTarget = vAdd(upperPos, [sign * 0.06 * k, -rig.armLength * 0.9, 0.06 * k + Math.sin(phase * TAU + (sign > 0 ? Math.PI : 0)) * move * 0.10 * k]);
        const combatTarget = vLerp(vAdd(origin, qRotate(aimQ, gunOffset)), [sign * 0.12 * k, H.hips[1] + 0.17 * k, 0.25 * k], reloadWeight);
        let target = clearance(vLerp(idleTarget, combatTarget, combatWeight));
        // Wrist frame is NOT a gun frame: +Z fingers run DOWN the grip, +Y is dorsal.
        // Standard native grip conversion makes the pistol upright (+Y up), not canted
        // 90 degrees with its barrel along the knuckles. Idle barrel points down safely.
        const idleQ = qFrameZY([0, 0, -1], [sign, 0, 0]);
        let handFrame = qSlerp(idleQ, qFrameZY(qRotate(aimQ, [0, -1, 0]), qRotate(aimQ, [sign, 0, 0])), combatWeight * (1 - reloadWeight * 0.5));
        if (!wrists[side]) wrists[side] = { pos: idleTarget, quat: idleQ };
        const wrist = wrists[side];
        target = clearance(approach(wrist.pos, target, dt * 2.8 * k)); handFrame = turn(wrist.quat, handFrame, dt * 5);
        wrist.pos = [...target]; wrist.quat = handFrame;
        const solved = solveTwoBone(upperPos, target, rig.len[ua], rig.len[la], [sign * 0.6, -1, -0.25]);
        const upper = qAlignFrames(rig.dir[ua], rig.axes[la], vNorm(vSub(solved.mid, upperPos)), solved.bendNormal);
        W[ua] = upper;
        W[la] = qMul(qFromTo(qRotate(upper, rig.dir[la]), vNorm(vSub(solved.end, solved.mid))), upper);
        W[hand] = qMul(handFrame, qConj(rig.hands[side].frame.q));
        const restFingers = Object.fromEntries(Object.entries(rig.hands[side].fingers).map(([n, f]) => [n, { ...f.rest, curl: 0, src: 'rest' }]));
        const grasp = side === 'left' ? supportFingers : state === 'attack' && recoil > .5 ? firingFingers : gripFingers;
        const curls = blendFingerStates(restFingers, grasp, side === 'right' ? .92 + combatWeight * .08 : combatWeight);
        Object.assign(W, fingerWorldDeltas(rig.hands[side], side, curls, W[hand]));
      }
      const fall = death * death * (3 - 2 * death), angle = fall * Math.PI / 2, pelvisY = H.hips[1];
      const offsetY = (pelvisY * (1 - fall) + 0.12 * k * fall) - Math.cos(angle) * pelvisY;
      const pose = { joints: worldToPose(W), root };
      const actual = fkPositions(H, pose);
      const output = {
        pose, tilt: [angle, 0, 0], offset: [0, offsetY, -Math.sin(angle) * pelvisY],
        state, phase: (phase % 1) * TAU, moving: move, death: fall, recoil, combatWeight, contacts,
        events: events.filter(e => contacts[e.side].planted),
        // FK includes pose.root. This is an authored hand FRAME, not a raw bone-local rotation.
        grip: { position: actual.rightHand, quaternion: qMul(W.rightHand, rig.hands.right.frame.q) },
      };
      if (death === 1) settled = output;
      return output;
    },
  };
}
