// GameSystems avatar extension: procedural crawl for NPCs that cannot walk (a leg gone, a broken body). Pure (arrays),
// driven by createNPCAnimator when input.gait === 'crawl'; usable on its own (createCrawlGait) by any game.
//
// The body lies prone (hips pitched forward about the pelvis, chest raised, head up toward the aim point). Usable arms
// pull: a hand swings ahead of its shoulder, plants on the floor (world-fixed while planted, like the walk's feet) and
// the body drags past it, the arm following through two-bone IK. Two arms alternate; one arm pulls alone (the host
// decides how much slower). Usable legs drag and shove weakly, timed against the pulling arm. No arms and no legs:
// helpless, writhing in place. Getting there: begin(fromPose) blends from the last standing pose over `fallSeconds`
// (a fall forward, arms out to catch). Dead while crawling: the head drops, the arms go slack.
//
//   const crawl = createCrawlGait(rig, { crawl: { ...CRAWL_DEFAULTS overrides } })
//   crawl.begin({ W, root })   optional: the standing pose to fall from (world joint deltas + pose root)
//   crawl.update({ position, yaw, scale, speed, moving, limbs, aimYaw, aimPitch, dead }, dt)
//     -> { W, root, down, dead, phase, moving, contacts, events }
//   limbs: { leftArm, rightArm, leftLeg, rightLeg } (false = gone or unusable; default all true)
//   contacts: { leftHand, rightHand, left, right } each { planted, position (world) }
//   events: { type: 'handplant', side, position (world) } when a swinging hand lands
// Host placement stays authoritative: the crawl never moves `position`, it plants hands in the world around it.
import { solveTwoBone } from './twobone.js';
import { fkPositions, worldToPose } from '../humanoid/index.js';
import { fingerStateFromCurls, fingerWorldDeltas, blendFingerStates } from './fingers.js';
import { clamp, smoothstep, lp, ry, rx, rz, qMul, qConj, qRotate, qFromTo, qFrameZY, qAlignFrames, qSlerp, vAdd, vSub, vNorm, vScale, vLerp } from './qx.js';

const TAU = Math.PI * 2, SIDES = [['left', 1], ['right', -1]], ID = [0, 0, 0, 1];

/** Tunables. Lengths are shares of the rig's arm length or metres on the neutral body (scaled with eye height). */
export const CRAWL_DEFAULTS = Object.freeze({
  pitch: 1.38,        // body pitch when prone (rad, about the pelvis; PI/2 = flat)
  arch: 0.5,          // how far the chest rises over the pelvis (rad, spread over spine / chest / upper chest)
  headLift: 1.0,      // head pitched back up toward the target (rad)
  fallSeconds: 0.9,   // standing -> prone
  swing: 0.34,        // share of an arm cycle spent reaching forward (the rest is the planted pull)
  reach: 0.62,        // where a hand plants ahead of its shoulder (share of the arm length)
  stride: 0.42,       // body travel per pull (share of the arm length)
  hipsHeight: 0.12,   // pelvis above the floor when prone (m, neutral body)
});

export function createCrawlGait(initialRig, options = {}) {
  const cfg = { ...CRAWL_DEFAULTS, ...(options.crawl ?? {}) };
  let rig = initialRig, phase = 0, clock = 0, down = 1, dead = 0, move = 0, hands = {}, previous = null, from = null;
  const relaxed = fingerStateFromCurls({ thumb: 0.3, index: 0.25, middle: 0.3, ring: 0.35, little: 0.4 });
  const claw = fingerStateFromCurls({ thumb: 0.25, index: 0.45, middle: 0.5, ring: 0.5, little: 0.55 });
  const fingers = (side, state, weight) => {
    const rest = Object.fromEntries(Object.entries(rig.hands[side].fingers).map(([n, fi]) => [n, { ...fi.rest, curl: 0, src: 'rest' }]));
    return blendFingerStates(rest, state, weight);
  };
  return {
    get down() { return down; },
    setRig(next) { rig = next; hands = {}; },
    reset() { phase = clock = dead = move = 0; down = 1; hands = {}; previous = null; from = null; },
    /** Start a fall from a standing pose ({W, root}); without one the crawl starts prone. */
    begin(pose = null) { from = pose?.W ? { W: { ...pose.W }, root: [...(pose.root ?? [0, 0, 0])] } : null; down = from ? 0 : 1; dead = 0; hands = {}; },
    update(input = {}, dt = 0) {
      dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
      const H = rig.H, k = rig.eyeHeight / 1.553, scale = input.scale > 0 ? input.scale : 1;
      const position = input.position?.length >= 3 && input.position.slice(0, 3).every(Number.isFinite) ? input.position.slice(0, 3) : [0, 0, 0];
      const yawWorld = Number.isFinite(input.yaw) ? input.yaw : 0;
      const world = p => vAdd(position, vScale(qRotate(ry(yawWorld), p), scale));
      const local = p => vScale(qRotate(ry(-yawWorld), vSub(p, position)), 1 / scale);
      const limbs = { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true, ...(input.limbs ?? {}) };
      const arms = SIDES.filter(([s]) => limbs[`${s}Arm`]).length, legs = SIDES.filter(([s]) => limbs[`${s}Leg`]).length;
      const helpless = !arms && !legs;
      clock += dt;
      down = Math.min(1, down + dt / Math.max(cfg.fallSeconds, 1e-3));
      dead = input.dead ? Math.min(1, dead + dt / 0.7) : 0;
      const fall = smoothstep(0, 1, down), slack = smoothstep(0, 1, dead);
      const speed = clamp(Math.abs(Number(input.speed) || 0), 0, 3) / scale;
      const moving = !!input.moving && speed > 0.005 && !input.dead && !helpless && down >= 1;
      move += ((moving ? 1 : 0) - move) * lp(dt, 0.15);
      const armLen = rig.len.leftUpperArm + rig.len.leftLowerArm;
      // a pull covers `stride` during the planted part of the cycle; legs only: shorter shoves
      const stride = cfg.stride * armLen * (arms ? 1 : 0.45);
      const cadence = moving ? speed * (1 - cfg.swing) / stride : 0;
      const oldPhase = phase;
      phase += cadence * dt;
      if (previous && Math.hypot(...vSub(position, previous)) > 0.5 * scale) hands = {};
      previous = position;
      const velocity = qRotate(ry(yawWorld), [0, 0, speed * scale]);

      // ---- trunk: prone, arched, rolling into each pull; head up toward the target
      const pull = arms === 2 ? Math.sin(phase * TAU) : arms === 1 ? (limbs.leftArm ? 1 : -1) * Math.max(0, Math.sin(phase * TAU)) : 0;
      const writhe = helpless ? Math.sin(clock * 1.7) * (1 - slack) : 0;
      const roll = 0.08 * pull * move * (1 - slack) + 0.14 * writhe;
      const arch = cfg.arch * (1 - 0.65 * slack) * (arms ? 1 : 0.55);
      const twist = ry(0.07 * pull * move);
      const aimYaw = clamp(Number(input.aimYaw) || 0, -0.9, 0.9) * (1 - slack), aimPitch = clamp(Number(input.aimPitch) || 0, -0.6, 0.6);
      const pitch = cfg.pitch;
      const W = {
        hips: qMul(rz(roll * 0.6), rx(pitch)),
        spine: qMul(twist, qMul(rz(roll * 0.8), rx(pitch - arch * 0.3))),
        chest: qMul(twist, qMul(rz(roll), rx(pitch - arch * 0.65))),
        upperChest: qMul(twist, qMul(rz(roll), rx(pitch - arch))),
      };
      const headUp = (cfg.headLift + 0.25 * writhe + aimPitch * 0.5) * (1 - slack) - 0.3 * slack;
      W.neck = qMul(ry(aimYaw * 0.5), rx(pitch - arch - headUp * 0.5));
      W.head = qMul(ry(aimYaw), rx(pitch - arch - headUp));
      // pelvis on the floor, slid back so the chest lies over the host position; it surges with each pull
      const surge = arms ? 0.02 * k * Math.sin(phase * TAU * arms) * move : 0.015 * k * Math.sin(phase * TAU) * move;
      const root = [0, cfg.hipsHeight * k - H.hips[1] + Math.abs(surge) * 0.5, -0.3 * k + surge];
      let P = fkPositions(H, { joints: worldToPose(W), root });

      // ---- arms: planted hands in the world, two-bone IK from the shoulder
      const contacts = {}, events = [];
      const floorY = position[1] + 0.03 * k * scale;
      for (const [side, sign] of SIDES) {
        const sh = side + 'Shoulder', ua = side + 'UpperArm', la = side + 'LowerArm', hand = side + 'Hand';
        W[sh] = W.upperChest;
        const upperPos = vAdd(P[sh], qRotate(W[sh], vSub(H[ua], H[sh])));
        const ahead = [upperPos[0] + sign * 0.04 * k, 0, upperPos[2] + cfg.reach * armLen];
        const restWorld = () => { const p = world(ahead); p[1] = floorY; return p; };
        let target, planted = false, swinging = false;
        if (!limbs[`${side}Arm`]) {
          // stump (the host hides what is gone): lies along the body
          target = [upperPos[0] + sign * 0.16 * k, 0.04 * k, upperPos[2] - 0.12 * k];
          delete hands[side];
        } else {
          const offset = arms === 2 && side === 'right' ? 0.5 : 0;
          const u = ((phase + offset) % 1 + 1) % 1, oldU = ((oldPhase + offset) % 1 + 1) % 1;
          let h = hands[side];
          if (!h) h = hands[side] = { pos: restWorld(), from: null, to: null, swing: false };
          if (slack > 0) {
            // dying: the hand slides out to the side and lies there
            const out = world([upperPos[0] + sign * 0.2 * k, 0, upperPos[2] + 0.2 * armLen]); out[1] = floorY;
            h.pos = vLerp(h.pos, out, lp(dt, 0.35)); h.swing = false;
          } else if (moving && u < cfg.swing) {
            if (!h.swing) { h.from = [...h.pos]; h.swing = true; }
            // land where the shoulder will be `reach` behind when the hand comes down
            h.to = vAdd(restWorld(), vScale(velocity, (cfg.swing - u) / Math.max(cadence, 1e-3)));
            h.to[1] = floorY;
            const t = u / cfg.swing, s = t * t * (3 - 2 * t);
            h.pos = vLerp(h.from, h.to, s); h.pos[1] = floorY + Math.sin(Math.PI * t) * 0.1 * k * scale;
            swinging = true;
          } else {
            if (h.swing) {
              h.pos = [...h.to]; h.swing = false;
              if (oldU < cfg.swing) events.push({ type: 'handplant', side, position: [...h.pos] });
            } else if (!moving) {
              // idle, falling or helpless: a hand stretched far from its rest spot drifts back
              const far = Math.hypot(...vSub(local(h.pos), ahead));
              if (far > 0.2 * armLen || down < 1) h.pos = vLerp(h.pos, restWorld(), lp(dt, down < 1 ? 0.05 : 0.35));
            }
            planted = down >= 1;
          }
          target = local(h.pos);
          // a hand left out of reach (host teleport, turning on the spot) is re-planted silently
          if (!swinging && Math.hypot(...vSub(target, upperPos)) > armLen * 1.1) { h.pos = restWorld(); target = local(h.pos); }
        }
        const solved = solveTwoBone(upperPos, target, rig.len[ua], rig.len[la], [sign * 0.8, 0.7, -0.3]);
        const upper = qAlignFrames(rig.dir[ua], rig.axes[la], vNorm(vSub(solved.mid, upperPos)), solved.bendNormal);
        W[ua] = upper;
        W[la] = qMul(qFromTo(qRotate(upper, rig.dir[la]), vNorm(vSub(solved.end, solved.mid))), upper);
        // palm down, fingers forward and a little inward; a swinging hand tips its fingers down
        const frame = qFrameZY(vNorm([-sign * 0.3, swinging ? -0.45 : -0.08, 1]), [0, 1, 0]);
        W[hand] = qMul(frame, qConj(rig.hands[side].frame.q));
        Object.assign(W, fingerWorldDeltas(rig.hands[side], side, fingers(side, swinging || slack ? relaxed : claw, 0.9), W[hand]));
        contacts[hand] = {
          planted: !!limbs[`${side}Arm`] && planted && Math.hypot(...vSub(solved.end, target)) < 0.005,
          position: world(solved.end),
        };
      }

      // ---- legs: drag behind; a usable leg draws its knee up and shoves against the opposite arm's pull
      P = fkPositions(H, { joints: worldToPose(W), root });
      for (const [side, sign] of SIDES) {
        const ul = side + 'UpperLeg', ll = side + 'LowerLeg', foot = side + 'Foot', toes = side + 'Toes';
        const L = rig.len[ul] + rig.len[ll], hip = P[ul];
        let target;
        if (!limbs[`${side}Leg`]) target = [hip[0] + sign * 0.03 * k, 0.1 * k, hip[2] - L];
        else {
          const v = ((phase + (side === 'left' ? 0.5 : 0)) % 1 + 1) % 1;
          const shove = (arms ? 0.4 : 1) * move * Math.max(0, Math.sin(v * TAU));
          const kick = !arms ? 0.12 * Math.max(0, Math.sin(clock * 2.3 + (sign > 0 ? 0 : 2))) * (1 - slack) * (helpless ? 1 : 1 - move) : 0;
          const drawUp = (0.3 * shove + kick) * L;
          target = [hip[0] + sign * (0.06 + 0.08 * shove) * k, 0.075 * k + 0.05 * k * shove, hip[2] - L * 0.96 + drawUp];
        }
        const solved = solveTwoBone(hip, target, rig.len[ul], rig.len[ll], [sign, -0.2, 0]);
        const upper = qAlignFrames(rig.dir[ul], rig.axes[ll], vNorm(vSub(solved.mid, hip)), solved.bendNormal);
        W[ul] = upper;
        W[ll] = qMul(qFromTo(qRotate(upper, rig.dir[ll]), vNorm(vSub(solved.end, solved.mid))), upper);
        // instep on the floor, toes pointing back (foot plantar-flexed relative to the shin)
        W[foot] = qMul(W[ll], rx(1.1));
        W[toes] = W[foot];
        contacts[side] = { planted: down >= 1 && !!limbs[`${side}Leg`], position: world(solved.end) };
      }

      // ---- the fall: blend from the standing pose (pelvis drops while the body pitches over)
      let outRoot = root;
      if (from && fall < 1) {
        for (const j of new Set([...Object.keys(W), ...Object.keys(from.W)])) W[j] = qSlerp(from.W[j] ?? ID, W[j] ?? ID, fall);
        const drop = smoothstep(0.15, 1, down);
        outRoot = [from.root[0] + (root[0] - from.root[0]) * fall, from.root[1] + (root[1] - from.root[1]) * drop, from.root[2] + (root[2] - from.root[2]) * fall];
        for (const c of Object.values(contacts)) c.planted = false;
      } else from = null;
      return { W, root: outRoot, down: fall, dead: slack, phase: (phase % 1) * TAU, moving: move, contacts, events: events.filter(e => contacts[e.side + 'Hand']?.planted) };
    },
  };
}
