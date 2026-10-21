// GameSystems ai extension: the AI world. Pure (no three.js). Owns the agents, the fixed AI tick, the time-sliced ray
// budget, the stimulus bus, the squad and horde coordinators and the event stream. docs/ai_system.md.
//
//   const ai = createAIWorld({ navmesh, raycast: (from, to) => blocked, config: { tickRate: 30, raysPerTick: 12 }, seed: 7 })
//   const agent = ai.addAgent(createZombieBrain(), { position: zombie.position, yaw: 0 })   // body: host-owned, read each tick
//   ai.stimulus({ type: 'gunshot', position: muzzle })                                      // heard on the next tick
//   ai.update(dt, { head, hands: [left, right], floorY: 0 })
//   agent.intent -> { state, velocity, speed, gait, face, look, aim, telegraph, actions, ... }   (the host moves the body)
//   ai.on('attack', e => player.damage(e.damage))
//
// The AI never moves a body or the player: agents output intent, the host applies it (stepBody() is a helper for hosts
// that want a nav-clamped integration).
import { createPerceptionState, resetPerception, look, sense, hear, PERCEPTION_DEFAULTS } from './perception.js';
import { createSquad, createHorde } from './coordinator.js';
import { MOVE_DEFAULTS, stand } from './steering.js';
import { point, readPoint, createRng, hashSeed } from './math.js';

export const WORLD_DEFAULTS = Object.freeze({
  tickRate: 30,              // AI ticks per second (decisions; slower than rendering)
  maxTicksPerUpdate: 4,      // a long frame catches up at most this many ticks
  raysPerTick: 12,           // sight-ray budget shared by all agents, round-robin
  perceptionHold: 0.25,      // s a sight result stays valid while the agent waits for its next slice
  playerFootsteps: Object.freeze({ radius: 4, minSpeed: 0.7, interval: 0.55 }),   // the player's own steps as stimuli
  stimulusRadius: Object.freeze({ gunshot: 30, explosion: 45, impact: 9, voice: 12, footstep: 4, noise: 6 }),
  squad: Object.freeze({}),  // createSquad config
  horde: Object.freeze({}),  // createHorde config
});
export const PHYSICAL_STATES = Object.freeze(['standing', 'destabilized', 'downed', 'recovering', 'inert']);

/** Navmesh stand-in when a world has none: open floor everywhere, straight paths. */
export function createOpenNav(floorY = 0) {
  return {
    kind: 'open', floorY, version: 0,
    findPath(from, to, out = []) { out.length = 0; out.push(point(to.x, floorY, to.z)); return true; },
    closest(p, out = point()) { out.x = p.x; out.y = floorY; out.z = p.z; return out; },
    walkable: () => true, segmentClear: () => true,
  };
}

function createIntent() {
  return {
    state: 'idle', mode: '', paused: false,
    velocity: point(), speed: 0, moving: false, gait: 'walk', face: 0,
    look: point(), hasLook: false, aim: point(), hasAim: false, crouch: false,
    telegraph: 0, attack: null, target: null,
    actions: [],              // since the last update(): { type: 'fire' | 'reload' | 'windup' | 'lunge' | 'attack', ... }
  };
}

export function createAIWorld({ navmesh = null, raycast = null, config = {}, seed = 1 } = {}) {
  const cfg = { ...WORLD_DEFAULTS, ...config, playerFootsteps: { ...WORLD_DEFAULTS.playerFootsteps, ...config.playerFootsteps },
    stimulusRadius: { ...WORLD_DEFAULTS.stimulusRadius, ...config.stimulusRadius } };
  const nav = navmesh ?? createOpenNav(config.floorY ?? 0);
  const rayFn = raycast ?? (() => false);
  const agents = [], pending = [], delivering = [], listeners = new Map(), all = new Set();
  const squad = createSquad(cfg.squad), horde = createHorde(cfg.horde);
  const step = 1 / cfg.tickRate;
  let accumulator = 0, clock = 0, cursor = 0, sequence = 0, footstepClock = 0, lastDt = 0;
  const slotAgents = [];
  const stats = { ticks: 0, rays: 0, sightRays: 0, raysInTick: 0, maxRaysInTick: 0, coverRays: 0, paths: 0, stimuli: 0, events: 0 };

  // the player as the AI sees it (normalised once per update)
  const hand = side => ({ side, x: 0, y: 0, z: 0, tracked: false, vx: 0, vz: 0, speed: 0, px: 0, py: 0, pz: 0, had: false });
  const player = { active: false, tracking: true, head: point(), floorY: nav.floorY ?? 0, light: 1, speed: 0, velocity: point(), hands: [hand('left'), hand('right')], hadHead: false, prevHead: point() };

  const emit = (type, data) => {
    data.type = type; stats.events++;
    for (const cb of listeners.get(type) ?? []) cb(data);
    for (const cb of all) cb(data);
    return data;
  };
  const ctx = { world: null, nav, raycast: (a, b) => { stats.rays++; return rayFn(a, b); }, player, agents, dt: step, tickDt: step, clock: 0, squad, horde, stats, emit,
    perceptionHold: cfg.perceptionHold };

  function readPlayer(input, dt) {
    const h = input && readPoint(input.head ?? input.position, player.head);
    player.active = !!h && input.active !== false;
    player.tracking = input?.tracking !== false;
    player.floorY = Number.isFinite(input?.floorY) ? input.floorY : (nav.floorY ?? 0);
    player.light = Number.isFinite(input?.light) ? input.light : 1;
    if (player.active && player.hadHead && dt > 0) {
      const vx = (player.head.x - player.prevHead.x) / dt, vz = (player.head.z - player.prevHead.z) / dt, s = Math.hypot(vx, vz);
      // teleports / snap turns are not visible motion
      if (s < 8) { const k = Math.min(1, dt * 10); player.velocity.x += (vx - player.velocity.x) * k; player.velocity.z += (vz - player.velocity.z) * k; }
      else { player.velocity.x = player.velocity.z = 0; }
    }
    if (!player.active) { player.velocity.x = player.velocity.z = 0; }
    player.speed = Math.hypot(player.velocity.x, player.velocity.z);
    player.hadHead = player.active;
    if (player.active) { player.prevHead.x = player.head.x; player.prevHead.y = player.head.y; player.prevHead.z = player.head.z; }
    const hands = input?.hands, list = Array.isArray(hands) ? hands : [hands?.left, hands?.right];
    for (let i = 0; i < 2; i++) {
      const hd = player.hands[i], src = list[i];
      hd.tracked = !!src && src.tracked !== false && !!readPoint(src.position ?? src, hd) && player.tracking;
      if (hd.tracked && hd.had && dt > 0) {
        hd.vx = (hd.x - hd.px) / dt; hd.vz = (hd.z - hd.pz) / dt;
        const vy = (hd.y - hd.py) / dt;
        hd.speed = Math.hypot(hd.vx, vy, hd.vz);
      } else { hd.vx = hd.vz = hd.speed = 0; }
      hd.had = hd.tracked; hd.px = hd.x; hd.py = hd.y; hd.pz = hd.z;
    }
  }

  function readBody(agent) {
    const b = agent.body;
    if (!readPoint(b.position, agent.position)) return;
    agent.yaw = Number.isFinite(b.yaw) ? b.yaw : agent.intent.face;
    const eh = typeof b.eyeHeight === 'function' ? b.eyeHeight() : Number.isFinite(b.eyeHeight) ? b.eyeHeight : agent.brain.eyeHeight?.() ?? agent.sense.eyeHeight;
    agent.eye.x = agent.position.x; agent.eye.y = agent.position.y + eh; agent.eye.z = agent.position.z;
  }

  function deliver(stimulus) {
    for (const agent of agents) {
      if (agent.dead) continue;
      const loudness = hear(agent.perception, agent.sense, stimulus, agent.eye, stimulus.occlude === false ? null : ctx.raycast, agent.rng, clock);
      if (loudness > 0) {
        agent.brain.heard?.(agent, stimulus, loudness, ctx);
        emit('heard', { agent, stimulus, loudness, at: { ...agent.perception.heard } });
      }
    }
  }

  function tick(h) {
    clock += h; ctx.clock = clock; ctx.dt = h; stats.ticks++;
    for (const a of agents) readBody(a);
    // the player's own footsteps
    footstepClock += h;
    const fs = cfg.playerFootsteps;
    if (player.active && fs.radius > 0 && player.speed >= fs.minSpeed && footstepClock >= fs.interval) {
      footstepClock = 0;
      pending.push({ type: 'footstep', position: { x: player.head.x, y: player.floorY, z: player.head.z }, radius: fs.radius * Math.min(1.5, player.speed / 1.2), source: 'player' });
    }
    // stimuli posted since the last tick
    delivering.length = 0;
    for (const s of pending) delivering.push(s);
    pending.length = 0;
    for (const s of delivering) deliver(s);
    squad.tick(h, agents);
    horde.prune(agents);
    // time-sliced sight: a fixed ray budget, round-robin over the agents
    let raysLeft = cfg.raysPerTick, visited = 0;
    const n = agents.length;
    while (visited < n && n) {
      const agent = agents[cursor % n];
      cursor = (cursor + 1) % n; visited++;
      if (agent.dead || agent.physical !== 'standing') { agent.perception.seen = false; continue; }
      sense(agent.perception, agent.sense, agent.position, player);
      const need = agent.brain.raysPerUpdate ?? 4;
      if (raysLeft < need) { cursor = (cursor + n - 1) % n; break; }   // this agent goes first next tick
      const used = look(agent.perception, agent.sense, agent.eye, agent.yaw, player, ctx.raycast, need);
      raysLeft -= used; stats.sightRays += used;
    }
    stats.raysInTick = cfg.raysPerTick - raysLeft;
    stats.maxRaysInTick = Math.max(stats.maxRaysInTick, stats.raysInTick);
    // horde slots around the player for the zombies that want one
    slotAgents.length = 0;
    for (const a of agents) if (a.brain.usesHorde && a.brain.wantsSlot?.(a)) slotAgents.push(a); else if (a.slot) a.slot.valid = false, a.slot.index = -1;
    if (slotAgents.length && player.active) {
      let standoff = 0;
      for (const a of slotAgents) standoff = Math.max(standoff, a.brain.config.attack?.range ?? 0.85);
      horde.update(player.head, slotAgents, nav, standoff);
    }
    for (const agent of agents) agent.brain.think(agent, ctx);
  }

  const world = {
    config: cfg, nav, squad, horde, agents, player,
    get clock() { return clock; },
    /** Adds an agent: brain from createZombieBrain / createGuardBrain (one per agent), body { position, yaw?, eyeHeight? }. */
    addAgent(brain, body, options = {}) {
      if (!brain?.think) throw new TypeError('addAgent: brain must come from a brain factory (createZombieBrain, createGuardBrain, ...)');
      if (agents.some(a => a.brain === brain)) throw new TypeError('addAgent: one brain per agent (call the factory again)');
      if (!body || !readPoint(body.position, point())) throw new TypeError('addAgent: body.position must be a point');
      const index = sequence++, id = options.id ?? `${brain.kind}-${index}`;
      const perception = createPerceptionState();
      const agent = {
        id, index, brain, body, kind: brain.kind, ctx,
        position: point(), yaw: 0, eye: point(),
        perception, memoryPoint: perception.lastKnown,
        sense: { ...PERCEPTION_DEFAULTS, ...brain.perception },
        moveConfig: { ...MOVE_DEFAULTS, ...brain.move },
        move: { path: [], index: 0, goal: point(), pathAge: 0, version: -1, hasPath: false, reached: false },
        rng: createRng(hashSeed(seed, id)),
        intent: createIntent(),
        physical: 'standing', dead: false, slot: null, usesHorde: !!brain.usesHorde, ignoreHands: false, personalSpace: null,
      };
      readBody(agent);
      agent.intent.face = agent.yaw;
      agents.push(agent);
      brain.init?.(agent, ctx);
      readBody(agent);
      return agent;
    },
    removeAgent(agent) {
      const i = agents.indexOf(agent);
      if (i < 0) return false;
      agents.splice(i, 1); squad.releaseInvestigation(agent); squad.releaseFlank(agent); horde.releaseAttack(agent);
      if (cursor > i) cursor--;
      return true;
    },
    /** Posts a stimulus { type, position, radius? (m, default per type), source?, occlude? }. Heard on the next tick. */
    stimulus(s) {
      const p = readPoint(s?.position, point());
      if (!p) throw new TypeError('stimulus: position must be a point');
      const type = s.type ?? 'noise';
      pending.push({ ...s, type, position: p, radius: Number.isFinite(s.radius) ? s.radius : (Number.isFinite(s.loudness) ? s.loudness : cfg.stimulusRadius[type] ?? cfg.stimulusRadius.noise) });
      stats.stimuli++;
    },
    /** A player shot from -> to: a gunshot at `from` (unless sound: false) and near-miss suppression for guards. */
    shotFired(from, to, { sound = true, radius } = {}) {
      const a = readPoint(from, point()), b = readPoint(to, point());
      if (!a || !b) return;
      if (sound) world.stimulus({ type: 'gunshot', position: a, radius, source: 'player' });
      for (const agent of agents) if (!agent.dead) agent.brain.nearMiss?.(agent, a, b, ctx);
    },
    /**
     * Hit hook: { region, point?, direction?, impulse? (N·s), damage? }. The brain reacts (awareness, cancelled attack,
     * guard health / stagger / suppression) and a 'hit' event goes out with the same fields plus the brain's result, so a
     * physical layer (IK hit reactions, an active ragdoll) can respond and set the physical state.
     */
    hit(agent, hit = {}) {
      const data = { region: hit.region ?? 'chest', point: hit.point ? readPoint(hit.point, point()) : null, direction: hit.direction ? readPoint(hit.direction, point()) : null,
        impulse: Number.isFinite(hit.impulse) ? hit.impulse : 0, damage: Number.isFinite(hit.damage) ? hit.damage : undefined, bullet: hit.bullet };
      const result = agent.dead && agent.brain.kind !== 'guard' ? {} : agent.brain.onHit?.(agent, data, ctx) ?? {};
      return emit('hit', { agent, ...data, ...result });
    },
    /** Physical state from the body layer: standing | destabilized | downed | recovering | inert. */
    setPhysicalState(agent, state) {
      if (!PHYSICAL_STATES.includes(state)) throw new TypeError(`setPhysicalState: ${state} (one of ${PHYSICAL_STATES.join(', ')})`);
      if (agent.physical === state) return;
      const from = agent.physical;
      agent.physical = state;
      if (state !== 'standing') { horde.releaseAttack(agent); stand(agent); agent.intent.paused = true; }
      agent.brain.onPhysical?.(agent, state, ctx);
      emit('physical', { agent, from, to: state });
    },
    /** Mobility from the damage layer (zombies: mobilityFromGore). */
    setMobility(agent, mobility) { agent.brain.setMobility?.(agent, mobility); },
    /** Runs the AI. dt: seconds since the last call; player { head, hands?, floorY?, light?, active?, tracking? }. */
    update(dt, playerInput = null) {
      for (const a of agents) a.intent.actions.length = 0;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      readPlayer(playerInput, dt);
      lastDt = dt;
      accumulator += Math.min(dt, step * cfg.maxTicksPerUpdate);
      let n = 0;
      while (accumulator >= step - 1e-9 && n < cfg.maxTicksPerUpdate) { accumulator -= step; tick(step); n++; }
      return n;
    },
    /** on(type, cb) or on(cb) for every event; returns the unsubscribe function. */
    on(type, cb) {
      if (typeof type === 'function') { all.add(type); return () => all.delete(type); }
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
      return () => listeners.get(type).delete(cb);
    },
    emit,
    stats: () => ({ ...stats, agents: agents.length, alive: agents.filter(a => !a.dead).length, clock, attackers: horde.tokens.length, investigators: squad.investigators.length, flankers: squad.flankers.length, lastDt }),
    /** Everything back to the start: perception, brains, coordinators (bodies stay where the host puts them). */
    reset() {
      pending.length = 0; accumulator = 0; clock = 0; cursor = 0; squad.reset(); horde.reset();
      for (const a of agents) {
        resetPerception(a.perception); a.physical = 'standing'; a.dead = false; a.slot = null; a.ignoreHands = false;
        a.move.hasPath = false; a.rng.state = hashSeed(seed, a.id);
        stand(a); a.intent.state = 'idle'; a.intent.actions.length = 0; a.intent.telegraph = 0; a.intent.paused = false;
        readBody(a); a.brain.reset?.(a);
      }
    },
  };
  ctx.world = world;
  return world;
}

/**
 * Host helper: moves `position` ({x,y,z}, in place) by the intent's velocity for dt, sliding along blocked navmesh
 * cells. Returns the distance moved.
 */
export function stepBody(position, intent, dt, nav = null) {
  const vx = intent.velocity.x * dt, vz = intent.velocity.z * dt;
  if (!vx && !vz) return 0;
  let nx = position.x + vx, nz = position.z + vz;
  if (nav && !nav.walkable(nx, nz) && nav.walkable(position.x, position.z)) {
    if (nav.walkable(nx, position.z)) nz = position.z;
    else if (nav.walkable(position.x, nz)) nx = position.x;
    else { nx = position.x; nz = position.z; }
  }
  const moved = Math.hypot(nx - position.x, nz - position.z);
  position.x = nx; position.z = nz;
  return moved;
}
