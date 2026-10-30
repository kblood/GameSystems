// GameSystems fire-fx extension: visual fire only (flames, embers/sparks, a shared light pool, scorch decals). It does not
// simulate fire: extensions/thermal does that, and a game maps its burning objects onto addFlame/moveFlame/removeFlame.
// Engine-free except three-layer.js, which takes THREE as a parameter. Reference: docs/flamethrower_system.md.
//
//   quality.js      tiers 'low' | 'medium' | 'high', hard budgets, resolveQuality / resolveBudget / tierLimits (pure)
//   pool.js         fixed-capacity particle ring, typed arrays, no allocation after creation (pure)
//   flames.js       flame registry, light choice, scorch ring (pure)
//   shaders.js      GLSL strings (pure)
//   three-layer.js  createFireFX({ THREE, scene, camera, quality, budget })
export { FIRE_FX_QUALITY, FIRE_FX_ALIASES, FIRE_FX_TIERS, FIRE_FX_LIMITS, resolveQuality, resolveBudget, tierLimits } from './quality.js';
export { PARTICLE_KIND, createParticlePool } from './pool.js';
export { createFlameRegistry, createScorchRing, flameBounds, selectLights } from './flames.js';
export { FLAME_VERTEX, FLAME_FRAGMENT, PARTICLE_VERTEX, PARTICLE_FRAGMENT, SCORCH_VERTEX, SCORCH_FRAGMENT } from './shaders.js';
export { createFireFX } from './three-layer.js';
