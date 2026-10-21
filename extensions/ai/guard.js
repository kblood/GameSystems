// GameSystems ai extension: the guard brain. Pure (no three.js). One brain per agent:
//   world.addAgent(createGuardBrain({ route: [[0, 0, 0], [4, 0, 0]], difficulty: 'hard' }), body)
//
// A JS port of NightfallContractsGodot (MIT, Copyright (c) 2026 Kasper Olesen): core/guard_brain.gd (awareness,
// ammunition, reaction), core/guard_tuning.gd (difficulty knobs, spread), runtime/guard_tactics.gd (tactics) and the
// per-guard parts of runtime/guard.gd (telegraph, visible aim error, suppression, stagger, reports, hearing).
//
//   brain state:  patrol -> investigate -> engage -> reload | exhausted, dead
//   tactics:      patrol -> suspicious -> investigate -> search (timeout) -> patrol;
//                 hold (the squad already has enough investigators), combat, cover (with peek), retreat, flank
//
// Fairness rules kept from the original: hearing never gives a firing target (only a seen sample does); the first shot
// of every (re)acquired engagement follows a visible telegraph; aim error lives in the visible aim point (intent.aim),
// never in a hidden bullet offset; the squad's turn-taking prevents synchronized volleys; a fire action needs a clear
// lane ray from the eye to the aim point. Cover is validated with rays from the player's real (tracked) head plus VR
// lean and duck offsets to the guard's crouched head and chest.
// The host performs the shot from its posed muzzle toward intent.aim / the action's aim, and owns hit zones on the body:
// it reports hits with world.hit(agent, { region: 'head' | 'body' | 'arm' | 'leg', damage?, point, direction }).
import { updateAwareness, playerSample, SUSPICIOUS_AT, INVESTIGATE_AT } from './perception.js';
import { moveTo, stand, faceToward, faceVelocity } from './steering.js';
import { pathLength } from './nav.js';
import { point, clamp, DEG, TAU, flatDistance, wrapAngle, yawTo, readPoint } from './math.js';

export const GUARD_DEFAULTS = Object.freeze({
  // awareness and weapon (guard_brain.gd)
  reactionDelay: 0.38, reacquireGrace: 1.1, alertDecay: 12, detectionRate: 1.5, shotInterval: 0.55, sightRange: 23,
  reloadDuration: 2.4, health: 100, magazine: 12, reserves: 36,
  // tuning (guard_tuning.gd OVERRIDABLE)
  focusHalfAngle: 35, viewHalfAngle: 65, alertViewHalfAngle: 87, nearRange: 7, hearing: 1, telegraphTime: 0.6,
  baseSpread: 1.0, spreadPerMeter: 0.16, motionSpread: 2.0, suppressionSpread: 4.0, retreatHealth: 40, searchDuration: 10,
  aggression: 0.5,
  // body and movement
  eyeHeight: 1.6, crouchDrop: 0.26, walkSpeed: 0.85, alertSpeed: 1.65, tacticalSpeed: 1.6, aimTolerance: 4,
  personalSpace: 1.0, handSpace: 0.45,
  route: null,                                        // patrol points ([x,y,z] or {x,y,z}); default: the spawn point
  zoneDamage: Object.freeze({ head: 100, body: 40, limb: 24 }),
});
/** Difficulty presets (any GUARD_DEFAULTS knob may also be set directly). */
export const GUARD_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ reactionDelay: 0.7, detectionRate: 1.0, shotInterval: 0.85, telegraphTime: 0.9, baseSpread: 1.8, spreadPerMeter: 0.24, aggression: 0.3, sightRange: 18 }),
  normal: Object.freeze({}),
  hard: Object.freeze({ reactionDelay: 0.25, detectionRate: 2.0, shotInterval: 0.45, telegraphTime: 0.45, baseSpread: 0.7, spreadPerMeter: 0.12, aggression: 0.75, alertDecay: 20 }),
});
const RANGES = { reactionDelay: [0.05, 2], reacquireGrace: [0, 3], alertDecay: [2, 60], detectionRate: [0.2, 5], shotInterval: [0.2, 3],
  sightRange: [4, 40], telegraphTime: [0.2, 2], searchDuration: [2, 60], aggression: [0, 1] };

// fixed tuning constants (guard_tuning.gd)
const T = Object.freeze({
  PERCEPTION_HOLD: 0.15, SETTLE_MIN: 0.8, SETTLE_PER_SHOT: 0.07, STAGGER_BODY: 0.55, STAGGER_LIMB: 0.35,
  SUPPRESSION_PER_HIT: 0.6, SUPPRESSION_PER_NEAR_MISS: 0.35, SUPPRESSION_RADIUS: 1.3, SUPPRESSION_DECAY: 0.45, SUPPRESSED_AT: 0.6,
  COVER_MIN_HOLD: 1.4, PEEK_MAX: 3.5, COVER_RETRY: 1.5, HEAD_LEAN: 0.35, HEAD_DUCK: 0.4,
  SEARCH_POINTS: 3, SEARCH_RADIUS: 4, SEARCH_DWELL: 1.6, FLANK_AFTER: 4, FLANK_WHEN_DENIED: 2, FLANK_TIMEOUT: 9, FLANK_DISTANCE: 7,
  ARRIVE: 0.15, COVER_RAY_BUDGET: 120, LANE_CHECK_INTERVAL: 0.2, TELEGRAPH_RESET: 1, STIMULUS_REPORT: 2.5,
});
export const GUARD_CONSTANTS = T;
const COVER_RINGS = [1.4, 2.6, 3.8, 5.0, 6.0], RETREAT_RINGS = [3.0, 5.0, 7.0, 9.0], DIRECTIONS = 10;

/** Resolves config + difficulty preset with the original clamps. */
export function resolveGuardConfig(config = {}) {
  const preset = typeof config.difficulty === 'string' ? GUARD_DIFFICULTY[config.difficulty] ?? {} : config.difficulty ?? {};
  const cfg = { ...GUARD_DEFAULTS, ...preset, ...config };
  delete cfg.difficulty;
  for (const [k, [a, b]] of Object.entries(RANGES)) cfg[k] = clamp(Number(cfg[k]), a, b);
  return cfg;
}

/** Angular spread (deg) of one shot (guard_tuning.gd spread_deg). */
export function spreadDeg(cfg, distance, targetSpeed, suppression, settle) {
  const spread = cfg.baseSpread + cfg.spreadPerMeter * distance + cfg.motionSpread * Math.min(targetSpeed, 4) + cfg.suppressionSpread * clamp(suppression, 0, 1);
  return spread * Math.max(T.SETTLE_MIN, 1 - T.SETTLE_PER_SHOT * settle);
}

/** Head / body / limb from a hit region (guard zones or gore region ids). */
export function guardZone(region = 'body') {
  const r = String(region);
  if (/head|cranium|jaw|neck/i.test(r)) return 'head';
  if (/arm|hand|leg|foot|limb/i.test(r)) return 'limb';
  return 'body';
}

export function createGuardBrain(config = {}) {
  const cfg = resolveGuardConfig(config);
  // brain core (guard_brain.gd)
  let state = 'patrol', health = cfg.health, rounds = cfg.magazine, reserves = cfg.reserves, cooldown = 0, reloadClock = 0, reaction = 0, contactAcquired = false;
  // tactics (guard_tactics.gd)
  let tactic = 'patrol', engageClock = 0, coverRetry = 0, holdRecheck = 0, peekClock = 0, peeks = 0, retreated = false, coverPhase = 'move', coverClock = 0;
  let hasCover = false, hasPeek = false, hasFlank = false, flankClock = 0, searchElapsed = 0, dwell = 0, searchIndex = 0, coverRays = 0;
  const coverGoal = point(), coverPeek = point(), coverThreat = point(), flankGoal = point(), searchCenter = point(), searchPoints = [];
  // runtime (guard.gd)
  let clock = 0, stagger = 0, suppression = 0, telegraphClock = 0, telegraphEmitted = false, aimLost = 0, settle = 0, telegraphs = 0;
  let blockedShot = 0, fireDenied = 0, laneClear = false, laneCheckAt = 0, reportClock = 0, routeIndex = 0, patrolPause = 0, shots = 0, paused = false;
  let jitterX = 0, jitterY = 0;
  const route = [], target = point(), aim = point(), eye = point(), look = point(), tmp = point(), tmp2 = point(), sample = point();
  let hasLook = false;

  const brain = {
    kind: 'guard', config: cfg, usesHorde: false,
    perception: { sightRange: cfg.sightRange, viewHalfAngle: cfg.viewHalfAngle, alertViewHalfAngle: cfg.alertViewHalfAngle, focusHalfAngle: cfg.focusHalfAngle,
      nearRange: cfg.nearRange, detectionRate: cfg.detectionRate, hearing: cfg.hearing, alertDecay: cfg.alertDecay, memory: 8, hearingMemory: 7, eyeHeight: cfg.eyeHeight, samples: 4 },
    move: { personalSpace: cfg.personalSpace, handSpace: cfg.handSpace, separation: 0.85 },
    raysPerUpdate: 4,
    get state() { return state; },
    get tactic() { return tactic; },
    /** Snapshot for hosts and tests. */
    status: () => ({ state, tactic, health, rounds, reserves, reloadClock, suppression, stagger, telegraphClock, telegraphs, shots, coverRays, cover: hasCover ? { ...coverGoal } : null,
      peek: hasPeek ? { ...coverPeek } : null, flank: hasFlank ? { ...flankGoal } : null, retreated, fireDenied, blockedShot }),
    get health() { return health; },
    get rounds() { return rounds; },
    get reserves() { return reserves; },
    get reloadClock() { return reloadClock; },
    engaged: () => state === 'engage',
    eyeHeight: () => cfg.eyeHeight - (crouching() ? cfg.crouchDrop : 0),
    init(agent) {
      route.length = 0;
      for (const p of cfg.route ?? []) route.push(readPoint(p, point()));
      if (!route.length) route.push({ x: agent.position.x, y: agent.position.y, z: agent.position.z });
      agent.personalSpace = cfg.personalSpace;
    },
    reset(agent) {
      state = 'patrol'; health = cfg.health; rounds = cfg.magazine; reserves = cfg.reserves; cooldown = reloadClock = reaction = 0; contactAcquired = false;
      tactic = 'patrol'; engageClock = coverRetry = holdRecheck = peekClock = peeks = coverClock = flankClock = searchElapsed = dwell = searchIndex = 0;
      retreated = hasCover = hasPeek = hasFlank = false; coverPhase = 'move'; searchPoints.length = 0;
      clock = stagger = suppression = telegraphClock = aimLost = settle = blockedShot = fireDenied = laneCheckAt = reportClock = routeIndex = patrolPause = shots = 0;
      telegraphEmitted = laneClear = paused = false; agent.dead = false;
    },
    think(agent, ctx) { think(agent, ctx); },
    /** A heard stimulus (after perception localised it): investigate unless already fighting or reloading. */
    heard(agent, stimulus, loudness, ctx) {
      if (state === 'dead') return;
      if (!['engage', 'reload', 'exhausted'].includes(state)) state = 'investigate';
      if (stimulus.type === 'gunshot' || stimulus.type === 'impact') report(agent, ctx, 'heard_shot', stimulus.position);
    },
    receiveReport(agent, kind, at, ctx) {
      if (state === 'dead') return;
      agent.reportsReceived = (agent.reportsReceived ?? 0) + 1;
      if (state !== 'engage') hearAt(agent, at);
    },
    suppress(agent, amount, from, ctx) {
      if (state === 'dead') return;
      suppression = Math.min(1, suppression + amount);
      ctx.emit('suppressed', { agent, amount, from: { x: from.x, y: from.y, z: from.z } });
      if (!['engage', 'reload', 'exhausted'].includes(state)) hearAt(agent, from);
    },
    nearMiss(agent, from, to, ctx) {
      // a player bullet passing the chest (guard_squad.gd _on_shot_fired)
      const cx = agent.position.x, cy = agent.position.y + 1.2, cz = agent.position.z;
      const sx = to.x - from.x, sy = to.y - from.y, sz = to.z - from.z, len2 = Math.max(sx * sx + sy * sy + sz * sz, 1e-4);
      const t = clamp(((cx - from.x) * sx + (cy - from.y) * sy + (cz - from.z) * sz) / len2, 0, 1);
      const miss = Math.hypot(from.x + sx * t - cx, from.y + sy * t - cy, from.z + sz * t - cz);
      if (miss < T.SUPPRESSION_RADIUS) brain.suppress(agent, T.SUPPRESSION_PER_NEAR_MISS * (1 - miss / T.SUPPRESSION_RADIUS * 0.5), from, ctx);
      return miss;
    },
    onHit(agent, hit, ctx) {
      if (state === 'dead') return { killed: false };
      const zone = guardZone(hit.region), amount = Number.isFinite(hit.damage) ? hit.damage : cfg.zoneDamage[zone];
      health = Math.max(0, health - amount);
      agent.perception.alert = true; agent.perception.quietTime = 0;
      // bullet travel gives a source estimate (guard.gd _resolve_damage_hit)
      if (hit.direction && hit.point && hit.bullet !== false) { tmp.x = hit.point.x - hit.direction.x * 3; tmp.y = hit.point.y; tmp.z = hit.point.z - hit.direction.z * 3; hearAt(agent, tmp); }
      if (health <= 0) {
        state = 'dead'; reloadClock = 0; agent.dead = true; release(agent, ctx);
        agent.intent.state = 'dead'; agent.intent.mode = 'dead'; stand(agent);
        ctx.emit('death', { agent, zone });
        return { killed: true, zone, damage: amount };
      }
      stagger = Math.max(stagger, zone === 'body' ? T.STAGGER_BODY : T.STAGGER_LIMB);
      suppression = Math.min(1, suppression + T.SUPPRESSION_PER_HIT);
      telegraphClock = Math.min(telegraphClock, cfg.telegraphTime * 0.5); settle = 0;
      ctx.emit('staggered', { agent, zone });
      return { killed: false, zone, damage: amount, stagger };
    },
  };

  function crouching() { return (tactic === 'cover' || tactic === 'retreat') && coverPhase === 'hold' && hasCover; }
  function hearAt(agent, at) {
    const p = agent.perception;
    p.lastKnown.x = at.x; p.lastKnown.y = at.y; p.lastKnown.z = at.z; p.memory = Math.max(p.memory, 7); p.quietTime = 0; p.alert = true;
    if (!['engage', 'reload', 'exhausted', 'dead'].includes(state)) state = 'investigate';
  }
  function release(agent, ctx) { ctx.squad.releaseInvestigation(agent); ctx.squad.releaseFlank(agent); }

  /** guard_brain.gd tick (perception moved to perception.js). Returns '' | 'fire' | 'reload'. */
  function brainTick(agent, dt, visible, distance, weaponReady) {
    const p = agent.perception;
    cooldown = Math.max(0, cooldown - dt);
    const previousUnseen = agent.prevUnseen;
    if (!visible && p.unseenTime > cfg.reacquireGrace) contactAcquired = false;
    if (state === 'reload') {
      reloadClock = Math.max(0, reloadClock - dt);
      if (reloadClock <= 0) {
        const count = Math.min(cfg.magazine - rounds, reserves);
        rounds += count; reserves -= count;
        state = visible ? 'engage' : 'investigate';
      }
      return '';
    }
    if (rounds === 0 && reserves === 0) { state = 'exhausted'; return ''; }   // alive, seeks cover; never invents ammunition
    if (visible && (p.suspicion >= 1 || (contactAcquired && previousUnseen <= cfg.reacquireGrace))) {
      if (!contactAcquired || previousUnseen > cfg.reacquireGrace) reaction = cfg.reactionDelay;
      contactAcquired = true; state = 'engage'; p.alert = true;
    } else if (!visible) {
      if (state === 'engage' && p.unseenTime > cfg.reacquireGrace) state = 'investigate';
      if (p.memory <= 0) state = 'patrol';
      else if (state === 'patrol' && p.suspicion >= INVESTIGATE_AT) state = 'investigate';   // a half-noticed glimpse
    }
    reaction = Math.max(0, reaction - dt);
    if (state === 'engage') {
      if (rounds === 0 && reserves > 0) { state = 'reload'; reloadClock = cfg.reloadDuration; return 'reload'; }
      if (visible && weaponReady && rounds > 0 && cooldown <= 0 && reaction <= 0 && distance < cfg.sightRange) {
        rounds--; cooldown = cfg.shotInterval; return 'fire';
      }
    }
    return '';
  }

  function think(agent, ctx) {
    const p = agent.perception, intent = agent.intent, dt = ctx.dt, player = ctx.player;
    intent.telegraph = 0; intent.hasAim = false; intent.crouch = false; intent.hasLook = false; intent.gait = 'walk';
    if (state === 'dead') { intent.state = intent.mode = 'dead'; stand(agent); return; }
    if (agent.physical !== 'standing') return pauseForPhysical(agent, ctx);
    paused = false; intent.paused = false;
    clock += dt;
    stagger = Math.max(0, stagger - dt);
    suppression = Math.max(0, suppression - dt * T.SUPPRESSION_DECAY);
    reportClock = Math.max(0, reportClock - dt);
    const visible = player.active && p.seen && p.seenAge <= T.PERCEPTION_HOLD + ctx.tickDt;
    if (visible) playerSample(player, p.seenIndex, agent.eye, target); else { target.x = p.lastKnown.x; target.y = p.lastKnown.y; target.z = p.lastKnown.z; }
    agent.prevUnseen = p.unseenTime;
    updateAwareness(p, agent.sense, dt, visible, target);
    eye.x = agent.eye.x; eye.y = agent.eye.y; eye.z = agent.eye.z;
    const distance = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
    const engagedView = visible && state === 'engage';
    if (engagedView && clock >= laneCheckAt) {
      laneCheckAt = clock + T.LANE_CHECK_INTERVAL;
      aimPoint(target, aim);
      laneClear = !ray(ctx, eye, aim);
    }
    blockedShot = engagedView && !laneClear ? blockedShot + dt : 0;
    tactics(agent, ctx, visible);
    // facing: the threat while fighting, else the tactic's look, else the walk direction
    const speed = intent.speed;
    if (visible && ['engage', 'reload', 'exhausted'].includes(state)) faceToward(agent, target);
    else if (hasLook) faceToward(agent, look);
    else faceVelocity(agent);
    intent.crouch = (['reload', 'exhausted'].includes(state) || crouching()) && speed < 0.2;
    intent.gait = speed > 1.2 ? 'run' : 'walk';
    if (p.memory > 0 || visible) { intent.hasLook = true; intent.look.x = target.x; intent.look.y = target.y; intent.look.z = target.z; }
    aimPoint(target, aim);
    const aiming = visible && state === 'engage' && speed < 0.2 && stagger <= 0;
    if (aiming) { intent.hasAim = true; intent.aim.x = aim.x; intent.aim.y = aim.y; intent.aim.z = aim.z; }
    updateTelegraph(agent, ctx, dt, aiming);
    intent.telegraph = aiming ? Math.min(1, telegraphClock / cfg.telegraphTime) : 0;
    const aligned = Math.abs(wrapAngle(agent.yaw - yawTo(eye, aim))) <= cfg.aimTolerance * DEG;
    let ready = aiming && telegraphClock >= cfg.telegraphTime && aligned;
    ready = ready && cooldown <= dt && reaction <= dt && rounds > 0;
    const turn = ready && ctx.squad.mayFire(agent);
    fireDenied = ready && !turn ? fireDenied + dt : (ready ? 0 : Math.max(0, fireDenied - dt));
    ready = turn && !ray(ctx, eye, aim);
    const action = brainTick(agent, dt, visible, distance, ready);
    if (action === 'reload') { intent.actions.push({ type: 'reload', duration: cfg.reloadDuration }); ctx.emit('reload', { agent }); }
    if (action === 'fire') {
      const shot = { type: 'fire', origin: { ...eye }, aim: { ...aim }, target: { ...target }, rounds, seed: agent.rng.state };
      intent.actions.push(shot);
      ctx.emit('fire', { agent, ...shot });
      ctx.squad.noteFire(agent); shots++;
      settle = player.speed < 0.6 ? settle + 1 : 0;
      resampleAim(agent, ctx, target);
      report(agent, ctx, 'shot', target);
    }
    if (visible && (state === 'engage' || state === 'exhausted')) report(agent, ctx, 'contact', target);
    intent.state = tactic; intent.mode = state;
  }

  function pauseForPhysical(agent, ctx) {
    if (!paused) {
      paused = true;
      if (state === 'reload') { reloadClock = 0; state = 'investigate'; }   // interrupt: consumes and transfers nothing
      telegraphClock = 0; telegraphEmitted = false;
    }
    agent.intent.paused = true; agent.intent.state = tactic; agent.intent.mode = state;
    stand(agent);
  }

  function ray(ctx, a, b) { return ctx.raycast(a, b); }   // ctx.raycast counts every ray in world.stats()

  function aimPoint(t, out) {
    out.x = t.x; out.y = t.y; out.z = t.z;
    if (!jitterX && !jitterY) return out;
    const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z, d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return out;
    // right = toward x up, up = right x toward (guard.gd aim_point)
    let rx = -dz, rz = dx; const rl = Math.hypot(rx, rz);
    if (rl < 0.01) return out;
    rx /= rl; rz /= rl;
    const ux = -rz * dy, uy = rz * dx - rx * dz, uz = rx * dy, ul = Math.hypot(ux, uy, uz) || 1;
    const h = Math.tan(jitterX * DEG) * d, v = Math.tan(jitterY * DEG) * d;
    out.x += rx * h + ux / ul * v; out.y += uy / ul * v; out.z += rz * h + uz / ul * v;
    return out;
  }
  function resampleAim(agent, ctx, t) {
    const d = flatDistance(agent.position, t);
    const spread = spreadDeg(cfg, d, ctx.player.speed, suppression, settle);
    const radius = spread * Math.sqrt(agent.rng.next()), angle = agent.rng.angle();
    jitterX = Math.cos(angle) * radius; jitterY = Math.sin(angle) * radius;
  }
  function updateTelegraph(agent, ctx, dt, aiming) {
    if (aiming) {
      aimLost = 0;
      if (!telegraphEmitted) {
        telegraphEmitted = true; telegraphClock = 0; telegraphs++; settle = 0;
        resampleAim(agent, ctx, target);
        ctx.emit('telegraph', { agent, kind: 'aim', at: { ...target } });
        announce(agent, ctx, 'contact', target);
      } else telegraphClock += dt;   // the full telegraph time passes after the event
    } else {
      aimLost += dt;
      if (aimLost > T.TELEGRAPH_RESET) { telegraphEmitted = false; telegraphClock = 0; }
    }
  }
  function announce(agent, ctx, kind, at) {
    ctx.squad.noteCallout();
    ctx.emit('callout', { agent, kind, at: { x: at.x, y: at.y, z: at.z } });
  }
  /** Single hop to at most reportRecipients guards in reportRadius; receiving never reports again. */
  function report(agent, ctx, kind, at) {
    if (state === 'dead' || reportClock > 0) return;
    reportClock = T.STIMULUS_REPORT;
    agent.reportsSent = (agent.reportsSent ?? 0) + 1;
    const scfg = ctx.squad.config;
    let delivered = 0;
    for (const other of ctx.agents) {
      if (other === agent || other.dead || other.brain.kind !== 'guard') continue;
      if (flatDistance(agent.position, other.position) > scfg.reportRadius) continue;
      other.brain.receiveReport(other, kind, at, ctx);
      if (++delivered >= scfg.reportRecipients) break;
    }
    if (delivered) ctx.emit('report', { agent, kind, at: { x: at.x, y: at.y, z: at.z }, delivered });
  }

  // ---- tactics (guard_tactics.gd)
  function setTactic(agent, ctx, name) {
    if (name === tactic) return;
    if (['investigate', 'search', 'hold'].includes(tactic) && !['investigate', 'search'].includes(name)) ctx.squad.releaseInvestigation(agent);
    if (tactic === 'flank') { hasFlank = false; ctx.squad.releaseFlank(agent); }
    if ((tactic === 'cover' || tactic === 'retreat') && name !== 'cover' && name !== 'retreat') { hasCover = false; coverPhase = 'move'; }
    if (tactic === 'search') searchPoints.length = 0;
    const from = tactic;
    tactic = name; dwell = 0;
    ctx.emit('state', { agent, from, to: name });
  }
  function tactics(agent, ctx, visible) {
    const dt = ctx.dt;
    engageClock = state === 'engage' ? engageClock + dt : 0;
    coverRetry = Math.max(0, coverRetry - dt); holdRecheck = Math.max(0, holdRecheck - dt);
    hasLook = false;
    stand(agent);
    if (stagger <= 0) setTactic(agent, ctx, decide(agent, ctx, visible));
    if (stagger > 0) return;
    const head = ctx.player.active ? ctx.player.head : agent.perception.lastKnown;
    switch (tactic) {
      case 'patrol': return patrol(agent, ctx);
      case 'suspicious': case 'hold': setLook(agent.perception.lastKnown); return;
      case 'investigate': return investigate(agent, ctx);
      case 'search': return search(agent, ctx);
      case 'combat': return combat(agent, ctx, visible);
      case 'cover': case 'retreat': return cover(agent, ctx, head);
      case 'flank': return flank(agent, ctx);
    }
  }
  function setLook(p) { hasLook = true; look.x = p.x; look.y = p.y; look.z = p.z; }
  function decide(agent, ctx, visible) {
    const p = agent.perception, squad = ctx.squad;
    switch (state) {
      case 'patrol':
        if (tactic === 'search') return 'patrol';
        return p.suspicion >= SUSPICIOUS_AT && p.memory > 0 ? 'suspicious' : 'patrol';
      case 'investigate':
        if ((tactic === 'cover' || tactic === 'retreat') && hasCover && peeks < 3) return tactic;
        if (tactic === 'search' && flatDistance(p.lastKnown, searchCenter) <= T.SEARCH_RADIUS) return 'search';
        if (tactic === 'hold' && holdRecheck > 0) return 'hold';
        if (!squad.claimInvestigation(agent, p.lastKnown)) { holdRecheck = 1; return 'hold'; }
        return 'investigate';
      case 'engage': {
        if (health <= cfg.retreatHealth && !retreated) return 'retreat';
        if ((tactic === 'cover' || tactic === 'retreat') && hasCover) return tactic;
        if (suppression >= T.SUPPRESSED_AT && coverRetry <= 0) return 'cover';
        if (tactic === 'flank' && hasFlank) return 'flank';
        // flank when this guard has no useful shot: no view, a blocked lane, or turn-taking keeps it waiting
        const idle = !visible || blockedShot > 0.65 || fireDenied > T.FLANK_WHEN_DENIED || cfg.aggression >= 0.7;
        const wants = engageClock > T.FLANK_AFTER * (1.5 - cfg.aggression) && idle;
        if (wants && squad.takeHeavyQuery() && squad.requestFlank(agent, ctx.agents)) {
          if (chooseFlank(agent, ctx, ctx.player.active ? ctx.player.head : p.lastKnown)) return 'flank';
          squad.releaseFlank(agent); engageClock = 0;
        }
        return 'combat';
      }
      case 'reload': case 'exhausted':
        return tactic === 'retreat' ? 'retreat' : 'cover';
    }
    return tactic;
  }
  function patrol(agent, ctx) {
    const goal = route[routeIndex];
    if (flatDistance(agent.position, goal) > 0.25) { moveTo(agent, ctx, goal, cfg.walkSpeed, 0.2); return; }
    patrolPause += ctx.dt;
    if (patrolPause > 1.5) { patrolPause = 0; routeIndex = (routeIndex + 1) % route.length; }
  }
  function investigate(agent, ctx) {
    const p = agent.perception, goal = ctx.nav.closest(p.lastKnown, tmp) ?? p.lastKnown;
    const r = flatDistance(agent.position, goal) < 1 ? 'arrived' : moveTo(agent, ctx, goal, p.alert ? cfg.alertSpeed : cfg.walkSpeed, 0.5);
    if (r !== 'moving') {
      // arrived, or the stimulus is unreachable: search from the closest reachable point
      searchCenter.x = p.lastKnown.x; searchCenter.y = p.lastKnown.y; searchCenter.z = p.lastKnown.z;
      searchElapsed = 0;
      ctx.emit('note', { agent, reason: 'search_arrival' });
      setTactic(agent, ctx, 'search');
    }
  }
  function search(agent, ctx) {
    const p = agent.perception;
    searchElapsed += ctx.dt;
    if (searchElapsed >= cfg.searchDuration) {
      // timed out: forget the stimulus; the brain drops to patrol on its next tick
      p.memory = 0; p.suspicion = Math.min(p.suspicion, SUSPICIOUS_AT * 0.5);
      ctx.emit('note', { agent, reason: 'search_timeout' });
      return;
    }
    p.memory = Math.max(p.memory, 1);
    if (!searchPoints.length) planSearch(agent, ctx);
    const pt = searchPoints[searchIndex];
    if (flatDistance(agent.position, pt) > T.ARRIVE + 0.1 && dwell <= 0) { if (moveTo(agent, ctx, pt, cfg.walkSpeed, T.ARRIVE) === 'moving') return; }
    dwell += ctx.dt;
    // sweep the view about the stimulus while dwelling
    let a = yawTo(agent.position, searchCenter);
    if (flatDistance(agent.position, searchCenter) < 0.5) a = agent.yaw;
    a += Math.sin(dwell * 1.6) * 1.1;
    look.x = agent.position.x + Math.sin(a); look.y = agent.position.y; look.z = agent.position.z + Math.cos(a); hasLook = true;
    if (dwell >= T.SEARCH_DWELL) { dwell = 0; searchIndex = (searchIndex + 1) % searchPoints.length; }
  }
  function planSearch(agent, ctx) {
    searchPoints.length = 0; searchIndex = 0;
    const path = agent.move.path;
    ctx.nav.findPath(agent.position, searchCenter, path);
    const end = path.length ? path[path.length - 1] : agent.position;
    const center = point(end.x, end.y, end.z);
    searchPoints.push(center);
    for (let i = 0; i < T.SEARCH_POINTS; i++) {
      const a = agent.rng.angle(), r = agent.rng.range(1.5, T.SEARCH_RADIUS);
      tmp2.x = center.x + Math.cos(a) * r; tmp2.y = center.y; tmp2.z = center.z + Math.sin(a) * r;
      const c = ctx.nav.closest(tmp2, point());
      if (c && flatDistance(c, center) > 0.8) searchPoints.push(c);
    }
    agent.move.hasPath = false;
  }
  function combat(agent, ctx, visible) {
    // hold and shoot; a blocked lane moves the body to a side spot with a clear lane (bounded local reposition)
    if (visible || agent.perception.memory > 0) setLook(target);
    if (blockedShot > 0.65 && ctx.squad.takeHeavyQuery()) {
      const dx = target.x - agent.position.x, dz = target.z - agent.position.z, d = Math.hypot(dx, dz) || 1;
      for (const off of [0.8, -0.8, 1.5, -1.5]) {
        tmp2.x = agent.position.x + dz / d * off; tmp2.y = agent.position.y; tmp2.z = agent.position.z - dx / d * off;
        if (!ctx.nav.walkable(tmp2.x, tmp2.z) || !ctx.nav.segmentClear(agent.position, tmp2)) continue;
        sample.x = tmp2.x; sample.y = tmp2.y + cfg.eyeHeight; sample.z = tmp2.z;
        if (ray(ctx, sample, target)) continue;
        coverGoal.x = tmp2.x; coverGoal.y = tmp2.y; coverGoal.z = tmp2.z; agent.reposition = true;
        ctx.emit('note', { agent, reason: 'blocked_shot_reposition' });
        blockedShot = 0;
        break;
      }
    }
    if (agent.reposition) {
      if (moveTo(agent, ctx, coverGoal, 1.1, 0.12) !== 'moving') agent.reposition = false;
    }
  }
  function cover(agent, ctx, head) {
    const dt = ctx.dt;
    if (!hasCover) {
      if (coverRetry > 0 || !ctx.squad.takeHeavyQuery()) return;
      coverRetry = T.COVER_RETRY;
      const found = chooseCover(agent, ctx, head, tactic === 'retreat');
      if (tactic === 'retreat') retreated = true;
      ctx.emit('note', { agent, reason: found ? 'cover_selected' : 'no_cover' });
      if (!found) return;
    }
    setLook(head);
    if (coverPhase === 'peek') {
      peekClock += dt;
      if (peekClock > T.PEEK_MAX || suppression >= T.SUPPRESSED_AT || state === 'reload' || state === 'exhausted') { coverPhase = 'move'; coverClock = 0; }
      else if (flatDistance(agent.position, coverPeek) > T.ARRIVE) moveTo(agent, ctx, coverPeek, cfg.tacticalSpeed, T.ARRIVE);
      return;
    }
    if (flatDistance(agent.position, coverGoal) > T.ARRIVE + 0.05) {
      coverPhase = 'move';
      if (moveTo(agent, ctx, coverGoal, cfg.tacticalSpeed, T.ARRIVE) === 'blocked') hasCover = false;
      return;
    }
    if (coverPhase !== 'hold') { coverPhase = 'hold'; coverClock = 0; ctx.emit('note', { agent, reason: 'cover_hold' }); }
    coverClock += dt;
    // the player moved far enough that this cover may face the wrong way: re-plan
    if (Math.hypot(head.x - coverThreat.x, head.y - coverThreat.y, head.z - coverThreat.z) > 2.5) { hasCover = false; coverRetry = 0; return; }
    if (coverClock >= T.COVER_MIN_HOLD && state !== 'reload' && state !== 'exhausted' && suppression < T.SUPPRESSED_AT * 0.5) {
      if (hasPeek) { coverPhase = 'peek'; peekClock = 0; peeks++; }
      else { hasCover = false; coverRetry = T.COVER_RETRY * 2; setTactic(agent, ctx, state === 'engage' ? 'combat' : 'investigate'); }
    }
  }
  function flank(agent, ctx) {
    flankClock += ctx.dt;
    const r = moveTo(agent, ctx, flankGoal, cfg.tacticalSpeed, T.ARRIVE);
    if (flankClock > T.FLANK_TIMEOUT || r !== 'moving') { ctx.emit('note', { agent, reason: 'flank_done' }); setTactic(agent, ctx, 'combat'); }
  }

  /**
   * Cover that hides the crouched head and chest from the player's head and its lean / duck offsets, reachable on the
   * navmesh, preferring spots with a peek position (guard_tactics.gd choose_cover).
   */
  function chooseCover(agent, ctx, head, retreat) {
    const origin = agent.position, nav = ctx.nav;
    const current = flatDistance(origin, head);
    const candidates = [];
    for (const ring of retreat ? RETREAT_RINGS : COVER_RINGS) {
      for (let i = 0; i < DIRECTIONS; i++) {
        const a = TAU * (i + 0.5 * (Math.round(ring * 10) % 2)) / DIRECTIONS;
        const c = { x: origin.x + Math.cos(a) * ring, y: origin.y, z: origin.z + Math.sin(a) * ring };
        const toPlayer = flatDistance(c, head);
        if (toPlayer < 3) continue;
        if (retreat && toPlayer < current + 2) continue;
        c.score = ring + Math.max(0, current - toPlayer) * 2;   // short moves that do not close on the player
        candidates.push(c);
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const headH = cfg.eyeHeight + 0.1 - cfg.crouchDrop, chestH = cfg.eyeHeight - 0.45 - cfg.crouchDrop;
    let rays = 0, best = Infinity, chosen = null, chosenPeek = null;
    const eyeP = point(), body = point(), spot = point();
    for (const raw of candidates) {
      if (rays > T.COVER_RAY_BUDGET) break;
      const pt = nav.closest(raw, point());
      if (!pt || flatDistance(pt, raw) > 0.6) continue;
      pt.y = origin.y;
      let lx = pt.x - head.x, lz = pt.z - head.z; const ll = Math.hypot(lx, lz) || 1;
      lx /= ll; lz /= ll;
      const sideX = -lz, sideZ = lx;   // lateral (horizontal, across the line from the head)
      let isProtected = true;
      for (const [ex, ey, ez] of [[0, 0, 0], [sideX * T.HEAD_LEAN, 0, sideZ * T.HEAD_LEAN], [-sideX * T.HEAD_LEAN, 0, -sideZ * T.HEAD_LEAN], [0, -T.HEAD_DUCK, 0]]) {
        eyeP.x = head.x + ex; eyeP.y = head.y + ey; eyeP.z = head.z + ez;
        for (const [bx, by, bz] of [[0, headH, 0], [sideX * 0.15, headH, sideZ * 0.15], [-sideX * 0.15, headH, -sideZ * 0.15], [0, chestH, 0]]) {
          body.x = pt.x + bx; body.y = pt.y + by; body.z = pt.z + bz;
          rays++;
          if (!ctx.raycast(eyeP, body)) { isProtected = false; break; }
        }
        if (!isProtected) break;
      }
      if (!isProtected) continue;
      const path = [];
      if (!nav.findPath(origin, pt, path) || flatDistance(path[path.length - 1], pt) > 0.4) continue;
      const length = pathLength(origin, path);
      if (length > 2.5 * flatDistance(origin, pt) + 2) continue;
      let peek = null;
      for (const off of [0, 0.8, -0.8, 1.2, -1.2]) {
        let s = pt;
        if (off) { spot.x = pt.x + sideX * off; spot.y = pt.y; spot.z = pt.z + sideZ * off; s = nav.closest(spot, point()); if (!s || flatDistance(s, spot) > 0.3) continue; }
        rays++;
        eyeP.x = s.x; eyeP.y = s.y + cfg.eyeHeight; eyeP.z = s.z;
        if (!ctx.raycast(eyeP, head)) { peek = s; break; }
      }
      const score = length + (peek ? 0 : 3);
      if (score < best) { best = score; chosen = pt; chosenPeek = peek; }
      if (peek) break;
    }
    coverRays += rays; ctx.stats.coverRays += rays;
    if (!chosen) return false;
    hasCover = true; coverGoal.x = chosen.x; coverGoal.y = chosen.y; coverGoal.z = chosen.z;
    hasPeek = !!chosenPeek; if (chosenPeek) { coverPeek.x = chosenPeek.x; coverPeek.y = chosenPeek.y; coverPeek.z = chosenPeek.z; }
    coverThreat.x = head.x; coverThreat.y = head.y; coverThreat.z = head.z;
    coverPhase = 'move'; peeks = 0;
    return true;
  }
  /** A reachable point to one side of the player with a clear view of the player's head (choose_flank). */
  function chooseFlank(agent, ctx, head) {
    const nav = ctx.nav;
    let ax = agent.position.x - head.x, az = agent.position.z - head.z; const al = Math.hypot(ax, az);
    if (al < 0.5) return false;
    ax /= al; az /= al;
    const side = agent.index % 2 === 0 ? 1 : -1, eyeP = point(), path = [];
    for (const sign of [side, -side]) for (const deg of [75, 105]) {
      const a = deg * DEG * sign, c = Math.cos(a), s = Math.sin(a);
      // rotate (ax, az) about +Y
      tmp2.x = head.x + (ax * c + az * s) * T.FLANK_DISTANCE; tmp2.y = agent.position.y; tmp2.z = head.z + (-ax * s + az * c) * T.FLANK_DISTANCE;
      const pt = nav.closest(tmp2, point());
      if (!pt || flatDistance(pt, head) < 4) continue;
      eyeP.x = pt.x; eyeP.y = agent.position.y + cfg.eyeHeight; eyeP.z = pt.z;
      if (ray(ctx, eyeP, head)) continue;
      if (!nav.findPath(agent.position, pt, path) || pathLength(agent.position, path) > T.FLANK_DISTANCE * 3) continue;
      flankGoal.x = pt.x; flankGoal.y = pt.y; flankGoal.z = pt.z; hasFlank = true; flankClock = 0;
      announce(agent, ctx, 'flanking', pt);
      ctx.emit('note', { agent, reason: 'flank_selected' });
      return true;
    }
    return false;
  }
  return brain;
}
