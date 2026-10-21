// Physics adapter for cannon-es (the bottle demo). Implements the interface in ../host/physics.js on a CANNON.World
// the game owns, plus step(dt) for the game loop: a fixed-step world.step, removals deferred to the end of the step,
// then contact reports, then onStep listeners. This is the only GameSystems module that imports cannon-es (a demo test
// fails otherwise). Requires the game to provide `cannon-es` (the sync script copies this file next to the game's
// node_modules).
import * as CANNON from 'cannon-es';
import { vec, quat } from '../host/physics.js';

// world: allowSleep / friction / restitution are applied to the world (passed in or the default one) when given.
export const CANNON_DEFAULTS = Object.freeze({ fixedStep: 1 / 120, maxSubSteps: 8, maxDt: 0.08, contactSpeed: 0.45 });

function makeShape(s) {
  switch (s.type) {
    case 'box': { const [x, y, z] = vec(s.size, [1, 1, 1]); return new CANNON.Box(new CANNON.Vec3(Math.max(1e-3, x / 2), Math.max(1e-3, y / 2), Math.max(1e-3, z / 2))); }
    case 'sphere': return new CANNON.Sphere(s.radius);
    // cannon-es cylinders are Y-up and centred, like three.js CylinderGeometry.
    case 'cylinder': return new CANNON.Cylinder(s.radius, s.radiusBottom ?? s.radius, s.height, s.segments ?? 10);
    default: throw new TypeError(`Unknown physics shape type: ${s?.type}`);
  }
}

function setPose(body, pose) {
  if (!pose) return;
  if (pose.position) body.position.set(...vec(pose.position));
  if (pose.quaternion) body.quaternion.set(...quat(pose.quaternion));
}

const xyz = v => [v.x, v.y, v.z];

export function createCannonPhysics(world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) }), options = {}) {
  const cfg = { ...CANNON_DEFAULTS, ...options };
  if (cfg.allowSleep !== undefined) world.allowSleep = cfg.allowSleep;
  if (cfg.friction !== undefined) world.defaultContactMaterial.friction = cfg.friction;
  if (cfg.restitution !== undefined) world.defaultContactMaterial.restitution = cfg.restitution;
  const handles = new Map(); // CANNON.Body -> handle (bodies created through addBody)
  const contactListeners = new Set(), stepListeners = new Set();
  const contacts = [], removals = new Set();
  const inverse = new CANNON.Quaternion(), local = new CANNON.Vec3();
  let stepping = false;
  const alive = handle => handles.get(handle?.body) === handle;

  function onCollide(handle, e) {
    if (!contactListeners.size || !alive(handle)) return;
    const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (speed < cfg.contactSpeed) return;
    // Copy plain values: cannon reuses its contact objects after this callback.
    const body = handle.body, selfIsA = e.contact.bi === body, r = selfIsA ? e.contact.ri : e.contact.rj, n = e.contact.ni, sign = selfIsA ? 1 : -1;
    const p = body.position, normal = [n.x * sign, n.y * sign, n.z * sign];
    body.quaternion.conjugate(inverse);
    const localPoint = xyz(inverse.vmult(r, local));
    const localNormal = xyz(inverse.vmult(new CANNON.Vec3(...normal), local));
    const otherMass = e.body.mass || Infinity, selfMass = body.mass || Infinity;
    const reduced = Number.isFinite(otherMass) ? (Number.isFinite(selfMass) ? selfMass * otherMass / (selfMass + otherMass) : otherMass) : selfMass;
    contacts.push({ a: handle, b: handles.get(e.body) ?? null, speed, point: [p.x + r.x, p.y + r.y, p.z + r.z], normal, localPoint, localNormal,
      velocity: xyz(body.velocity), spin: xyz(body.angularVelocity), otherMass, impulse: Number.isFinite(reduced) ? speed * reduced : 0,
      surface: e.body.userData?.surface ?? null });
  }

  const adapter = {
    world, CANNON,
    get stepping() { return stepping; },

    addBody(shape, mass = 0, pose = {}, { userData = {}, linearDamping = 0.12, angularDamping = 0.18, group, mask, sleepTimeLimit,
      velocity, spin, contacts: report = true } = {}) {
      const body = new CANNON.Body({ mass, linearDamping, angularDamping });
      // Map per-body surface coefficients to Cannon's multiplicative combination: sqrt(muA * muB).
      body.material = new CANNON.Material({ friction: Math.sqrt(Math.max(0, cfg.friction ?? world.defaultContactMaterial.friction)), restitution: -1 });
      if (sleepTimeLimit !== undefined) body.sleepTimeLimit = sleepTimeLimit;
      if (group !== undefined) body.collisionFilterGroup = group;
      if (mask !== undefined) body.collisionFilterMask = mask;
      for (const s of Array.isArray(shape) ? shape : [shape])
        body.addShape(makeShape(s), new CANNON.Vec3(...vec(s.offset)), s.orientation ? new CANNON.Quaternion(...quat(s.orientation)) : undefined);
      setPose(body, pose);
      if (velocity) body.velocity.set(...vec(velocity));
      if (spin) body.angularVelocity.set(...vec(spin));
      body.userData = userData;
      const handle = { body, mass, userData };
      if (report) body.addEventListener('collide', e => onCollide(handle, e));
      handles.set(body, handle);
      world.addBody(body);
      return handle;
    },

    pose(handle, out = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }) {
      const { position: p, quaternion: q } = handle.body;
      out.position[0] = p.x; out.position[1] = p.y; out.position[2] = p.z;
      out.quaternion[0] = q.x; out.quaternion[1] = q.y; out.quaternion[2] = q.z; out.quaternion[3] = q.w;
      return out;
    },

    velocity(handle, out = { linear: [0, 0, 0], angular: [0, 0, 0] }) {
      const { velocity: v, angularVelocity: w } = handle.body;
      out.linear[0] = v.x; out.linear[1] = v.y; out.linear[2] = v.z;
      out.angular[0] = w.x; out.angular[1] = w.y; out.angular[2] = w.z;
      return out;
    },

    /** Kept for release while held; applied now when dynamic (only when it changed by more than a gram). */
    setMass(handle, mass) {
      if (!alive(handle)) return;
      handle.mass = mass;
      const b = handle.body;
      if (b.type === CANNON.Body.DYNAMIC && Math.abs(b.mass - mass) > 0.001) { b.mass = mass; b.updateMassProperties(); }
    },

    /** Kinematic: teleports to the target pose each call (cannon would integrate a kinematic velocity past it). */
    hold(handle, target) {
      if (!alive(handle)) return;
      const b = handle.body;
      if (b.type !== CANNON.Body.KINEMATIC) { b.type = CANNON.Body.KINEMATIC; b.mass = 0; b.updateMassProperties(); }
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      setPose(b, target);
      b.wakeUp();
    },

    release(handle, velocity, spin) {
      if (!alive(handle)) return;
      const b = handle.body;
      b.type = CANNON.Body.DYNAMIC;
      b.mass = handle.mass ?? 0.5;
      b.updateMassProperties();
      b.velocity.set(...vec(velocity));
      b.angularVelocity.set(...vec(spin));
      b.wakeUp();
    },

    isHeld: handle => handle.body.type === CANNON.Body.KINEMATIC,

    /** Optional capability: material friction; contact coefficient is the geometric mean of both surfaces. */
    setFriction(handle, coefficient) {
      if (!Number.isFinite(coefficient) || coefficient < 0) throw new RangeError('friction must be finite and nonnegative');
      if (!alive(handle)) return;
      handle.body.material.friction = Math.sqrt(coefficient);
      handle.body.wakeUp();
    },

    // ---- optional ragdoll capability (extensions/hitreact ragdoll-driver.js; not part of the host interface)
    //   addJoint(a, b, { pivotA, pivotB, axisA, axisB, angle, twistAngle, maxForce?, collideConnected? }) -> joint
    //       a cone/twist joint; pivots and axes in each body's local frame, angle = cone half-angle, twistAngle (rad)
    //   removeJoint(joint); applyImpulse(handle, impulse, point?) world N·s at a world point (default: the centre)
    //   applyTorque(handle, torque) world N·m for the next internal step (call it from onPreStep)
    //   setDamping(handle, linear, angular); onPreStep(cb) -> unsubscribe, cb(fixedStep) before every internal step
    addJoint(a, b, { pivotA, pivotB, axisA, axisB, angle = 0, twistAngle = 0, maxForce = 1e6, collideConnected = false } = {}) {
      if (!alive(a) || !alive(b)) return null;
      const v = x => new CANNON.Vec3(...vec(x));
      const constraint = new CANNON.ConeTwistConstraint(a.body, b.body, { pivotA: v(pivotA), pivotB: v(pivotB), axisA: v(axisA ?? [0, 1, 0]),
        axisB: v(axisB ?? [0, 1, 0]), angle, twistAngle, maxForce, collideConnected });
      world.addConstraint(constraint);
      return { constraint };
    },
    removeJoint(joint) { if (joint?.constraint) { world.removeConstraint(joint.constraint); joint.constraint = null; } },
    applyImpulse(handle, impulse, point = null) {
      if (!alive(handle)) return;
      const b = handle.body, [x, y, z] = vec(impulse), rel = point ? vec(point) : [b.position.x, b.position.y, b.position.z];
      b.applyImpulse(new CANNON.Vec3(x, y, z), new CANNON.Vec3(rel[0] - b.position.x, rel[1] - b.position.y, rel[2] - b.position.z));
    },
    applyTorque(handle, torque) {
      if (!alive(handle)) return;
      const [x, y, z] = vec(torque);
      handle.body.torque.x += x; handle.body.torque.y += y; handle.body.torque.z += z;
    },
    setDamping(handle, linear, angular) {
      if (!alive(handle)) return;
      if (Number.isFinite(linear)) handle.body.linearDamping = linear;
      if (Number.isFinite(angular)) handle.body.angularDamping = angular;
    },
    onPreStep(cb) {
      const listener = () => { try { cb(cfg.fixedStep); } catch (error) { console.error('Physics preStep listener failed', error); } };
      world.addEventListener('preStep', listener);
      return () => world.removeEventListener('preStep', listener);
    },

    onContact(cb) { contactListeners.add(cb); return () => contactListeners.delete(cb); },
    onStep(cb) { stepListeners.add(cb); return () => stepListeners.delete(cb); },

    remove(handle) {
      if (!alive(handle)) return;
      const b = handle.body;
      handles.delete(b);
      if (stepping) removals.add(b); else world.removeBody(b);
    },

    /** Fixed-step world update; then deferred removals, then contact reports, then onStep listeners. */
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Physics dt must be finite and nonnegative');
      if (dt === 0) return;
      stepping = true;
      try { world.step(cfg.fixedStep, Math.min(dt, cfg.maxDt), cfg.maxSubSteps); } finally {
        stepping = false;
        for (const body of removals) world.removeBody(body);
        removals.clear();
      }
      if (contacts.length) {
        const batch = contacts.splice(0);
        for (const c of batch) {
          if (!alive(c.a)) continue; // removed by an earlier report
          for (const cb of [...contactListeners]) {
            try { cb(c); } catch (error) { console.error('Physics contact listener failed', error); }
          }
        }
      }
      for (const cb of [...stepListeners]) {
        try { cb(dt); } catch (error) { console.error('Physics step listener failed', error); }
      }
    },
  };
  return adapter;
}
