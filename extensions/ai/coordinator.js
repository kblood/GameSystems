// GameSystems ai extension: group coordination. Pure (no three.js).
//
// Squad (guards), ported from NightfallContractsGodot runtime/guard_squad.gd (MIT, Copyright (c) 2026 Kasper Olesen):
// - fire discipline: a minimum gap between different agents' shots and a cap on how many agents are shooting inside a
//   short window, so there are no synchronized volleys;
// - investigation claims: the nearest few investigate one stimulus area, the others hold and watch;
// - one flanker at a time (and only while at least two agents are engaged);
// - heavy queries (cover / flank searches) limited per tick;
// - callouts (contact, flanking, heard shot), routed by the AI world as events and single-hop reports.
//
// Horde (zombies):
// - surround slots: angles around the target, so zombies spread around the player instead of stacking; a slot is used
//   only when its point is walkable and reachable in a straight line from the player;
// - an escape lane: the most open direction from the player never gets a slot, so a horde cannot pin the player
//   against a wall with no way out (docs/vr/npc_ai.md);
// - attack tokens: at most maxAttackers zombies wind up or attack at once.
import { TAU, wrapAngle, point } from './math.js';

export const SQUAD_DEFAULTS = Object.freeze({
  maxConcurrentShooters: 2, shooterWindow: 1.05, minShotGap: 0.22, shotLog: 16,
  investigatorsMax: 2, sameStimulusRadius: 6, flankersMax: 1, heavyQueriesPerTick: 1,
  reportRadius: 14, reportRecipients: 8, reportCooldown: 2.5,
});

export function createSquad(config = {}) {
  const cfg = { ...SQUAD_DEFAULTS, ...config };
  const shotTimes = [], shotAgents = [], investigators = [], flankers = [], counted = [];
  const investigationOrigins = new Map();
  function pruneInvestigations(members = null) {
    for (let i = investigators.length - 1; i >= 0; i--) {
      const agent = investigators[i], origin = investigationOrigins.get(agent);
      if (agent.dead || (members && !members.includes(agent)) || !origin || dist(origin, agent.memoryPoint) >= cfg.sameStimulusRadius) {
        investigators.splice(i, 1); investigationOrigins.delete(agent);
      }
    }
  }
  let clock = 0, heavyLeft = cfg.heavyQueriesPerTick, callouts = 0;
  const squad = {
    config: cfg, investigators, flankers,
    get clock() { return clock; },
    get callouts() { return callouts; },
    tick(dt, members) {
      clock += dt; heavyLeft = cfg.heavyQueriesPerTick;
      pruneInvestigations(members);
      for (const list of [flankers]) for (let i = list.length - 1; i >= 0; i--) if (list[i].dead || !members.includes(list[i])) list.splice(i, 1);
    },
    /** True when this agent may release a round now (turn-taking). */
    mayFire(agent) {
      let others = 0, active = false;
      counted.length = 0;
      for (let i = shotTimes.length - 1; i >= 0; i--) {
        const age = clock - shotTimes[i];
        if (age > cfg.shooterWindow) break;
        const shooter = shotAgents[i];
        if (shooter === agent) { active = true; continue; }
        if (age < cfg.minShotGap) return false;
        if (!counted.includes(shooter)) { counted.push(shooter); others++; }
      }
      return active || others < cfg.maxConcurrentShooters;
    },
    noteFire(agent) {
      shotTimes.push(clock); shotAgents.push(agent);
      if (shotTimes.length > cfg.shotLog) { shotTimes.shift(); shotAgents.shift(); }
    },
    /** The nearest investigatorsMax agents investigate one area; a closer agent replaces the farthest claimant. */
    claimInvestigation(agent, at) {
      pruneInvestigations();
      // A held claim belongs to its granted area, not a moving memoryPoint.
      if (investigators.includes(agent) && dist(investigationOrigins.get(agent), at) >= cfg.sameStimulusRadius) squad.releaseInvestigation(agent);
      if (investigators.includes(agent)) return true;
      const same = investigators.filter(o => dist(investigationOrigins.get(o), at) < cfg.sameStimulusRadius);
      if (same.length < cfg.investigatorsMax) { investigators.push(agent); investigationOrigins.set(agent, { ...at }); return true; }
      let farthest = null, far = dist(agent.position, at);
      for (const o of same) { const d = dist(o.position, at); if (d > far + 1) { far = d; farthest = o; } }
      if (!farthest) return false;
      squad.releaseInvestigation(farthest); investigators.push(agent); investigationOrigins.set(agent, { ...at });
      return true;
    },
    releaseInvestigation(agent) { const i = investigators.indexOf(agent); if (i >= 0) investigators.splice(i, 1); investigationOrigins.delete(agent); },
    requestFlank(agent, members) {
      if (flankers.includes(agent)) return true;
      if (flankers.length >= cfg.flankersMax) return false;
      if (members.filter(m => !m.dead && m.brain.engaged?.(m)).length < 2) return false;   // a lone guard holds
      flankers.push(agent);
      return true;
    },
    releaseFlank(agent) { const i = flankers.indexOf(agent); if (i >= 0) flankers.splice(i, 1); },
    takeHeavyQuery() { if (heavyLeft <= 0) return false; heavyLeft--; return true; },
    noteCallout() { callouts++; },
    reset() { investigationOrigins.clear(); shotTimes.length = shotAgents.length = investigators.length = flankers.length = 0; clock = 0; callouts = 0; },
  };
  return squad;
}

export const HORDE_DEFAULTS = Object.freeze({
  maxAttackers: 2,        // zombies winding up or attacking at once
  spacing: 0.65,          // m between neighbouring slots on a ring
  maxSlots: 8,
  escapeHalfAngle: 40,    // deg: no slot this close to the escape lane
  laneProbe: 3,           // m: how far the escape lane search looks for open floor
  waitRadius: 2.1,        // m: zombies without a slot wait on this ring
});

/**
 * Horde coordinator. update(target, agents, nav) once per tick assigns every zombie in `agents` (those that want a
 * slot) an angle around target; agent.slot = { index, angle, valid }.
 */
export function createHorde(config = {}) {
  const cfg = { ...HORDE_DEFAULTS, ...config };
  const tokens = [], order = [], taken = new Uint8Array(32), angles = new Float32Array(32), valid = new Uint8Array(32);
  const probe = point(), slotPoint = point();
  let slots = 0, laneAngle = 0, ring = 0.8;
  const horde = {
    config: cfg, tokens,
    get slots() { return slots; },
    get laneAngle() { return laneAngle; },
    get ring() { return ring; },
    slotAngle: i => angles[i],
    slotValid: i => !!valid[i],
    /** Most open direction from p (longest walkable straight run, sampled in 16 directions). */
    escapeLane(p, nav) {
      let best = 0, bestLen = -1;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU;
        let len = 0;
        for (let s = 0.25; s <= cfg.laneProbe; s += 0.25) {
          if (!nav || nav.walkable(p.x + Math.sin(a) * s, p.z + Math.cos(a) * s)) len = s; else break;
        }
        if (len > bestLen + 1e-6) { bestLen = len; best = a; }
      }
      return best;
    },
    /** Ring radius standoff (m), agents wanting slots (sorted by distance, then id: deterministic). */
    update(target, agents, nav, standoff) {
      ring = standoff;
      laneAngle = horde.escapeLane(target, nav);
      slots = Math.max(3, Math.min(cfg.maxSlots, Math.floor(TAU * ring / cfg.spacing)));
      const lane = cfg.escapeHalfAngle * Math.PI / 180;
      for (let i = 0; i < slots; i++) {
        angles[i] = laneAngle + Math.PI + (i - (slots - 1) / 2) * (TAU / slots);   // slot 0..n spread opposite the lane
        slotPoint.x = target.x + Math.sin(angles[i]) * ring; slotPoint.y = target.y; slotPoint.z = target.z + Math.cos(angles[i]) * ring;
        valid[i] = Math.abs(wrapAngle(angles[i] - laneAngle)) > lane && (!nav || (nav.walkable(slotPoint.x, slotPoint.z) && nav.segmentClear(target, slotPoint))) ? 1 : 0;
        taken[i] = 0;
      }
      order.length = 0;
      for (const a of agents) order.push(a);
      order.sort((a, b) => (dist(a.position, target) - dist(b.position, target)) || (a.index - b.index));
      for (const a of order) {
        const bearing = Math.atan2(a.position.x - target.x, a.position.z - target.z);
        let best = -1, bestCost = Infinity;
        for (let i = 0; i < slots; i++) {
          if (!valid[i] || taken[i]) continue;
          // keep a held slot unless another is much closer to where the zombie stands
          const cost = Math.abs(wrapAngle(angles[i] - bearing)) - (a.slot?.index === i ? 0.35 : 0);
          if (cost < bestCost) { bestCost = cost; best = i; }
        }
        a.slot ??= { index: -1, angle: 0, valid: false };
        if (best >= 0) { taken[best] = 1; a.slot.index = best; a.slot.angle = angles[best]; a.slot.valid = true; }
        else { a.slot.index = -1; a.slot.angle = bearing; a.slot.valid = false; }
      }
      return slots;
    },
    /** Point of an agent's slot (or its waiting spot on the outer ring) at radius r around target. */
    slotPosition(agent, target, r, out) {
      const a = agent.slot?.angle ?? 0, radius = agent.slot?.valid ? r : Math.max(r, cfg.waitRadius);
      out.x = target.x + Math.sin(a) * radius; out.y = target.y; out.z = target.z + Math.cos(a) * radius;
      return out;
    },
    /** In the escape lane sector near the player? (agents there are steered out of it) */
    inLane(p, target) {
      const a = Math.atan2(p.x - target.x, p.z - target.z);
      return Math.abs(wrapAngle(a - laneAngle)) < cfg.escapeHalfAngle * Math.PI / 180;
    },
    requestAttack(agent) {
      if (tokens.includes(agent)) return true;
      if (tokens.length >= cfg.maxAttackers) return false;
      tokens.push(agent); return true;
    },
    releaseAttack(agent) { const i = tokens.indexOf(agent); if (i >= 0) tokens.splice(i, 1); },
    prune(members) { for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].dead || !members.includes(tokens[i])) tokens.splice(i, 1); },
    reset() { tokens.length = 0; },
  };
  return horde;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
