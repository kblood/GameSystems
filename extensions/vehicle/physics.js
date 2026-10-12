import { finite, positive, vector, clamp } from '../host/system.js';

export const VEHICLE_COLLISION_BOUNDS = Object.freeze({
  halfExtentsM: Object.freeze([1.14, 0.78, 2.41]),
});

const WHEELS = Object.freeze([
  ['frontLeft', -1, 1], ['frontRight', 1, 1],
  ['rearLeft', -1, -1], ['rearRight', 1, -1],
]);

function pose(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} pose required`);
  return { position: vector(value.position, `${label}.position`), heading: finite(value.heading, `${label}.heading`) };
}

function criticallyDamped(position, velocity, target, omega, dt) {
  const offset = position - target;
  const decay = Math.exp(-omega * dt);
  const temporary = (velocity + omega * offset) * dt;
  return {
    position: target + (offset + temporary) * decay,
    velocity: (velocity - omega * temporary) * decay,
  };
}

/**
 * Build a small host-driven chassis contact adapter. The host supplies only two
 * physics queries: a swept box for chassis travel and a downward ray for each
 * wheel. The adapter resolves safe travel and computes damped wheel compression,
 * body heave, pitch and roll without depending on a particular physics engine.
 */
export function createVehiclePhysicsAdapter({
  sweepChassis,
  raycastWheel,
  wheelbaseM = 2.82,
  trackWidthM = 1.834,
  wheelRadiusM = 0.34,
  suspensionRestLengthM = 0.24,
  suspensionTravelM = 0.18,
  staticSagM = 0.08,
  springFrequencyHz = 8,
  collisionSkinM = 0.015,
  halfExtentsM = VEHICLE_COLLISION_BOUNDS.halfExtentsM,
  chassisCenterOffsetM = [0, 0.78, 0],
} = {}) {
  if (typeof sweepChassis !== 'function' || typeof raycastWheel !== 'function')
    throw new TypeError('sweepChassis and raycastWheel callbacks are required');
  wheelbaseM = positive(wheelbaseM, 'wheelbaseM');
  trackWidthM = positive(trackWidthM, 'trackWidthM');
  wheelRadiusM = positive(wheelRadiusM, 'wheelRadiusM');
  suspensionRestLengthM = positive(suspensionRestLengthM, 'suspensionRestLengthM');
  suspensionTravelM = positive(suspensionTravelM, 'suspensionTravelM');
  staticSagM = positive(staticSagM, 'staticSagM', true);
  if (staticSagM > suspensionTravelM) throw new RangeError('staticSagM exceeds suspension travel');
  springFrequencyHz = positive(springFrequencyHz, 'springFrequencyHz');
  collisionSkinM = positive(collisionSkinM, 'collisionSkinM', true);
  halfExtentsM = vector(halfExtentsM, 'halfExtentsM');
  if (halfExtentsM.some(value => value <= 0)) throw new RangeError('Chassis half extents must be positive');
  chassisCenterOffsetM = vector(chassisCenterOffsetM, 'chassisCenterOffsetM');

  const omega = 2 * Math.PI * springFrequencyHz;
  const compression = Object.fromEntries(WHEELS.map(([name]) => [name, 0]));
  const velocity = Object.fromEntries(WHEELS.map(([name]) => [name, 0]));

  function resolve(fromValue, desiredValue, dtValue) {
    const from = pose(fromValue, 'from');
    const desired = pose(desiredValue, 'desired');
    const dt = positive(dtValue, 'dt', true);
    if (dt > 1) throw new RangeError('Vehicle physics step exceeds one-second budget');

    const requested = desired.position.map((value, index) => value - from.position[index]);
    const requestedDistance = Math.hypot(...requested);
    let fraction = 1, collisionNormal = null;
    const boxPose = value => {
      const cos = Math.cos(value.heading), sin = Math.sin(value.heading);
      const [x, y, z] = chassisCenterOffsetM;
      return { position: [value.position[0] + x * cos + z * sin, value.position[1] + y, value.position[2] - x * sin + z * cos], heading: value.heading };
    };
    const hit = sweepChassis({
      from: boxPose(from),
      to: boxPose(desired),
      halfExtentsM: [...halfExtentsM],
    });
    if (hit != null) {
      if (!hit || typeof hit !== 'object') throw new TypeError('Chassis sweep must return null or a hit object');
      fraction = finite(hit.fraction, 'collision fraction');
      if (fraction < 0 || fraction > 1) throw new RangeError('collision fraction must be within [0, 1]');
      collisionNormal = vector(hit.normal, 'collision normal');
      const normalLength = Math.hypot(...collisionNormal);
      if (normalLength < 1e-8) throw new RangeError('Collision normal cannot be zero');
      collisionNormal = collisionNormal.map(value => value / normalLength);
      if (requestedDistance > 0) fraction = Math.max(0, fraction - collisionSkinM / requestedDistance);
    }

    const actual = {
      position: from.position.map((value, index) => value + requested[index] * fraction),
      heading: from.heading + (desired.heading - from.heading) * fraction,
    };
    const suspensionOriginM = suspensionRestLengthM + wheelRadiusM;
    const compressionTargets = {};
    const nextCompression = {};
    const nextVelocity = {};
    const contacts = [];
    let groundedWheels = 0;
    const castOriginM = suspensionOriginM - staticSagM;
    for (const [name, side, axle] of WHEELS) {
      const localX = side * trackWidthM * 0.5;
      const localZ = axle * wheelbaseM * 0.5;
      const cos = Math.cos(actual.heading), sin = Math.sin(actual.heading);
      const origin = [
        actual.position[0] + localX * cos + localZ * sin,
        actual.position[1] + castOriginM,
        actual.position[2] - localX * sin + localZ * cos,
      ];
      const contact = raycastWheel({
        wheel: name,
        origin,
        // The current model covers compression and the authored static sag,
        // but does not simulate additional wheel droop below full extension.
        maxDistanceM: suspensionOriginM,
      });
      contacts.push({ name, contact });
    }
    for (const { name, contact } of contacts) {
      let target = 0;
      if (contact != null) {
        if (!contact || typeof contact !== 'object') throw new TypeError(`Wheel ray ${name} must return null or a hit`);
        const distance = positive(contact.distanceM, `${name}.distanceM`, true);
        if (distance <= suspensionOriginM) groundedWheels++;
        target = clamp(suspensionOriginM - distance, 0, suspensionTravelM);
      }
      compressionTargets[name] = target;
      const filtered = criticallyDamped(compression[name], velocity[name], target, omega, dt);
      nextCompression[name] = clamp(filtered.position, 0, suspensionTravelM);
      nextVelocity[name] = filtered.velocity;
    }

    Object.assign(compression, nextCompression);
    Object.assign(velocity, nextVelocity);

    const avg = names => names.reduce((sum, name) => sum + compression[name], 0) / names.length;
    const front = avg(['frontLeft', 'frontRight']);
    const rear = avg(['rearLeft', 'rearRight']);
    const left = avg(['frontLeft', 'rearLeft']);
    const right = avg(['frontRight', 'rearRight']);
    const mean = avg(WHEELS.map(([name]) => name));
    return {
      pose: actual,
      motionFraction: fraction,
      collided: hit != null,
      collisionNormal,
      suspension: {
        staticSagM,
        compressionM: { ...compression },
        targetCompressionM: compressionTargets,
        bodyOffsetM: mean - staticSagM,
        pitchRad: Math.atan((rear - front) / wheelbaseM),
        rollRad: Math.atan((right - left) / trackWidthM),
        groundedWheels,
      },
    };
  }

  function reset() {
    for (const [name] of WHEELS) {
      compression[name] = 0;
      velocity[name] = 0;
    }
  }

  return { resolve, reset };
}
