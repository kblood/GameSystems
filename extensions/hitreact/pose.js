// GameSystems hitreact extension: applies a reaction frame (reaction.js update()) to a canonical humanoid pose. Pure
// (no three.js, plain arrays). Pose format: humanoid canonical.js ({ joints: parent-relative quaternions in the character
// frame, root }). H: rest joint heads in the character frame (character.restHeads()).
//
//   applyReaction(pose, H, frame, cfg) -> pose      chain offsets, pelvis offset, IK knockdown, planted feet, balance step
//   blendPoses(a, b, t) -> pose                     per-joint world slerp + root lerp (t = 0: a, 1: b)
//   solveLeg(hip, target, upper, lower, pole)       analytic two-bone IK (law of cosines)
//
// The chain offsets are rotations about each joint's head, expressed in the character frame; a joint's rotation carries
// everything below it (the spine's offset turns the chest, the arms and the head). The pelvis offset moves pose.root.
// The feet stay where the animation put them (two-bone leg IK from the moved hips) unless a balance step carries one.
import { JOINTS, poseToWorld, worldToPose, fkPositions, qMul, qAxisAngle, qRotate, qFromTo, qSlerp, qIdentity, vAdd, vSub, vScale, vLen, vNorm, vDot, vLerp } from '../humanoid/index.js';

const SIDES = ['left', 'right'];
const DEPTH = (() => { const d = {}; for (const [j, p] of JOINTS) d[j] = p ? d[p] + 1 : 0; return d; })();

/** Axis-angle vector [ax, ay, az] (angle = length) -> quaternion. */
export function rotationVector(v) {
  const a = vLen(v);
  return a < 1e-9 ? qIdentity() : qAxisAngle([v[0] / a, v[1] / a, v[2] / a], a);
}

/**
 * Two-bone IK: hip (root), target, bone lengths, pole (preferred knee direction). Returns { mid, end, reach } with end ==
 * target when reachable (else the closest point on the hip -> target line). Never NaN.
 */
export function solveLeg(hip, target, upper, lower, pole, fallbackPole = [0, 0, 1]) {
  const a = Math.max(upper, 1e-6), b = Math.max(lower, 1e-6), d0 = vSub(target, hip);
  let dist = vLen(d0);
  const dir = dist > 1e-9 ? vScale(d0, 1 / dist) : [0, -1, 0];
  const d = Math.min(Math.max(dist, Math.abs(a - b) + 1e-4), (a + b) * 0.9999);
  const reject = p => vSub(p, vScale(dir, vDot(p, dir)));
  let p = reject(pole);
  if (vLen(p) < 1e-4) p = reject(fallbackPole);
  if (vLen(p) < 1e-6) p = reject(Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  p = vNorm(p);
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const mid = vAdd(hip, vAdd(vScale(dir, a * cosA), vScale(p, a * sinA)));
  return { mid, end: vAdd(hip, vScale(dir, d)), reach: dist / (a + b) };
}

/** j and every joint below it. */
function subtreeOf(j) {
  const out = [], kids = new Map();
  for (const [n, p] of JOINTS) if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }
  const walk = n => { out.push(n); for (const c of kids.get(n) ?? []) walk(c); };
  walk(j);
  return out;
}
const SUBTREE = Object.fromEntries(JOINTS.map(([j]) => [j, subtreeOf(j)]));
function turn(W, j, q) { for (const n of SUBTREE[j]) W[n] = qMul(q, W[n]); }

/** Leg lengths from the rest heads. */
export function legLengths(H, side) {
  return [vLen(vSub(H[`${side}LowerLeg`], H[`${side}UpperLeg`])), vLen(vSub(H[`${side}Foot`], H[`${side}LowerLeg`]))];
}

/**
 * The animated pose with the reaction on top. frame: reaction update() output. cfg: the resolved config (downed.drop /
 * pitch for the IK knockdown, feet.plant). Returns a new pose; the input is not changed. An idle frame returns the input.
 */
export function applyReaction(pose, H, frame, cfg) {
  if (!frame?.active) return pose;
  const joints = pose.joints ?? {}, root0 = pose.root ?? [0, 0, 0];
  const W0 = poseToWorld(joints), W = { ...W0 };
  // IK knockdown (no ragdoll): the trunk slumps forward over bent knees (+X rotation pitches forward)
  const c = frame.collapse > 0 ? frame.collapse * frame.collapse * (3 - 2 * frame.collapse) : 0;
  if (c > 0) {
    const pitch = cfg.downed.pitch * c;
    turn(W, 'spine', qAxisAngle([1, 0, 0], pitch * 0.45));
    turn(W, 'chest', qAxisAngle([1, 0, 0], pitch * 0.3));
    turn(W, 'neck', qAxisAngle([1, 0, 0], pitch * 0.25));
  }
  // chain offsets, parents first (a parent's turn carries its children)
  const chain = Object.keys(frame.offsets ?? {}).filter(j => j in DEPTH).sort((a, b) => DEPTH[a] - DEPTH[b]);
  for (const j of chain) turn(W, j, rotationVector(frame.offsets[j]));
  const root = vAdd(root0, frame.root ?? [0, 0, 0]);
  if (c > 0) { root[1] -= cfg.downed.drop * c; root[2] -= 0.06 * c; }

  // planted feet: the ankles go back to where the animation had them (plus a balance step), two-bone IK from the hips
  if (cfg.feet?.plant !== false && H.leftFoot && H.rightFoot) {
    const P0 = fkPositions(H, pose), P = fkPositions(H, { joints: worldToPose(W), root });
    for (const side of SIDES) {
      const ul = `${side}UpperLeg`, ll = `${side}LowerLeg`, ft = `${side}Foot`;
      if (!(ul in P) || !(ll in P) || !(ft in P)) continue;
      let target = P0[ft];
      if (frame.step?.side === side) target = vAdd(target, frame.step.offset);
      const [lu, lo] = legLengths(H, side), hip = P[ul], knee = P[ll], ankle = P[ft];
      // the knee keeps bending the way it bends now; a straight leg bends forward
      const pole = vSub(knee, vScale(vAdd(hip, ankle), 0.5));
      const s = solveLeg(hip, target, lu, lo, vLen(pole) > 1e-3 ? vAdd(vNorm(pole), [0, 0, 0.25]) : [0, 0, 1]);
      const fixUpper = qFromTo(vNorm(vSub(knee, hip)), vNorm(vSub(s.mid, hip)));
      const lowerNow = qRotate(fixUpper, vNorm(vSub(ankle, knee)));
      const fixLower = qFromTo(lowerNow, vNorm(vSub(s.end, s.mid)));
      W[ul] = qMul(fixUpper, W[ul]);
      W[ll] = qMul(fixLower, qMul(fixUpper, W[ll]));
      // the foot keeps its animated orientation (flat on the floor); toes follow it
      for (const n of SUBTREE[ft]) W[n] = W0[n];
    }
  }
  return { ...pose, joints: worldToPose(W), root };
}

/** Per-joint world slerp and root lerp between two poses (t = 0: a, t = 1: b). */
export function blendPoses(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const Wa = poseToWorld(a.joints), Wb = poseToWorld(b.joints), W = {};
  for (const [j] of JOINTS) W[j] = qSlerp(Wa[j], Wb[j], t);
  return { ...b, joints: worldToPose(W), root: vLerp(a.root ?? [0, 0, 0], b.root ?? [0, 0, 0], t) };
}
