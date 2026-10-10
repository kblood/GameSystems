// GameSystems grasp extension: public API. Pure modules, no three.js and no physics engine:
//   baked_grasps.js   baked grasp library (nearest pose + hysteresis, finger states, quality 'raw' | 'low' | 'mid' | 'high')
//   record.js         recorded grasps (Grasp Studio): XR joints -> grasp rows, mirror, score, merge into the library
//   closure.js        close-to-contact: fingers close along the baked shape until they touch the item, on the character's hand
//   grasp_validator.js joint ranges, comfort, contact gates (offline fitter gate + runtime clamp)
//   catalog.js        prop shapes, signed distance, hull points, mass properties
//   contact.js        skin-vs-item contact metrics (lab, smoke tests)
//   held_drive.js     mass-scaled hold drive + the hand motion it follows
//   throw_release.js  throw release velocity and glass-break tuning
// Data: baked_grasps.data.json (bake), recorded_grasps.json (Grasp Studio), reference_hand.json (reference rest hand).
// Source of truth: GameSystems/extensions/grasp. Games get copies through their sync scripts (only the top-level
// files; tools/ is offline tooling). Never edit a synced copy.
export {
  BAKED, RECORDED, POSES, FINGERS, ANGLE_WEIGHT, HYSTERESIS, GRASP_QUALITY, setGraspQuality, graspQuality, runtimeRows, graspPose,
  CLAMP_EXEMPT, posesFor, hasPoses, defaultPose, poseById, quatAngle, nearestPose, toItemLocal, toWorld, fingerState, openFingerState,
} from './baked_grasps.js';
export {
  THUMB_TILT, PAD_RADIUS, REFERENCE_HAND, CLOSURE, handGeometry, handFromRig, fingerChain, placeWrist, closeToContact, chainGaps,
} from './closure.js';
export {
  RECORDED_SCHEMA, DEFAULT_OPEN, XR_CHAINS, XR_JOINTS, quatFromBasis, handBasis, handLengthFromJoints, restFromJoints, rowsFromJoints,
  captureFromJoints, poseJoints, referenceHand, mirrorPose, isPose, recordedPose, scoreGrasp, recordedPoses, mergePoses, PALM_SKIN_MM,
} from './record.js';
export {
  HARD, COMFORT, GATES, validateRows, clampRows, rowsFromState, digitCost, wristDeviationDeg, maxContactGapDeg, verdict,
} from './grasp_validator.js';
export { CATALOG, KINDS, DEFAULT_MASS, entry, signedDistance, surfaceNormal, hullPoints, massProperties, boundingRadius } from './catalog.js';
export { contactMetrics, kindGeometry, MAX_PENETRATION_MM, MAX_PALM_GAP_MM, MIN_OPPOSITION_DEG, TOUCH_MM } from './contact.js';
export {
  STIFFNESS, DAMPING, MAX_ACCELERATION, MAX_TORQUE, MAX_HOLD_FORCE, HAND_MOTION_SAMPLES,
  accelerationLimit, driveAcceleration, driveAngular, createHandMotion, pushHandMotion, carriedVelocity,
} from './held_drive.js';
export {
  GLASS_BREAK_CONTACT_SPEED, RELEASE_SPEED_CAP, RELEASE_SPIN_CAP, createThrowHistory, pushSample, releaseVelocity, sampleFromPoses,
} from './throw_release.js';
