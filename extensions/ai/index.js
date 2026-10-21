// GameSystems ai extension: public API. Shared NPC AI for VR games: perception (sight with suspicion, hearing,
// memory), intent (state machines plus a utility scorer, seeded and deterministic), movement (navmesh paths, avoidance,
// separation, VR personal space), group coordination (guard squad, zombie horde) and two brains on top: the zombie and
// the guard (a port of the NightfallContractsGodot guard). docs/ai_system.md.
//
//   import { createAIWorld, createNavGrid, createZombieBrain, createGuardBrain } from '.../ai/index.js'
//   const ai = createAIWorld({ navmesh: createNavGrid({ boxes }), raycast, seed: 7 })
//   const agent = ai.addAgent(createZombieBrain({ aggression: 0.8 }), { position, yaw })
//   ai.update(dt, { head, hands: [left, right] }); agent.intent -> velocity, face, gait, telegraph, actions
//
// Files: world.js (the world, tick, ray budget, stimuli, events), perception.js, utility.js, nav.js (grid navmesh),
// steering.js (movement intent), coordinator.js (squad, horde), zombie.js, guard.js, math.js (vectors, seeded rng),
// three-adapters.js (three.js passed in: boxes from meshes, raycast, debug overlay).
// Depends on nothing: every module is pure, none imports three.js (enforced by tests/extension-boundaries.test.js).
export { createAIWorld, createOpenNav, stepBody, WORLD_DEFAULTS, PHYSICAL_STATES } from './world.js';
export { createNavGrid, pathLength, NAV_DEFAULTS } from './nav.js';
export { createPerceptionState, sightRate, look, hear, sense, updateAwareness, playerSample, PERCEPTION_DEFAULTS, SUSPICIOUS_AT, INVESTIGATE_AT } from './perception.js';
export { createUtility } from './utility.js';
export { moveTo, pushToward, stand, finishVelocity, MOVE_DEFAULTS } from './steering.js';
export { createSquad, createHorde, SQUAD_DEFAULTS, HORDE_DEFAULTS } from './coordinator.js';
export { createZombieBrain, mobilityFromGore, chooseAttack, regionClass, ZOMBIE_DEFAULTS } from './zombie.js';
export { createGuardBrain, resolveGuardConfig, spreadDeg, guardZone, GUARD_DEFAULTS, GUARD_DIFFICULTY, GUARD_CONSTANTS } from './guard.js';
export { createRng, hashSeed, readPoint, wrapAngle, yawTo } from './math.js';
export { boxesFromObjects, createRaycast, createAIDebug } from './three-adapters.js';
