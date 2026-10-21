// Shared fixture for the ai extension tests: box levels with an exact segment-vs-box raycast, a world factory and a
// fixed-step runner that integrates intent the way a host does (stepBody, turn toward intent.face).
import { createAIWorld, createNavGrid, stepBody } from '../../extensions/ai/index.js';

/** True when the segment a -> b passes through the axis-aligned box ({ min: [x,y,z], max: [x,y,z] }). */
export function segmentHitsBox(a, b, box) {
  const o = [a.x, a.y, a.z], d = [b.x - a.x, b.y - a.y, b.z - a.z];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < box.min[i] || o[i] > box.max[i]) return false; continue; }
    let ta = (box.min[i] - o[i]) / d[i], tb = (box.max[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** A level: boxes, a nav grid over bounds and a counting raycast. */
export function level({ boxes = [], bounds = { minX: -8, minZ: -12, maxX: 8, maxZ: 6 }, seed = 1, config = {} } = {}) {
  const navmesh = createNavGrid({ bounds, boxes });
  const counter = { rays: 0 };
  const raycast = (a, b) => { counter.rays++; return boxes.some(box => segmentHitsBox(a, b, box)); };
  const world = createAIWorld({ navmesh, raycast, seed, config });
  const bodies = [];
  return {
    world, navmesh, raycast, counter, bodies, boxes,
    add(brain, position, yaw = 0, options) {
      const body = { position: { x: position[0], y: position[1] ?? 0, z: position[2] }, yaw };
      bodies.push(body);
      const agent = world.addAgent(brain, body, options);
      agent.testBody = body;
      return agent;
    },
  };
}

/** Runs the world for `seconds` at `dt`, moving bodies by their intent (no body enters a blocked cell). */
export function run(lvl, seconds, player, { dt = 1 / 60, onFrame = null } = {}) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const p = typeof player === 'function' ? player(i * dt) : player;
    lvl.world.update(dt, p);
    for (const agent of lvl.world.agents) {
      const body = agent.testBody;
      if (!body || agent.physical !== 'standing') continue;
      stepBody(body.position, agent.intent, dt, lvl.navmesh);
      body.yaw = agent.intent.face;   // turns instantly (hosts usually smooth this)
    }
    onFrame?.(i * dt, i);
  }
}

/** A standing VR player at (x, z): head at 1.6 m, hands in front. */
export function vrPlayer(x = 0, z = 0, { hands = true, facing = -1 } = {}) {
  return {
    head: { x, y: 1.6, z },
    hands: hands ? [{ x: x - 0.25, y: 1.15, z: z + 0.25 * facing }, { x: x + 0.25, y: 1.15, z: z + 0.25 * facing }] : [],
    floorY: 0,
  };
}

/** Records every event as { t, type, id, ... } (positions dropped) for traces and assertions. */
export function record(world) {
  const events = [];
  world.on(e => events.push({ t: +world.clock.toFixed(4), type: e.type, id: e.agent?.id, from: e.from, to: e.to, kind: e.kind, target: e.target, damage: e.damage, reason: e.reason }));
  return events;
}
