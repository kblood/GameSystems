// GameSystems ai extension: perception. Pure (no three.js); occlusion comes from the injected raycast(from, to), which
// returns something truthy when the segment is blocked. Ported from NightfallContractsGodot core/guard_tuning.gd
// (sight_rate) and runtime/guard.gd (update_perception, hear), MIT, Copyright (c) 2026 Kasper Olesen.
//
// Sight: up to `samples` points on the player (tracked head, torso, torso sides) inside a view cone and range, each
// checked with one ray, stopping at the first visible one. A seen sample builds suspicion at a rate that depends on
// distance, periphery, light, crouch (head height) and motion; unseen, suspicion decays. Suspicion 1 is contact.
// Hearing: a stimulus (gunshot, impact, footstep) is heard inside its radius x the agent's hearing, quieter through
// walls, and localised with an error that grows with distance. Hearing moves the last known position and memory; it never
// sets `seen`, so it can never give a firing target.
import { DEG, clamp, lerp, facingCos, point } from './math.js';

export const PERCEPTION_DEFAULTS = Object.freeze({
  sightRange: 23,            // m
  viewHalfAngle: 65,         // deg, calm cone
  alertViewHalfAngle: 87,    // deg, once alerted
  focusHalfAngle: 35,        // deg, full-rate central vision; outside it peripheralRate
  peripheralRate: 0.45,
  nearRange: 7,              // m, full rate inside, falling to minDistanceRate at sightRange
  minDistanceRate: 0.25,
  darkRate: 0.35,            // rate at light 0
  standingHeadHeight: 1.55,  // m, a lower head (crouch) is harder to see
  crouchRate: 0.6,
  motionRatePerMps: 0.18,    // a moving player is easier to see
  motionRateCap: 1.5,
  detectionRate: 1.5,        // suspicion per second at rate 1
  alertBoost: 1.6,           // faster once alerted
  decayRate: 0.25,           // suspicion lost per second unseen
  memory: 8,                 // s a seen position is remembered
  hearingMemory: 7,          // s a heard position is remembered
  alertDecay: 12,            // s of quiet before the agent calms down
  hearing: 1,                // multiplier on stimulus radii
  hearingErrorPerM: 0.05,    // localisation error per metre (doubled through walls)
  hearingErrorMax: 2,
  occludedHearing: 0.35,     // loudness factor through a wall
  stimulusWindow: 0.4,       // s: a louder stimulus inside this window wins
  samples: 4,                // head, torso, torso sides
  eyeHeight: 1.6,            // m, standing eye height (body.eyeHeight wins)
  senseRadius: 0,            // m: closer than this the agent notices the player without sight (touch, smell)
});
export const SUSPICIOUS_AT = 0.25;
export const INVESTIGATE_AT = 0.5;

export function createPerceptionState() {
  return {
    suspicion: 0, alert: false, seen: false, seenIndex: 1, seenRate: 1, seenAge: Infinity, seenPoint: point(),
    lastKnown: point(), memory: 0, quietTime: 100, unseenTime: 100, contact: false,
    heard: point(), heardAge: Infinity, heardLoudness: 0, heardType: '', stimulusClock: -10,
    sensed: false, rays: 0,
  };
}
export function resetPerception(p) { Object.assign(p, createPerceptionState()); }

/** Perception rate multiplier (0..~1.5) for one visible sample (guard_tuning.gd sight_rate). */
export function sightRate(cfg, cosAngle, dist, light, headHeight, targetSpeed) {
  let rate = 1;
  if (cosAngle < Math.cos(cfg.focusHalfAngle * DEG)) rate *= cfg.peripheralRate;
  if (dist > cfg.nearRange) rate *= lerp(1, cfg.minDistanceRate, clamp((dist - cfg.nearRange) / Math.max(0.1, cfg.sightRange - cfg.nearRange), 0, 1));
  rate *= lerp(cfg.darkRate, 1, clamp(light, 0, 1));
  rate *= lerp(cfg.crouchRate, 1, clamp(headHeight / cfg.standingHeadHeight, 0, 1));
  rate *= Math.min(cfg.motionRateCap, 1 + cfg.motionRatePerMps * targetSpeed);
  return rate;
}

/** Player sample i (0 head, 1 torso, 2/3 torso sides across the line of sight) into out. */
export function playerSample(player, i, eye, out) {
  const h = player.head;
  out.x = h.x; out.y = h.y; out.z = h.z;
  if (i === 0) return out;
  out.y -= Math.min(0.38, Math.max(0.12, (h.y - player.floorY) * 0.3));
  if (i === 1) return out;
  const dx = h.x - eye.x, dz = h.z - eye.z, d = Math.hypot(dx, dz) || 1, s = i === 2 ? 0.16 : -0.16;
  out.x += dz / d * s; out.z -= dx / d * s;
  return out;
}

const sample = point();
/**
 * One budgeted sight update. eye: world eye point; yaw: facing. Casts at most maxRays rays; returns the number used.
 * Sets p.seen / seenPoint / seenRate (seenAge 0) when a sample is visible.
 */
export function look(p, cfg, eye, yaw, player, raycast, maxRays) {
  p.seen = false; p.sensed = false;
  if (!player.active) return 0;
  const cone = Math.cos((p.alert ? cfg.alertViewHalfAngle : cfg.viewHalfAngle) * DEG);
  let rays = 0;
  for (let k = 0; k < cfg.samples; k++) {
    const i = k === 0 ? 1 : k === 1 ? 0 : k;   // torso first (aim at centre mass), then head, then the sides
    playerSample(player, i, eye, sample);
    const d = Math.hypot(sample.x - eye.x, sample.y - eye.y, sample.z - eye.z);
    if (d >= cfg.sightRange || d < 0.01) continue;
    const facing = facingCos(yaw, eye, sample);
    if (facing <= cone) continue;
    if (rays >= maxRays) break;
    rays++;
    if (!raycast(eye, sample)) {
      p.seen = true; p.seenIndex = i; p.seenAge = 0;
      p.seenPoint.x = sample.x; p.seenPoint.y = sample.y; p.seenPoint.z = sample.z;
      p.seenRate = sightRate(cfg, facing, d, player.light, player.head.y - player.floorY, player.speed);
      break;
    }
  }
  p.rays += rays;
  return rays;
}

/** Touch/smell sense: inside senseRadius (flat) the player is noticed without a ray (zombies; guards use 0). */
export function sense(p, cfg, position, player) {
  if (!player.active || cfg.senseRadius <= 0) return false;
  const d = Math.hypot(player.head.x - position.x, player.head.z - position.z);
  if (d > cfg.senseRadius) return false;
  p.sensed = true;
  return true;
}

/**
 * Suspicion, memory and alertness over dt (guard_brain.gd tick, perception part). visible: seen this update (or held);
 * target: where. Returns true on the update the agent reaches contact.
 */
export function updateAwareness(p, cfg, dt, visible, target) {
  p.memory = Math.max(0, p.memory - dt);
  p.quietTime += dt;
  p.seenAge += dt; p.heardAge += dt;
  p.unseenTime = visible ? 0 : p.unseenTime + dt;
  let reached = false;
  if (visible) {
    const before = p.suspicion;
    p.suspicion = Math.min(1, p.suspicion + dt * cfg.detectionRate * p.seenRate * (p.alert ? cfg.alertBoost : 1));
    reached = before < 1 && p.suspicion >= 1;
    p.lastKnown.x = target.x; p.lastKnown.y = target.y; p.lastKnown.z = target.z;
    p.memory = cfg.memory; p.quietTime = 0;
  } else p.suspicion = Math.max(0, p.suspicion - dt * cfg.decayRate);
  if (p.quietTime >= cfg.alertDecay) { p.alert = false; p.contact = false; }
  return reached;
}

/**
 * A stimulus { type, position, radius } reaches a listener at `ear`. Returns the loudness (0: not heard). raycast is
 * optional (no occlusion test without it). rng: the agent's generator, for the localisation error.
 */
export function hear(p, cfg, stimulus, ear, raycast, rng, clock) {
  const pos = stimulus.position, radius = (stimulus.radius ?? 0) * cfg.hearing;
  const d = Math.hypot(pos.x - ear.x, pos.y - ear.y, pos.z - ear.z);
  if (radius <= 0 || d > radius) return 0;
  let blocked = false;
  if (raycast && d > 0.5) { sample.x = pos.x; sample.y = pos.y + 0.3; sample.z = pos.z; blocked = !!raycast(ear, sample); p.rays++; }
  const loudness = (1 - d / radius) * (blocked ? cfg.occludedHearing : 1);
  if (loudness < 0.1) return 0;
  if (clock - p.stimulusClock < cfg.stimulusWindow && loudness < p.heardLoudness) return 0;
  p.stimulusClock = clock; p.heardLoudness = loudness; p.heardType = stimulus.type ?? 'noise'; p.heardAge = 0;
  const error = Math.min(cfg.hearingErrorMax, d * cfg.hearingErrorPerM * (blocked ? 2 : 1)) * Math.sqrt(rng.next()), bearing = rng.angle();
  p.heard.x = pos.x + Math.cos(bearing) * error; p.heard.y = pos.y; p.heard.z = pos.z + Math.sin(bearing) * error;
  p.lastKnown.x = p.heard.x; p.lastKnown.y = p.heard.y; p.lastKnown.z = p.heard.z;
  p.memory = Math.max(p.memory, cfg.hearingMemory); p.quietTime = 0; p.alert = true;
  return loudness;
}
