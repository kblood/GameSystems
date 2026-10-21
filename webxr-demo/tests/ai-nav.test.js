// ai extension, navigation: the grid navmesh (paths around boxes, string pulling, partial paths, re-bakes) and the
// movement intent on top of it (an agent walks a path around a wall and never steps into a blocked cell).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavGrid, pathLength, createZombieBrain, stepBody } from '../../extensions/ai/index.js';
import { level, run, vrPlayer, segmentHitsBox } from './ai-fixture.js';

const bounds = { minX: -5, minZ: -10, maxX: 5, maxZ: 4 };
const wall = { min: [-3, 0, -2.2], max: [3, 1.2, -1.8] };

test('grid: a path goes around a wall with few corners and stays on walkable ground', () => {
  const nav = createNavGrid({ bounds, boxes: [wall] });
  const from = { x: 0, y: 0, z: -5 }, to = { x: 0, y: 0, z: 1 }, path = [];
  assert.equal(nav.walkable(0, -2), false); assert.equal(nav.walkable(0, -2.4), false, 'inflated by the agent radius');
  assert.equal(nav.findPath(from, to, path), true);
  assert.ok(path.length >= 2 && path.length <= 4, `string-pulled: ${path.length} corners`);
  let prev = from;
  for (const c of path) { assert.ok(nav.segmentClear(prev, c), 'each leg is a clear straight walk'); assert.ok(!segmentHitsBox({ ...prev, y: 0.5 }, { ...c, y: 0.5 }, wall)); prev = c; }
  assert.ok(Math.hypot(prev.x - to.x, prev.z - to.z) < 0.01);
  const len = pathLength(from, path);
  assert.ok(len > 6.5 && len < 10, `around the wall end (${len.toFixed(2)} m)`);
  // the same query twice gives the same path (deterministic, scratch reused)
  const again = [];
  nav.findPath(from, to, again);
  assert.deepEqual(again.map(p => [p.x, p.z]), path.map(p => [p.x, p.z]));
});

test('grid: open line is one corner; low boxes are stepped over, high ones walked under; unreachable goals give partial paths', () => {
  const nav = createNavGrid({ bounds, boxes: [{ min: [-1, 0, -1], max: [1, 0.2, 1] }, { min: [-1, 2.2, 2], max: [1, 2.6, 3] }] });
  const path = [];
  assert.equal(nav.findPath({ x: 0, y: 0, z: -4 }, { x: 0, y: 0, z: 3.5 }, path), true);
  assert.equal(path.length, 1, 'a kerb and an overhead beam do not block');
  // a goal inside a closed pen
  const pen = createNavGrid({ bounds, boxes: [{ min: [1, 0, -1], max: [4, 1, -0.8] }, { min: [1, 0, 0.8], max: [4, 1, 1] }, { min: [1, 0, -1], max: [1.2, 1, 1] }, { min: [3.8, 0, -1], max: [4, 1, 1] }] });
  const partial = [];
  assert.equal(pen.findPath({ x: -3, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }, partial), false);
  assert.ok(partial.length > 0, 'the closest reachable point is returned');
  const end = partial[partial.length - 1];
  assert.ok(pen.walkable(end.x, end.z) && Math.abs(end.z) > 1, `stops outside the pen wall, next to the goal (${end.x.toFixed(2)}, ${end.z.toFixed(2)})`);
  assert.ok(Math.abs(end.x - 2.5) < 0.3);
  assert.ok(pen.closest({ x: 2.5, y: 0, z: 0 }, {}), 'closest() finds a walkable cell');
});

test('grid: adding a box re-bakes (version bump) and agents re-plan', () => {
  const nav = createNavGrid({ bounds, boxes: [] });
  const v = nav.version, path = [];
  nav.findPath({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, path);
  assert.equal(path.length, 1);
  nav.addBox(wall);
  assert.ok(nav.version > v);
  nav.findPath({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, path);
  assert.ok(path.length > 1);
});

test('movement: a zombie that hears the player paths around the wall to them without entering blocked cells', () => {
  const lvl = level({ boxes: [wall], bounds });
  const z = lvl.add(createZombieBrain({ sightRange: 4 }), [0, 0, -6]);
  lvl.world.stimulus({ type: 'gunshot', position: [0, 1.5, 1] });
  let blocked = 0, maxX = 0;
  run(lvl, 25, vrPlayer(0, 1, { hands: false }), { onFrame: () => {
    const p = z.testBody.position;
    if (!lvl.navmesh.walkable(p.x, p.z)) blocked++;
    maxX = Math.max(maxX, Math.abs(p.x));
  } });
  const p = z.testBody.position;
  assert.equal(blocked, 0, 'never inside a blocked cell');
  assert.ok(maxX > 2.9, `went around the end of the wall (|x| ${maxX.toFixed(2)})`);
  assert.ok(Math.hypot(p.x - 0, p.z - 1) < 1.3, `reached the player (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  assert.ok(lvl.world.stats().paths > 1);
});

test('stepBody: integrates intent and slides along blocked cells', () => {
  const nav = createNavGrid({ bounds, boxes: [wall] });
  const pos = { x: 0, y: 0, z: -2.8 };
  const moved = stepBody(pos, { velocity: { x: 0.5, z: 1 } }, 0.5, nav);
  assert.ok(moved > 0 && pos.z === -2.8 && pos.x > 0, 'slid sideways along the wall');
  assert.equal(stepBody(pos, { velocity: { x: 0, z: 0 } }, 1, nav), 0);
});
