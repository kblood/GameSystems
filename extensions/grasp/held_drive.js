// Mass-scaled hold drive (port of the Godot held_drive.gd): the hand applies at most MAX_HOLD_FORCE to a held
// prop instead of rate-limiting the target. Light props track crisply; a heavy prop lags, contacts stay real.
// Target velocities come from the hand's CURRENT motion (createHandMotion/pushHandMotion: a short average, not the
// throw history's peak, which overshoots when the hand stops) and include the hand's spin: the driven point (the
// prop's centre of mass) moves with v + w x r (carriedVelocity), so the damping no longer fights a wrist turn.
import { add, sub, cross } from './math.js';

export const STIFFNESS = 900;
export const DAMPING = 60;
export const MAX_ACCELERATION = 90; // m/s^2
export const MAX_TORQUE = 1.5; // N m
export const MAX_HOLD_FORCE = 120; // N

export function accelerationLimit(mass) { return Math.min(MAX_ACCELERATION, MAX_HOLD_FORCE / Math.max(mass, 0.001)); }

/**
 * Linear drive acceleration (m/s^2, gravity already compensated) toward target position/velocity.
 * Implicit critically-damped spring (solved for the end of the step: x' = x + (v + a dt) dt against the target moved
 * on by targetVelocity dt), then clamped to the mass-scaled force cap. The body's own v dt is part of the error;
 * without it a prop moving with the hand settled one frame AHEAD of it and overshot when the hand stopped.
 */
export function driveAcceleration({ position, velocity, targetPosition, targetVelocity = [0, 0, 0], mass, dt, gravity = [0, -9.81, 0] }) {
  const denominator = 1 + DAMPING * dt + STIFFNESS * dt * dt;
  const a = [0, 1, 2].map(k => ((targetPosition[k] + (targetVelocity[k] - velocity[k]) * dt - position[k]) * STIFFNESS + (targetVelocity[k] - velocity[k]) * DAMPING) / denominator - gravity[k]);
  const cap = accelerationLimit(mass), l = Math.hypot(...a);
  return l > cap ? a.map(n => n * cap / l) : a;
}

/** Angular drive: returns the angular acceleration (rad/s^2) toward the target orientation error vector (axis*angle). */
export function driveAngular({ angularError, angularVelocity, targetSpin = [0, 0, 0], dt }) {
  const denominator = 1 + DAMPING * dt + STIFFNESS * dt * dt;
  return [0, 1, 2].map(k => (angularError[k] * STIFFNESS + (targetSpin[k] - angularVelocity[k]) * DAMPING) / denominator);
}

/** Samples averaged for the hand motion the drive follows: 2 cuts 2 mm tracking jitter in a held prop to ~60 % and adds
 * half a frame of velocity lag (1 = least overshoot when the hand stops, 3 = smoothest). */
export const HAND_MOTION_SAMPLES = 2;
export function createHandMotion() { return { samples: [], linear: [0, 0, 0], angular: [0, 0, 0] }; }
/** Add one hand velocity sample (linear m/s, angular rad/s, world) over dt; updates motion.linear/angular (dt-weighted mean). */
export function pushHandMotion(motion, linear, angular, dt) {
  if (!Number.isFinite(dt) || !(dt > 0) || ![...linear, ...angular].every(Number.isFinite)) return motion;
  const samples = motion.samples;
  samples.push({ dt, linear: [...linear], angular: [...angular] });
  if (samples.length > HAND_MOTION_SAMPLES) samples.shift();
  let total = 0; const l = [0, 0, 0], a = [0, 0, 0];
  for (const s of samples) { total += s.dt; for (let k = 0; k < 3; k++) { l[k] += s.linear[k] * s.dt; a[k] += s.angular[k] * s.dt; } }
  motion.linear = l.map(v => v / total); motion.angular = a.map(v => v / total);
  return motion;
}
/** Velocity of a point carried rigidly by a body moving with (linear, angular) about `pivot`: v + w x (point - pivot). */
export function carriedVelocity(linear, angular, pivot, point) { return add(linear, cross(angular, sub(point, pivot))); }
