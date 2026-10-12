import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehiclePhysicsAdapter, VEHICLE_COLLISION_BOUNDS } from '../../extensions/vehicle/index.js';

const flatContact = () => ({ distanceM: 0.50 });

test('vehicle physics: clear chassis sweep preserves the requested pose and settles wheel suspension', () => {
  const rays = [];
  const physics = createVehiclePhysicsAdapter({
    sweepChassis: query => {
      assert.equal(query.from.position[1], 0.78);
      assert.equal(query.to.position[1], 0.78);
      assert.deepEqual(query.halfExtentsM, [1.14, 0.78, 2.41]);
      return null;
    },
    raycastWheel: query => { rays.push(query); return flatContact(); },
  });
  const result = physics.resolve(
    { position: [0, 0, 0], heading: 0 },
    { position: [2, 0, -1], heading: 0.1 },
    1 / 60,
  );
  assert.deepEqual(result.pose, { position: [2, 0, -1], heading: 0.1 });
  assert.equal(result.motionFraction, 1);
  assert.equal(result.collided, false);
  assert.equal(rays.length, 4);
  assert.ok(rays.every(ray => Math.abs(ray.maxDistanceM - 0.58) < 1e-9));
  assert.ok(rays.every(ray => Math.abs(ray.origin[1] - 0.50) < 1e-9));
  assert.ok(rays.every(ray => Math.abs(Math.hypot(ray.origin[0] - 2, ray.origin[2] + 1) - Math.hypot(0.917, 1.41)) < 1e-9));
  for (const compression of Object.values(result.suspension.compressionM)) {
    assert.ok(compression > 0 && compression < 0.08);
  }
  assert.equal(result.suspension.groundedWheels, 4);
});

test('vehicle physics: chassis sweep stops before an obstruction with collision skin', () => {
  const physics = createVehiclePhysicsAdapter({
    sweepChassis: () => ({ fraction: 0.5, normal: [0, 0, 2] }),
    raycastWheel: () => null,
  });
  const result = physics.resolve(
    { position: [0, 0, 0], heading: 0 },
    { position: [1, 0, 0], heading: 0 },
    1 / 60,
  );
  assert.ok(Math.abs(result.pose.position[0] - 0.485) < 1e-9);
  assert.deepEqual(result.collisionNormal, [0, 0, 1]);
  assert.equal(result.collided, true);
  assert.equal(result.suspension.groundedWheels, 0);
});

test('vehicle physics: collision bounds follow the authored car proportions and invalid host contacts fail clearly', () => {
  assert.deepEqual(VEHICLE_COLLISION_BOUNDS.halfExtentsM, [1.14, 0.78, 2.41]);
  assert.throws(() => createVehiclePhysicsAdapter({ sweepChassis: () => null }), /callbacks are required/);
  const badSweep = createVehiclePhysicsAdapter({ sweepChassis: () => ({ fraction: 1.1, normal: [0, 1, 0] }), raycastWheel: () => null });
  assert.throws(() => badSweep.resolve({ position: [0, 0, 0], heading: 0 }, { position: [1, 0, 0], heading: 0 }, 0.016), /within \[0, 1\]/);
  const physics = createVehiclePhysicsAdapter({ sweepChassis: () => null, raycastWheel: () => ({ distanceM: -1 }) });
  assert.throws(() => physics.resolve({ position: [0, 0, 0], heading: 0 }, { position: [0, 0, 0], heading: 0 }, 0.016), /nonnegative/);
});

test('vehicle physics: raised left-front terrain lifts and pitches the body with right-hand signs', () => {
  const physics = createVehiclePhysicsAdapter({
    sweepChassis: () => null,
    raycastWheel: ({ wheel }) => ({ distanceM: wheel === 'frontLeft' ? 0.40 : 0.50 }),
  });
  const result = physics.resolve(
    { position: [0, 0, 0], heading: 0 },
    { position: [0, 0, 0], heading: 0 },
    0.5,
  );
  assert.ok(result.suspension.bodyOffsetM > 0, 'compression raises the chassis');
  assert.ok(result.suspension.pitchRad < 0, 'compressed front pitches nose-up around +X');
  assert.ok(result.suspension.rollRad < 0, 'compressed left side rolls upward around +Z');
});

test('vehicle physics: failed wheel query does not partially advance suspension state', () => {
  let fail = true;
  const physics = createVehiclePhysicsAdapter({
    sweepChassis: () => null,
    raycastWheel: ({ wheel }) => {
      if (fail && wheel === 'frontRight') throw new Error('temporary terrain query failure');
      return { distanceM: wheel === 'frontLeft' ? 0.40 : 0.50 };
    },
  });
  const args = [
    { position: [0, 0, 0], heading: 0 },
    { position: [0, 0, 0], heading: 0 },
    0.016,
  ];
  assert.throws(() => physics.resolve(...args), /temporary terrain query failure/);
  fail = false;
  const retried = physics.resolve(...args);
  const fresh = createVehiclePhysicsAdapter({
    sweepChassis: () => null,
    raycastWheel: ({ wheel }) => ({ distanceM: wheel === 'frontLeft' ? 0.40 : 0.50 }),
  }).resolve(...args);
  assert.deepEqual(retried.suspension.compressionM, fresh.suspension.compressionM);
});

test('vehicle physics: terrain below full extension is not reported as wheel contact', () => {
  const physics = createVehiclePhysicsAdapter({
    sweepChassis: () => null,
    raycastWheel: () => ({ distanceM: 0.70 }),
  });
  const result = physics.resolve(
    { position: [0, 0, 0], heading: 0 },
    { position: [0, 0, 0], heading: 0 },
    1 / 60,
  );
  assert.equal(result.suspension.groundedWheels, 0);
  assert.deepEqual(Object.values(result.suspension.compressionM), [0, 0, 0, 0]);
});
