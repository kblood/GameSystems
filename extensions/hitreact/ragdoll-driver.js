// GameSystems hitreact extension: the active ragdoll on a physics adapter. Engine-free: it only calls the host physics
// interface (extensions/host/physics.js: addBody, pose, velocity, remove) plus the optional ragdoll capability
// (addJoint, removeJoint, applyImpulse, applyTorque, setDamping, onPreStep), which extensions/adapters/physics-cannon.js
// implements on cannon-es. Bodies exist only while the ragdoll is active (downed / inert): nothing is simulated for a
// standing enemy.
//
//   const rd = createRagdollDriver(physics, cfg.ragdoll)
//   rd.activate({ frames, joints, rest, scale, velocity, skip, muscles })   frames: world { center, quaternion } per segment
//   rd.setTargets(worldQuaternions)   animation targets per segment (world): the muscles pull toward them while downed
//   rd.read() -> { key: { center, quaternion } } (world);  rd.maxSpeed() -> m/s;  rd.applyImpulse(key, impulse, point)
//   rd.setMuscles(scale) (0 = a passive corpse);  rd.deactivate()
import { qMul, qConj, qNormalize, vSub } from '../humanoid/index.js';
import { RAGDOLL_JOINTS, muscleTorque } from './ragdoll.js';

// Twist limits are off: a cone/twist joint measures twist from tangents its engine picks per axis, which do not line up
// with the body plan's neutral pose, so a limit would fight the rest pose. Angular damping and the muscles hold the roll.
const TWIST_FREE = Math.PI;

export const RAGDOLL_METHODS = Object.freeze(['addBody', 'pose', 'velocity', 'remove', 'addJoint', 'removeJoint', 'applyImpulse', 'applyTorque', 'onPreStep']);
/** True when the adapter can run the ragdoll (host interface + the ragdoll capability). */
export const supportsRagdoll = physics => RAGDOLL_METHODS.every(m => typeof physics?.[m] === 'function');

/** Capsule as adapter shapes (Y axis): a cylinder with a sphere on each end; a short segment is one sphere. */
export function capsuleShapes(radius, length) {
  const half = length / 2 - radius;
  if (half <= 0.01) return [{ type: 'sphere', radius: Math.max(radius, length / 2) }];
  return [{ type: 'cylinder', radius, height: 2 * half, segments: 8 }, { type: 'sphere', radius, offset: [0, half, 0] }, { type: 'sphere', radius, offset: [0, -half, 0] }];
}

export function createRagdollDriver(physics, cfg) {
  if (!supportsRagdoll(physics)) throw new TypeError(`hitreact ragdoll: the physics adapter lacks ${RAGDOLL_METHODS.filter(m => typeof physics?.[m] !== 'function').join(', ')}`);
  const bodies = new Map(), joints = [], targets = new Map(), inertia = new Map();
  let unsubscribe = null, muscles = 0;
  const poseOut = () => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }), velOut = () => ({ linear: [0, 0, 0], angular: [0, 0, 0] });
  const scratchA = poseOut(), scratchB = poseOut(), velA = velOut(), velB = velOut();

  function preStep() {
    if (!(muscles > 0) || !targets.size) return;
    for (const j of RAGDOLL_JOINTS) {
      const child = bodies.get(j.child), parent = bodies.get(j.parent), tc = targets.get(j.child), tp = targets.get(j.parent);
      if (!child || !parent || !tc || !tp) continue;
      const qc = physics.pose(child, scratchA).quaternion, qp = physics.pose(parent, scratchB).quaternion;
      // joint space: the child's target relative to the parent's target, carried by the parent as it is now
      const goal = qNormalize(qMul(qp, qMul(qConj(tp), tc)));
      const spin = vSub(physics.velocity(child, velA).angular, physics.velocity(parent, velB).angular);
      const torque = muscleTorque(qc, goal, spin, inertia.get(j.child), cfg.muscleFrequency, 1, j.torque * muscles);
      physics.applyTorque(child, torque);
      physics.applyTorque(parent, [-torque[0], -torque[1], -torque[2]]);
    }
  }

  const api = {
    get active() { return bodies.size > 0; },
    get bodies() { return bodies; },
    get jointCount() { return joints.length; },
    /**
     * Creates the segments at their world frames and joins them. rest: restSegments(H); joints: jointFrames(...) (local
     * pivots / axes); scale: world scale of the character; velocity: initial world velocity of every segment; skip: keys
     * not to build (severed limbs); muscles: share of the standing torques (0: passive).
     */
    activate({ frames, joints: frameJoints, rest, scale = 1, velocity = [0, 0, 0], skip = new Set(), muscles: m = 0 }) {
      api.deactivate();
      for (const [key, f] of Object.entries(frames)) {
        const r = rest[key];
        if (!r || skip.has(key)) continue;
        const handle = physics.addBody(capsuleShapes(r.radius * scale, r.length * scale), r.mass, { position: f.center, quaternion: f.quaternion },
          { group: cfg.group, mask: cfg.mask, linearDamping: cfg.linearDamping, angularDamping: cfg.angularDamping, velocity, contacts: false, userData: { ragdoll: key } });
        bodies.set(key, handle);
        inertia.set(key, r.inertia * scale * scale);
      }
      for (const j of frameJoints) {
        const a = bodies.get(j.parent), b = bodies.get(j.child);
        if (!a || !b) continue;
        const joint = physics.addJoint(a, b, { pivotA: j.pivotA, pivotB: j.pivotB, axisA: j.axisA, axisB: j.axisB, angle: j.cone, twistAngle: TWIST_FREE });
        if (joint) joints.push(joint);
      }
      api.setMuscles(m);
      unsubscribe = physics.onPreStep(preStep);
      return api;
    },
    setTargets(world) { for (const [k, q] of Object.entries(world)) targets.set(k, q); },
    setMuscles(scale) {
      muscles = Math.max(0, scale);
      if (typeof physics.setDamping === 'function') for (const h of bodies.values()) physics.setDamping(h, cfg.linearDamping, muscles > 0 ? cfg.angularDamping : cfg.corpseAngularDamping);
    },
    read(out = {}) {
      for (const [k, h] of bodies) {
        const p = physics.pose(h);
        out[k] = { center: p.position, quaternion: p.quaternion };
      }
      return out;
    },
    maxSpeed() {
      let max = 0;
      for (const h of bodies.values()) { const v = physics.velocity(h, velA).linear; max = Math.max(max, Math.hypot(v[0], v[1], v[2])); }
      return max;
    },
    applyImpulse(key, impulse, point = null) {
      const h = bodies.get(key) ?? bodies.get('upperChest') ?? bodies.values().next().value;
      if (h) physics.applyImpulse(h, impulse, point);
      return !!h;
    },
    deactivate() {
      unsubscribe?.(); unsubscribe = null;
      for (const j of joints.splice(0)) physics.removeJoint(j);
      for (const h of bodies.values()) physics.remove(h);
      bodies.clear(); targets.clear(); inertia.clear();
    },
  };
  return api;
}
