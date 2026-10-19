// GameSystems bottles extension (three.js): bottles and containers with volume-preserving liquid, pouring, leaks,
// puddles, damage, shattering, shots and window panes, on the host's physics adapter only (ctx.physics, see
// ../host/physics.js); no physics engine is imported. Modules:
//   system.js        createBottleSystem: wires everything and steps it from physics.onStep
//   bodies.js        bottle/shard bodies on the adapter, pose sync, impact coalescing
//   factory.js       catalog bottles and designs (GLB + liquid), adopt() for game-built models, mass from fill
//   breakage.js      damage marks, leak holes, shatter + debris, shots, panes
//   pour.js          rim overflow, hole leaks, drops, streams, puddles, volume ledger
//   liquid_color.js  liquid colour as Beer-Lambert absorbance; ml-weighted (subtractive) mixing in bottles/drops/puddles
//   damage.js        deterministic bottle/pane damage models      surfaces.js   liquid-receiving surfaces, puddle clipping
//   audio.js         bottle sounds                                 quality.js    tiers and their effect ceilings
//   cap_gesture.js   two-hand cap / cork removal (twist + pull, port of the Godot bottle_cap.gd mechanism)
//   bottle_liquid.js, liquid_lut_v2.js, bottle_design.js           liquid shader + LUT, *.bottle.json designs (moved here
//                    from shaders/three and designs/three, which now re-export them)
// Depends on: host (public API) and the game's three.js. Source of truth: GameSystems/extensions/bottles; games get
// synced copies of the top-level files (never edit them).
//
// Extension: host.load(bottlesExtension, { catalog, assetURL, surfaces, audio? }) -> api (createBottleSystem's object).
// Quality tiers: BOTTLE_TIERS 'minimal' | 'low' | 'mid' | 'high' (quality.js). Events sent: 'broken' { bottle } when a
// bottle shatters (before it is removed; whoever holds it lets go). The bottle record's `entry` is its adapter handle,
// so the game holds/releases bottles through its own adapter (hold, release). adopt()/spawn() take optional
// body: { shape, options } (the game's collision shape + addBody options, e.g. Contracts' catalogue silhouette) and
// color (the liquid's sRGB colour; drops, streams, puddles and mixing follow it).
import { createBottleSystem } from './system.js';
import { BOTTLE_TIERS } from './quality.js';

export { createBottleSystem } from './system.js';
export { BottleBodies, BOTTLE_GROUP, SHARD_GROUP, SHARD_MASK, IMPACT_MIN_SPEED } from './bodies.js';
export { BottleFactory } from './factory.js';
export { BreakageSystem, MAX_HOLES } from './breakage.js';
export { PourSystem, holeHydraulics } from './pour.js';
export { REF_PATH_M, PUDDLE_DEPTH_M, absorbanceOfColor, absorbanceOfSRGB, transmission, mixAbsorbance, liquidAbsorbance,
  setBottleAbsorbance, setBottleLiquidColor, mixIntoBottle } from './liquid_color.js';
export { BottleDamageProfile, SURFACES, GLASS_PROFILES, assessPane } from './damage.js';
export { SurfaceWorld, puddlePolygon } from './surfaces.js';
export { BottleAudio, BOTTLE_SOUNDS } from './audio.js';
export { createCapGesture, nearCap, TWIST_TO_LOOSEN, LOOSENED_PULL, STRAIGHT_PULL, GRIP_REACH } from './cap_gesture.js';
export { BOTTLE_TIERS, BOTTLE_QUALITY, bottleQuality, tierIndex } from './quality.js';
export { setupBottle, setupBottleFromUrl, loadLiquidInfo, makeLiquidMaterial } from './bottle_liquid.js';
export { makeLut } from './liquid_lut_v2.js';
export { loadDesign, liquidMassKg, resolveMassFill, tierPath, TIERS as DESIGN_TIERS } from './bottle_design.js';

/**
 * Extension factory. options: { catalog, assetURL(path) -> url (default: ctx.assetURL), surfaces: meshes receiving
 * liquid, audio: { play(key, minGapMs) } }. Needs ctx.physics.
 */
export default function bottlesExtension(options = {}) {
  let system = null;
  return {
    id: 'bottles',
    quality: BOTTLE_TIERS,
    init(ctx) {
      if (!ctx.physics) throw new Error('The bottles extension needs ctx.physics (a host physics adapter)');
      system = createBottleSystem({ scene: ctx.scene, physics: ctx.physics, catalog: options.catalog,
        assetURL: options.assetURL ?? (path => String(ctx.assetURL(path))), surfaces: options.surfaces, audio: options.audio,
        tier: ctx.quality, emit: ctx.emit, sourceKey: options.sourceKey ?? 'bottles' });
      return system;
    },
    // No update(): the system steps from ctx.physics.onStep, right after the physics it depends on.
    setQuality(tier) { system.setQuality(tier); },
    dispose() { system?.dispose(); system = null; },
  };
}
