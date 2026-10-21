// GameSystems ai extension: movement intent. Pure (no three.js). Turns "go there at this speed" into a planar velocity
// the host applies to its body: path following on the navmesh, arrival and stopping distance, separation between agents,
// simple local avoidance, VR personal space and the horde's escape lane, then a clamp that keeps the next step on
// walkable ground. Nothing here moves a body; agents only ever output a velocity and a facing.
//
// Personal space (docs/vr/npc_ai.md): agents stop `personalSpace` metres (flat) from the tracked head and `handSpace`
// from each tracked hand. The inward part of the velocity is removed near the boundary; an agent the player stepped into
// backs off on its own. The player is never pushed: the AI never outputs anything for the player's body or camera.
// While tracking is lost the distances grow by trackingLossScale and no close interaction starts.
import { point, flatDistance } from './math.js';

export const MOVE_DEFAULTS = Object.freeze({
  arrive: 0.15,             // m: a path corner counts as reached
  slowRadius: 0.5,          // m: slow down inside this distance to the goal
  pathRefresh: 0.8,         // s between re-plans toward a moving goal
  goalMoved: 0.4,           // m: a goal moved this far re-plans at once
  separation: 0.7,          // m between agents
  separationGain: 1.6,
  avoidLookahead: 1.0,      // m: sidestep a slower agent this close ahead
  personalSpace: 0.6,       // m from the tracked head
  handSpace: 0.3,           // m from each tracked hand
  backOffSpeed: 0.4,        // m/s: leaving personal space the player stepped into
  trackingLossScale: 1.5,
  laneRadius: 1.8,          // m: inside this distance agents are steered out of the horde's escape lane
});

const tmp = point();

/** Plans (when needed) and follows a path to goal. Returns 'arrived', 'moving' or 'blocked'. Sets intent.velocity. */
export function moveTo(agent, ctx, goal, speed, stop = 0.15) {
  const nav = ctx.nav, m = agent.move, pos = agent.position, cfg = agent.moveConfig;
  m.pathAge += ctx.dt;
  if (!m.hasPath || flatDistance(goal, m.goal) > cfg.goalMoved || m.pathAge > cfg.pathRefresh || m.version !== nav.version) {
    m.reached = nav.findPath(pos, goal, m.path);
    m.hasPath = m.path.length > 0; m.index = 0; m.pathAge = 0; m.version = nav.version;
    m.goal.x = goal.x; m.goal.y = goal.y; m.goal.z = goal.z;
    ctx.stats.paths++;
  }
  if (!m.hasPath) { stand(agent); return 'blocked'; }
  while (m.index < m.path.length - 1 && flatDistance(pos, m.path[m.index]) < cfg.arrive) m.index++;
  const end = m.path[m.path.length - 1], corner = m.path[m.index];
  const toEnd = flatDistance(pos, end);
  if (m.index === m.path.length - 1 && toEnd <= Math.max(stop, 0.02)) { stand(agent); return m.reached ? 'arrived' : 'blocked'; }
  // distance left along the path (only as far as it matters for slowing down)
  let remaining = flatDistance(pos, corner);
  for (let i = m.index + 1; i < m.path.length && remaining < stop + cfg.slowRadius; i++) remaining += flatDistance(m.path[i - 1], m.path[i]);
  const v = Math.min(speed, speed * Math.max(0.25, (remaining - stop) / cfg.slowRadius));
  const dx = corner.x - pos.x, dz = corner.z - pos.z, d = Math.hypot(dx, dz) || 1;
  finishVelocity(agent, ctx, dx / d * v, dz / d * v, speed);
  return 'moving';
}

/** Straight-line velocity toward a point (used for short lunges inside the personal-space rules). */
export function pushToward(agent, ctx, target, speed) {
  const dx = target.x - agent.position.x, dz = target.z - agent.position.z, d = Math.hypot(dx, dz);
  if (d < 1e-4) { stand(agent); return; }
  finishVelocity(agent, ctx, dx / d * speed, dz / d * speed, speed);
}

export function stand(agent) {
  const v = agent.intent.velocity;
  v.x = 0; v.z = 0; agent.intent.speed = 0; agent.intent.moving = false;
}

/** Separation, avoidance, personal space, escape lane, nav clamp; writes intent.velocity / speed / moving. */
export function finishVelocity(agent, ctx, vx, vz, maxSpeed) {
  const cfg = agent.moveConfig, pos = agent.position, player = ctx.player;
  // separation and local avoidance between agents
  let sx = 0, sz = 0;
  for (const other of ctx.agents) {
    if (other === agent || other.dead) continue;
    const ax = pos.x - other.position.x, az = pos.z - other.position.z, d = Math.hypot(ax, az);
    const r = (cfg.separation + other.moveConfig.separation) * 0.5;
    if (d < r && d > 1e-4) { const k = (r - d) / r * cfg.separationGain; sx += ax / d * k; sz += az / d * k; }
    else if (d <= 1e-4) sx += (agent.index < other.index ? 0.5 : -0.5);
    // sidestep someone slower right ahead (they are in the way along our velocity)
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05 && d < cfg.avoidLookahead && d > 1e-4) {
      const ahead = (-ax * vx + -az * vz) / (d * sp);
      const theirs = other.intent.speed;
      if (ahead > 0.8 && theirs < sp * 0.7) { const side = agent.index < other.index ? 1 : -1; sx += vz / sp * 0.5 * side; sz -= vx / sp * 0.5 * side; }
    }
  }
  vx += sx * Math.max(0.3, maxSpeed); vz += sz * Math.max(0.3, maxSpeed);
  // VR personal space around the tracked head and hands; never pushes the player
  if (player.active) {
    const scale = player.tracking ? 1 : cfg.trackingLossScale;
    const space = (agent.personalSpace ?? cfg.personalSpace) * scale;
    keepOut(pos, player.head, space, vx, vz, cfg.backOffSpeed, ctx.tickDt); vx = tmp.x; vz = tmp.z;
    if (!agent.ignoreHands) for (const hand of player.hands) if (hand.tracked) { keepOut(pos, hand, cfg.handSpace * scale, vx, vz, cfg.backOffSpeed, ctx.tickDt); vx = tmp.x; vz = tmp.z; }
    // keep the horde's escape lane free near the player
    if (ctx.horde && agent.usesHorde && flatDistance(pos, player.head) < cfg.laneRadius && ctx.horde.inLane(pos, player.head)) {
      const a = ctx.horde.laneAngle, lx = Math.sin(a), lz = Math.cos(a);
      const rx = pos.x - player.head.x, rz = pos.z - player.head.z, side = (rx * lz - rz * lx) >= 0 ? 1 : -1;
      vx += lz * side * 0.6; vz -= lx * side * 0.6;
    }
  }
  const sp = Math.hypot(vx, vz), cap = maxSpeed * 1.15;
  if (sp > cap) { vx *= cap / sp; vz *= cap / sp; }
  // nav clamp: the next steps stay on walkable ground (slide along obstacles)
  const nav = ctx.nav, look = Math.max(ctx.tickDt * 2, 0.08);
  if (nav && (vx || vz) && !nav.walkable(pos.x + vx * look, pos.z + vz * look)) {
    if (nav.walkable(pos.x + vx * look, pos.z)) vz = 0;
    else if (nav.walkable(pos.x, pos.z + vz * look)) vx = 0;
    else if (nav.walkable(pos.x, pos.z)) { vx = 0; vz = 0; }
    // standing inside a blocked cell (pushed in by the host): any velocity is allowed to get out
  }
  const v = agent.intent.velocity;
  v.x = vx; v.z = vz;
  agent.intent.speed = Math.hypot(vx, vz);
  agent.intent.moving = agent.intent.speed > 0.02;
}

/** Velocity with the part that would enter the circle (p, r) removed, into tmp.x / tmp.z. */
function keepOut(pos, p, r, vx, vz, backOff, dt) {
  const ax = pos.x - p.x, az = pos.z - p.z, d = Math.hypot(ax, az);
  tmp.x = vx; tmp.z = vz;
  if (d < 1e-4) { tmp.x += backOff; return; }
  const nx = ax / d, nz = az / d, inward = -(vx * nx + vz * nz);
  if (d < r) {
    // inside: drop every inward component and back off
    if (inward > 0) { tmp.x += nx * inward; tmp.z += nz * inward; }
    const k = backOff * Math.min(1, (r - d) / 0.2);
    tmp.x += nx * k; tmp.z += nz * k;
    return;
  }
  if (inward > 0) {
    const allowed = Math.max(0, (d - r) / Math.max(dt, 1e-3));   // never step across the boundary within one tick
    if (inward > allowed) { const cut = inward - allowed; tmp.x += nx * cut; tmp.z += nz * cut; }
  }
}

/** The tick's look target: face the velocity when moving, else the given point. Writes intent.face (yaw). */
export function faceToward(agent, p) {
  if (!p) return;
  const dx = p.x - agent.position.x, dz = p.z - agent.position.z;
  if (Math.hypot(dx, dz) > 0.05) agent.intent.face = Math.atan2(dx, dz);
}
export function faceVelocity(agent) {
  const v = agent.intent.velocity;
  if (agent.intent.moving) agent.intent.face = Math.atan2(v.x, v.z);
}
