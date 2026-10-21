// GameSystems hitreact extension: the active ragdoll's body plan and math. Pure (no three.js, no physics engine; plain
// arrays in the character frame). The engine side is ragdoll-driver.js (on a physics adapter with the ragdoll
// capability, e.g. extensions/adapters/physics-cannon.js).
//
// Port of the idea of NightfallContractsGodot addons/nightfall_characters/active_ragdoll.gd (docs/ACTIVE_RAGDOLL_EXPERIMENT.md):
// eleven rigid segments (pelvis, chest, head, upper/lower arms and legs) with capsule colliders, ten cone/twist joints,
// no self-collision, a 4.5 N·s shot impulse on the hit segment, joint-space muscles with bounded torques that pull the
// segments toward the continuing animation, and the physical states standing / destabilized / downed / recovering /
// inert. Differences: here the ragdoll only owns the body while 'downed' or 'inert' (the IK reaction handles standing and
// destabilized), 'recovering' blends back to the animated pose instead of a physical get-up, the pelvis segment reaches
// up to the upper chest (no gap in the trunk), and knees / elbows are cone/twist joints centred on a half-bent pose
// (cannon-es hinges have no limits), so they can bend sideways inside the cone.
import { JOINTS, poseToWorld, worldToPose, fkPositions, qMul, qConj, qRotate, qFromTo, qAxisAngle, qNormalize, vAdd, vSub, vScale, vLen, vNorm, vCross, DEG } from '../humanoid/index.js';

/** The 11 segments: [key, head joint, tip joint (null: head + 0.2 m up), parent segment, mass kg, capsule radius m, region]. */
export const RAGDOLL_SEGMENTS = Object.freeze([
  ['hips', 'hips', 'upperChest', null, 14, 0.12, 'pelvis'],
  ['upperChest', 'upperChest', 'head', 'hips', 18, 0.135, 'chest'],
  ['head', 'head', null, 'upperChest', 4, 0.105, 'head'],
  ...['left', 'right'].flatMap(s => [
    [`${s}UpperArm`, `${s}UpperArm`, `${s}LowerArm`, 'upperChest', 2.2, 0.065, `${s}UpperArm`],
    [`${s}LowerArm`, `${s}LowerArm`, `${s}Hand`, `${s}UpperArm`, 1.5, 0.052, `${s}LowerArm`],
    [`${s}UpperLeg`, `${s}UpperLeg`, `${s}LowerLeg`, 'hips', 7, 0.078, `${s}UpperLeg`],
    [`${s}LowerLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}UpperLeg`, 4, 0.06, `${s}LowerLeg`],
  ]),
].map(([key, joint, tip, parent, mass, radius, region]) => Object.freeze({ key, joint, tip, parent, mass, radius, region })));
export const SEGMENT = Object.freeze(Object.fromEntries(RAGDOLL_SEGMENTS.map(s => [s.key, s])));

/**
 * The 10 joints (one per non-root segment): cone half-angle and twist half-angle (rad) and where the cone is centred:
 * the child's rest direction bent by `mid` rad forward (+Z) or backward. From the Nightfall NPC profile
 * (ragdoll_joint_profile.gd limits(): flex / abduction / twist ranges, made symmetric around their middle).
 */
const J = (child, cone, twist, mid = 0, bend = 'forward', torque = 60) => Object.freeze({ child, parent: SEGMENT[child].parent, cone: cone * DEG, twist: twist * DEG, mid: mid * DEG, bend, torque });
export const RAGDOLL_JOINTS = Object.freeze([
  J('upperChest', 50, 40, 20, 'forward', 120),
  J('head', 40, 60, 0, 'forward', 30),
  ...['left', 'right'].flatMap(s => [
    J(`${s}UpperArm`, 80, 60, 32, 'forward', 80),
    J(`${s}LowerArm`, 70, 10, 55, 'forward', 40),
    J(`${s}UpperLeg`, 62, 30, 47, 'forward', 1000),
    J(`${s}LowerLeg`, 65, 10, 50, 'backward', 400),
  ]),
]);

/** Nightfall's shot impulse (active_ragdoll.gd apply_bullet): N·s. */
export const SHOT_IMPULSE = 4.5;

/** Region (gore ids, canonical joints, guard zones) -> the segment a hit lands on. */
export function segmentForRegion(region = 'chest') {
  const r = String(region), side = /^left/i.test(r) ? 'left' : /^right/i.test(r) ? 'right' : null;
  if (/head|cranium|jaw|neck/i.test(r)) return 'head';
  if (side && /upperarm|shoulder/i.test(r)) return `${side}UpperArm`;
  if (side && /lowerarm|hand/i.test(r)) return `${side}LowerArm`;
  if (side && /upperleg/i.test(r)) return `${side}UpperLeg`;
  if (side && /lowerleg|foot|toes/i.test(r)) return `${side}LowerLeg`;
  if (/pelvis|hips|belly|spine|leg|limb/i.test(r)) return 'hips';
  return 'upperChest';
}

/** Solid-cylinder transverse moment of a segment (kg m^2; Nightfall's inertia estimate). */
export const segmentInertia = (mass, radius, length) => mass * (3 * radius * radius + length * length) / 12;

/** Rest geometry per segment (character frame): head a, direction d0, length, centre c0, rest body rotation q0 (+Y = axis). */
export function restSegments(H) {
  const out = {};
  for (const s of RAGDOLL_SEGMENTS) {
    const a = H[s.joint];
    if (!a) continue;
    const b = s.tip && H[s.tip] ? H[s.tip] : vAdd(a, [0, 0.2, 0]);
    const length = Math.max(vLen(vSub(b, a)), 1e-3), d0 = vScale(vSub(b, a), 1 / length);
    out[s.key] = { ...s, a, d0, length, c0: vScale(vAdd(a, b), 0.5), q0: qFromTo([0, 1, 0], d0), inertia: segmentInertia(s.mass, s.radius, length) };
  }
  return out;
}

/** Posed segment frames (character frame): { key: { center, quaternion } } for a canonical pose. */
export function segmentFrames(H, pose, rest = restSegments(H)) {
  const W = poseToWorld(pose.joints), P = fkPositions(H, pose), out = {};
  for (const [key, r] of Object.entries(rest)) {
    const w = W[r.joint];
    out[key] = { center: vAdd(P[r.joint], qRotate(w, vSub(r.c0, r.a))), quaternion: qNormalize(qMul(w, r.q0)) };
  }
  return out;
}

/** Bends a direction by `angle` toward +Z (forward) or -Z (backward). */
function bent(d, angle, bend) {
  if (!angle) return d;
  const n = vCross(d, bend === 'backward' ? [0, 0, -1] : [0, 0, 1]);
  return vLen(n) < 1e-6 ? d : vNorm(qRotate(qAxisAngle(vNorm(n), angle), d));
}

/**
 * Joint frames for the physics constraints, in each body's local frame (body +Y = the segment axis): pivotA / pivotB
 * (the child's joint head, from the posed frames) and axisA / axisB (the cone axis: the child's rest direction bent to
 * the cone's centre, pose-independent). scale: the character's world scale.
 */
export function jointFrames(H, pose, frames, rest = restSegments(H), scale = 1) {
  const P = fkPositions(H, pose), out = [];
  for (const j of RAGDOLL_JOINTS) {
    const A = rest[j.parent], B = rest[j.child], fa = frames[j.parent], fb = frames[j.child];
    if (!A || !B || !fa || !fb) continue;
    const pivot = P[B.joint];
    out.push({
      ...j,
      pivotA: vScale(qRotate(qConj(fa.quaternion), vSub(pivot, fa.center)), scale),
      pivotB: vScale(qRotate(qConj(fb.quaternion), vSub(pivot, fb.center)), scale),
      axisA: vNorm(qRotate(qConj(A.q0), bent(B.d0, j.mid, j.bend))),
      axisB: [0, 1, 0],
    });
  }
  return out;
}

/**
 * Canonical pose from segment frames (character frame { center, quaternion }), on top of `base` (the animated pose: it
 * gives every joint that is not a segment its parent-relative rotation: hands, feet, fingers, shoulders). The joints inside
 * a segment turn with it (spine and chest with the pelvis segment, the neck with the chest segment).
 * Segments missing from `frames` (a severed limb) keep the base rotation relative to their parent.
 */
export function poseFromSegments(H, frames, base, rest = restSegments(H)) {
  const over = {};
  for (const [key, f] of Object.entries(frames)) if (rest[key]) over[rest[key].joint] = qNormalize(qMul(f.quaternion, qConj(rest[key].q0)));
  // the pelvis segment is rigid from the hips to the upper chest, the chest segment from there to the head: the joints
  // inside a segment turn with it, so the skeleton's joint heads land on the physics pivots
  if (over.hips) over.spine = over.chest = over.hips;
  if (over.upperChest) over.neck = over.upperChest;
  const joints = base?.joints ?? {}, D = {};
  for (const [j, p] of JOINTS) D[j] = over[j] ?? (p ? qMul(D[p], joints[j] ?? [0, 0, 0, 1]) : joints[j] ?? [0, 0, 0, 1]);
  let root = base?.root ?? [0, 0, 0];
  if (frames.hips && rest.hips) {
    const hipsHead = vSub(frames.hips.center, qRotate(D.hips, vSub(rest.hips.c0, rest.hips.a)));
    root = vSub(hipsHead, H.hips);
  }
  return { ...base, joints: worldToPose(D), root };
}

/** Axis-angle vector of the shortest rotation taking a to b (both unit quaternions): b * conj(a). */
export function rotationError(a, b) {
  let q = qMul(b, qConj(a));
  if (q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
  const s = Math.hypot(q[0], q[1], q[2]);
  if (s < 1e-9) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, q[3]);
  return [q[0] / s * angle, q[1] / s * angle, q[2] / s * angle];
}

/**
 * A muscle: the bounded PD torque (world, N·m) that turns a segment from `current` toward `target` (world quaternions),
 * against its angular velocity relative to the parent. inertia kg m^2, frequency Hz (0 = slack), damping ratio, max N·m.
 */
export function muscleTorque(current, target, relativeSpin, inertia, frequency, damping, maxTorque) {
  if (!(frequency > 0) || !(maxTorque > 0)) return [0, 0, 0];
  const w = 2 * Math.PI * frequency, e = rotationError(current, target);
  const t = vScale(vSub(vScale(e, w * w), vScale(relativeSpin, 2 * damping * w)), inertia);
  const l = vLen(t);
  return l > maxTorque ? vScale(t, maxTorque / l) : t;
}

/**
 * When a downed ragdoll may recover: after minDownedSeconds once every segment has stayed slower than settleSpeed for
 * settleSeconds, or after maxDownedSeconds regardless. update(dt, maxSegmentSpeed) -> true when it is time.
 */
export function createDownedMonitor(cfg) {
  let time = 0, still = 0;
  return {
    reset() { time = still = 0; },
    get time() { return time; },
    update(dt, maxSpeed) {
      time += dt;
      still = maxSpeed < cfg.settleSpeed ? still + dt : 0;
      return (time >= cfg.minDownedSeconds && still >= cfg.settleSeconds) || time >= cfg.maxDownedSeconds;
    },
  };
}
