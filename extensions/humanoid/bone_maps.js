// GameSystems humanoid extension: bone-name maps for createHumanoid(mesh, { map }) (canonical joint -> rig bone name).
// Canonical joints are the VRM 1.0 humanoid names (canonical.js). Pure, no three.js.
//   MPFB_GAME_ENGINE  CharacterCreator / MakeHuman MPFB "game_engine" rig (rig.js)
//   VRM_HUMANOID      VRM 1.0 humanoid bone names (identity); boneMapFromVRM() turns them into node names
//   VRM0_HUMANOID     VRM 0.x names (its thumb is Proximal/Intermediate/Distal, one step further out than VRM 1.0)
//   mixamoBoneMap()   Mixamo rigs ("mixamorig:Hips"; three.js GLTFLoader strips the colon, createHumanoid tries both)
// detectBoneMap(names) picks the map that binds the most joints of a rig.
import { JOINT_NAMES } from './canonical.js';
import { MPFB_GAME_ENGINE } from './rig.js';

export { MPFB_GAME_ENGINE };

const SIDES = [['left', 'Left'], ['right', 'Right']];
const FINGER_SEGMENTS = {
  Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'],
  Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'],
};

/** VRM 1.0: canonical names are the humanoid bone names. */
export const VRM_HUMANOID = Object.freeze(Object.fromEntries(JOINT_NAMES.map(j => [j, j])));

/** VRM 0.x: same names except the thumb chain (VRM 0 Proximal/Intermediate/Distal = VRM 1 Metacarpal/Proximal/Distal). */
export const VRM0_HUMANOID = Object.freeze(Object.fromEntries(JOINT_NAMES.map(j => {
  const m = /^(left|right)Thumb(Metacarpal|Proximal|Distal)$/.exec(j);
  return [j, m ? `${m[1]}Thumb${{ Metacarpal: 'Proximal', Proximal: 'Intermediate', Distal: 'Distal' }[m[2]]}` : j];
})));

/**
 * Canonical joint -> node name for a VRM model: `nodeOf(vrmBoneName)` returns the node (or its name) for a humanoid bone,
 * e.g. three-vrm's `name => vrm.humanoid.getRawBoneNode(name)`. version 0 uses the VRM 0.x thumb names.
 */
export function boneMapFromVRM(nodeOf, { version = 1 } = {}) {
  const names = version === 0 ? VRM0_HUMANOID : VRM_HUMANOID, map = {};
  for (const j of JOINT_NAMES) {
    const node = nodeOf(names[j]);
    const name = typeof node === 'string' ? node : node?.name;
    if (name) map[j] = name;
  }
  return map;
}

/** Mixamo rig map with the given bone-name prefix ('mixamorig:' by default; '' for unprefixed exports). */
export function mixamoBoneMap(prefix = 'mixamorig:') {
  const m = { hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head' };
  const fingers = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Ring: 'Ring', Little: 'Pinky' };
  for (const [s, S] of SIDES) {
    Object.assign(m, { [`${s}Shoulder`]: `${S}Shoulder`, [`${s}UpperArm`]: `${S}Arm`, [`${s}LowerArm`]: `${S}ForeArm`, [`${s}Hand`]: `${S}Hand`,
      [`${s}UpperLeg`]: `${S}UpLeg`, [`${s}LowerLeg`]: `${S}Leg`, [`${s}Foot`]: `${S}Foot`, [`${s}Toes`]: `${S}ToeBase` });
    for (const [f, segs] of Object.entries(FINGER_SEGMENTS)) segs.forEach((g, i) => { m[`${s}${f}${g}`] = `${S}Hand${fingers[f]}${i + 1}`; });
  }
  return Object.freeze(Object.fromEntries(Object.entries(m).map(([j, b]) => [j, prefix + b])));
}
export const MIXAMO = mixamoBoneMap();

// Same sanitising as three.js GLTFLoader / humanoid.js (PropertyBinding.sanitizeNodeName).
const sanitize = n => String(n).replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');

/** Number of canonical joints `map` binds among `names` (raw or GLTFLoader-sanitised). */
export function mapCoverage(map, names) {
  const have = new Set();
  for (const n of names) { have.add(n); have.add(sanitize(n)); }
  return JOINT_NAMES.filter(j => map[j] != null && (have.has(map[j]) || have.has(sanitize(map[j])))).length;
}

/**
 * The map that binds the most canonical joints of a rig, from its bone names (e.g. skinnedMesh.skeleton.bones.map(b => b.name)).
 * Returns { id: 'mpfb' | 'mixamo' | 'vrm' | 'vrm0', map, bound, total } or null when nothing binds the hips/head/hands.
 * The Mixamo prefix is read from the rig's hips bone ("mixamorig:", "mixamorig1:", none, ...).
 */
export function detectBoneMap(names, extra = {}) {
  names = [...names].filter(Boolean);
  const hips = names.find(n => /Hips$/.test(n) && n !== 'hips');
  const candidates = { mpfb: MPFB_GAME_ENGINE, vrm: VRM_HUMANOID, vrm0: VRM0_HUMANOID, ...extra };
  if (hips) candidates.mixamo = mixamoBoneMap(hips.slice(0, -'Hips'.length));
  let best = null;
  for (const [id, map] of Object.entries(candidates)) {
    const bound = mapCoverage(map, names);
    if (!best || bound > best.bound) best = { id, map, bound, total: JOINT_NAMES.length };
  }
  const core = ['hips', 'head', 'leftHand', 'rightHand'];
  return best && core.every(j => mapCoverage({ [j]: best.map[j] }, names)) ? best : null;
}
