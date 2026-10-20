// GameSystems gore extension: the body regions a zombie can lose. Pure (no three.js), shared by the offline bake
// (tools/bake_gibs.mjs), the damage model (damage.js) and the runtime (character.js).
//
// Regions form a tree rooted at the pelvis. Every non-root region is cut from its parent along one seam:
//   kind 'limb'   a seam all around a joint (shoulder, elbow, wrist, hip, knee, ankle, neck, head, waist). The cut is
//                 where the skin weight of the region's subtree crosses the seam threshold (tools/bake_core.mjs), so it
//                 follows the joint on any rig weighted like MakeHuman. Body side and gib side get closed stump caps.
//   kind 'patch'  a chunk shot out of its parent's surface (jaw, top of the skull, chest, belly): an ellipsoid on the
//                 skin, placed from the rest joints (seams.js). The body keeps a hole with a flesh rim; the gib gets a
//                 closed back.
// Regions list canonical humanoid joints (extensions/humanoid canonical.js names, +X = the character's left). A joint
// belongs to exactly one region; joints not listed fall to their nearest listed ancestor (fingers -> hand, toes -> foot).
// Order matters: REGION_ORDER is depth first, so a region and everything below it are contiguous (one index range in the
// pre-split mesh; severing a subtree hides one range).
import { JOINTS, PARENT } from '../humanoid/index.js';

const SIDES = ['left', 'right'];
const limb = (id, parent, joints, extra = {}) => ({ id, parent, kind: 'limb', joints, ...extra });
const patch = (id, parent, extra = {}) => ({ id, parent, kind: 'patch', joints: [], ...extra });

/**
 * The region table, depth first. Fields: id, parent (region id or null), kind ('root' | 'limb' | 'patch'), joints
 * (canonical joints whose bones belong to the region), side ('left' | 'right' | null), vital (losing it kills),
 * proxy (the physics / hit proxy: [from, to] joints of a capsule, 'X+' = extended past joint X to the region's far end;
 * patches: [joint] = a sphere that moves with that joint).
 */
export const REGIONS = Object.freeze([
  { id: 'pelvis', parent: null, kind: 'root', joints: ['hips', 'spine'], proxy: ['hips', 'chest'] },
  limb('chest', 'pelvis', ['chest', 'upperChest', 'leftShoulder', 'rightShoulder'], { vital: true, proxy: ['chest', 'neck'] }),
  limb('neck', 'chest', ['neck'], { vital: true, proxy: ['neck', 'head'] }),
  limb('head', 'neck', ['head'], { vital: true, proxy: ['head', 'head+'] }),
  patch('jaw', 'head', { proxy: ['head'] }),
  patch('cranium', 'head', { vital: true, proxy: ['head'] }),
  ...SIDES.flatMap(s => [
    limb(`${s}UpperArm`, 'chest', [`${s}UpperArm`], { side: s, proxy: [`${s}UpperArm`, `${s}LowerArm`] }),
    limb(`${s}LowerArm`, `${s}UpperArm`, [`${s}LowerArm`], { side: s, proxy: [`${s}LowerArm`, `${s}Hand`] }),
    limb(`${s}Hand`, `${s}LowerArm`, [`${s}Hand`], { side: s, proxy: [`${s}Hand`, `${s}MiddleProximal+`] }),
  ]),
  patch('chestLeft', 'chest', { side: 'left', proxy: ['upperChest'] }),
  patch('chestRight', 'chest', { side: 'right', proxy: ['upperChest'] }),
  ...SIDES.flatMap(s => [
    limb(`${s}UpperLeg`, 'pelvis', [`${s}UpperLeg`], { side: s, proxy: [`${s}UpperLeg`, `${s}LowerLeg`] }),
    limb(`${s}LowerLeg`, `${s}UpperLeg`, [`${s}LowerLeg`], { side: s, proxy: [`${s}LowerLeg`, `${s}Foot`] }),
    limb(`${s}Foot`, `${s}LowerLeg`, [`${s}Foot`, `${s}Toes`], { side: s, proxy: [`${s}Foot`, `${s}Toes+`] }),
  ]),
  patch('belly', 'pelvis', { proxy: ['hips'] }),
].map(r => Object.freeze({ side: null, vital: false, ...r, joints: Object.freeze([...r.joints]) })));

export const REGION_IDS = Object.freeze(REGIONS.map(r => r.id));
export const REGION = Object.freeze(Object.fromEntries(REGIONS.map(r => [r.id, r])));
/** Regions cut from their parent (every region but the root). Seam id = region id. */
export const SEAM_IDS = Object.freeze(REGIONS.filter(r => r.parent).map(r => r.id));
export const CHILDREN = Object.freeze(Object.fromEntries(REGIONS.map(r => [r.id, Object.freeze(REGIONS.filter(c => c.parent === r.id).map(c => c.id))])));

/** The region and every region below it, depth first. */
export function subtree(id) {
  const out = [];
  const walk = r => { out.push(r); for (const c of CHILDREN[r] || []) walk(c); };
  if (REGION[id]) walk(id);
  return out;
}
/** Limb-only subtree: the region and the limbs below it (patches of a region are not part of its limb weight). */
export function limbSubtree(id) {
  const out = [];
  const walk = r => { out.push(r); for (const c of CHILDREN[r] || []) if (REGION[c].kind === 'limb') walk(c); };
  if (REGION[id]) walk(id);
  return out;
}
/** Ancestors of a region, nearest first. */
export function ancestors(id) {
  const out = [];
  for (let p = REGION[id]?.parent; p; p = REGION[p].parent) out.push(p);
  return out;
}

/** Canonical joint -> region id for every canonical joint (unlisted joints inherit their parent's region). */
export const JOINT_REGION = Object.freeze((() => {
  const out = {};
  for (const r of REGIONS) for (const j of r.joints) out[j] = r.id;
  for (const [j] of JOINTS) if (!out[j]) out[j] = out[PARENT[j]] ?? 'pelvis';
  return out;
})());

/**
 * Bone index -> region index for a skeleton: boneNames[i] is the bone's name, jointOf(name) its canonical joint (or
 * null). Bones that are no canonical joint inherit through `parentOf(i)` (bone index or -1), else the root region.
 * Returns an Int16Array of REGION_ORDER indices.
 */
export function boneRegions(boneNames, jointOf, parentOf = () => -1) {
  const out = new Int16Array(boneNames.length).fill(-1);
  const resolve = i => {
    if (out[i] >= 0) return out[i];
    const j = jointOf(boneNames[i]);
    const p = parentOf(i);
    out[i] = j && JOINT_REGION[j] ? REGION_IDS.indexOf(JOINT_REGION[j]) : p >= 0 && p !== i ? resolve(p) : 0;
    return out[i];
  };
  for (let i = 0; i < boneNames.length; i++) resolve(i);
  return out;
}

/**
 * Region of a point on a skinned triangle from its bone weights: skin = [[i0..i3], [w0..w3]] per corner (3 corners),
 * bary = [b0, b1, b2]; boneRegion = boneRegions() output. The region with the largest barycentric-weighted bone weight
 * wins (limb regions only; patches are geometric, the runtime knows them from the triangle's piece).
 */
export function regionFromSkin(boneRegion, corners, bary) {
  const sum = new Float64Array(REGIONS.length);
  for (let c = 0; c < 3; c++) {
    const [idx, w] = corners[c];
    for (let k = 0; k < 4; k++) if (w[k] > 0) sum[boneRegion[idx[k]] ?? 0] += w[k] * bary[c];
  }
  let best = 0;
  for (let r = 1; r < sum.length; r++) if (sum[r] > sum[best]) best = r;
  return REGION_IDS[best];
}
