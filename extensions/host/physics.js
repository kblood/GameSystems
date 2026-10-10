// Physics adapter interface. Extensions never import a physics engine; they get ctx.physics, which the game builds
// from its engine (GameSystems/extensions/adapters/physics-cannon.js for the demo; Contracts brings its own). The bottles
// extension runs on nothing but this interface (its tests use an engine-free fake adapter).
//
//   addBody(shape, mass, pose, options?) -> handle
//       shape: { type: 'box', size: [x, y, z] } | { type: 'sphere', radius }
//              | { type: 'cylinder', radius, height, radiusBottom?, segments? }   (Y-up, centred, like three.js)
//              each with optional offset: [x, y, z] and orientation: [x, y, z, w] in the body frame;
//              or an array of shapes (compound body).
//       mass 0 = static. pose: { position, quaternion } (arrays or {x,y,z(,w)}); the body origin is pose.position.
//       options: { userData, linearDamping = 0.12, angularDamping = 0.18, sleepTimeLimit (s, engine default),
//                  group, mask (collision filter bits; bottles 4, shards 2 colliding with 1 | 4, static world 1),
//                  velocity, spin (initial linear / angular velocity), contacts = true (false: never report contacts
//                  for this body; cheap static geometry and debris) }
//       userData.surface names the material other bodies report when they hit it ('concrete', 'wood', 'glass', …).
//   pose(handle, out?) -> { position: [x, y, z], quaternion: [x, y, z, w] }
//   velocity(handle, out?) -> { linear: [x, y, z], angular: [x, y, z] }   world space, m/s and rad/s (0 while held)
//   setMass(handle, mass)            new dynamic mass (liquid drained); while held it is kept for release
//   hold(handle, target)             target pose; the body follows it kinematically until release
//   release(handle, velocity?, spin?) back to dynamic with linear velocity (m/s) and angular velocity (rad/s), world space
//   isHeld(handle) -> boolean        between hold and release
//   onContact(cb) -> unsubscribe     contact reports, delivered after the physics step (never during it); a body may
//                                    get several per step (per contact point and substep) while the approach speed
//                                    exceeds the adapter's threshold (cannon: 0.45 m/s):
//       cb({ a, b, speed, point, normal, localPoint?, localNormal?, velocity?, spin?, otherMass?, impulse?, surface })
//         a            the adapter body the report is for; b the other adapter body or null (engine-only geometry)
//         speed        approach speed along the normal (m/s, > 0)
//         point        world contact point on a; normal: world normal pointing out of a towards the other body
//         localPoint   point in a's body frame at contact time; localNormal: normal in a's body frame (optional: derived
//                      from pose() after the step when missing)
//         velocity     a's linear velocity at contact time; spin: a's angular velocity (optional: velocity() after the step)
//         otherMass    mass of the other body (Infinity for static, kinematic or unknown)
//         impulse      normal impulse (N·s); an estimate when the engine reports none (cannon: speed × reduced mass)
//         surface      the other body's userData.surface, or null
//   onStep(cb) -> unsubscribe        cb(dt) after every step, after its contact reports (game-loop dt the step consumed);
//                                    the place to read poses and react to contacts (Godot: _physics_process)
//   remove(handle)                   safe during a step and from listeners (deferred to the end of the step); further
//                                    hold/release/setMass on a removed handle are ignored
//
// Vectors are world space, metres and radians. Handles are opaque; only the adapter reads them.
// The game owns stepping (cannon adapter: step(dt)); it is not part of the interface extensions see.

export const PHYSICS_METHODS = Object.freeze(['addBody', 'pose', 'velocity', 'setMass', 'hold', 'release', 'isHeld', 'onContact', 'onStep', 'remove']);

/** Throws a TypeError naming the missing methods; returns the adapter otherwise. */
export function assertPhysicsAdapter(adapter) {
  const missing = PHYSICS_METHODS.filter(name => typeof adapter?.[name] !== 'function');
  if (missing.length) throw new TypeError(`Physics adapter is missing: ${missing.join(', ')}`);
  return adapter;
}

/** Reads [x, y, z] / {x, y, z} (and w for quaternions) into a plain array. */
export function vec(value, fallback = [0, 0, 0]) {
  if (!value) return [...fallback];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value).slice(0, fallback.length);
  return fallback.length === 4 ? [value.x ?? 0, value.y ?? 0, value.z ?? 0, value.w ?? 1] : [value.x ?? 0, value.y ?? 0, value.z ?? 0];
}
export const quat = value => vec(value, [0, 0, 0, 1]);
