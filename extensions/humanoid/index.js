// GameSystems humanoid extension: public API. The standard skeleton every character and the avatar share. Pure modules,
// no three.js import (bones are used duck-typed):
//   canonical.js       canonical joints (VRM 1.0 humanoid names incl. 30 finger joints), hierarchy, pose helpers, FK
//   qmath.js           quaternion / vector helpers ([x, y, z, w], [x, y, z])
//   rig.js             MPFB map, rest geometry (restGeometry), heads from the CharacterCreator joints sidecar
//   humanoid.js        createHumanoid(mesh, { map }) binds any rig; applyPose / resetPose / restHeads (missing joints fold)
//   bone_maps.js       bone-name maps (MPFB, VRM 1.0 / 0.x, Mixamo) and detectBoneMap()
//   skeleton_check.js  checkSkeleton(): missing fingers -> mitten hands + warning, knuckles far from expected -> warning;
//                      completeHands(): synthetic finger heads for mitten hands
//   layers.js          render layers (first person hides HEAD meshes from MAIN)
// Poses are parent-relative deltas in the character frame (+X left, +Y up, +Z forward, metres).
// Source of truth: GameSystems/extensions/humanoid (canonical/qmath/rig/humanoid from CharacterCreator at dc664c07, MIT;
// see LICENSE-NOTES.md). Games get synced copies of the top-level files; never edit a synced copy.
export { JOINTS, JOINT_NAMES, PARENT, TIP, mirrorJointName, presentParent, mirrorPose, worldToPose, poseToWorld, fkPositions } from './canonical.js';
export * from './qmath.js';
export { headsFromSidecar, restGeometry, MPFB_ROOT_BONE } from './rig.js';
export { createHumanoid, applyPose, resetPose, restHeads, measure, sanitizeNodeName } from './humanoid.js';
export { MPFB_GAME_ENGINE, VRM_HUMANOID, VRM0_HUMANOID, MIXAMO, mixamoBoneMap, boneMapFromVRM, mapCoverage, detectBoneMap } from './bone_maps.js';
export { REQUIRED, HAND_EXPECT, checkSkeleton, completeHands } from './skeleton_check.js';
export { LAYERS } from './layers.js';
