// GameSystems extension host: public API. See host.js for the extension contract, physics.js for the physics
// adapter interface, quality.js for tiers and events.js for the event bus.
export { createHost } from './host.js';
export { createEventBus, CORE_EVENTS } from './events.js';
export { tierFor, normalizeTier, isOff, DEFAULT_TIERS } from './quality.js';
export { PHYSICS_METHODS, assertPhysicsAdapter, vec, quat } from './physics.js';
