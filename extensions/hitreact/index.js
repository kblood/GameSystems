// GameSystems hitreact extension: IK hit reactions and an opt-in active ragdoll for humanoid enemies. Pairs with the ai
// extension's hit hook (world.hit) and physical states (world.setPhysicalState): the host forwards each hit here and each
// state change from here to the AI. Engine-free except three-layer.js, which takes THREE as a parameter; the ragdoll runs
// on a physics adapter with the ragdoll capability (extensions/adapters/physics-cannon.js).
//
//   config.js          tunables and defaults, resolveHitReactConfig / validateHitReactConfig (pure)
//   reaction.js        springs, impulse -> offsets, balance step, stability thresholds and states (pure)
//   pose.js            applies a reaction to a canonical pose: chain turns, pelvis offset, planted feet (pure)
//   ragdoll.js         11 segments, 10 joints, frames <-> pose, muscles, downed monitor (pure)
//   ragdoll-driver.js  the segments and joints on a physics adapter (engine-free)
//   three-layer.js     createHitReactor(THREE, { character, config, physics, lost }): world hits in, bones out
export { DEFAULT_HIT_REACT_CONFIG, resolveHitReactConfig, validateHitReactConfig } from './config.js';
export { PHYSICAL_STATES, regionClass, hitChain, springStep, peakDisplacement, chooseStep, createHitReaction } from './reaction.js';
export { applyReaction, blendPoses, solveLeg, rotationVector, legLengths } from './pose.js';
export { RAGDOLL_SEGMENTS, RAGDOLL_JOINTS, SEGMENT, SHOT_IMPULSE, segmentForRegion, segmentInertia, restSegments, segmentFrames, jointFrames,
  poseFromSegments, rotationError, muscleTorque, createDownedMonitor } from './ragdoll.js';
export { RAGDOLL_METHODS, supportsRagdoll, capsuleShapes, createRagdollDriver } from './ragdoll-driver.js';
export { createHitReactor } from './three-layer.js';
