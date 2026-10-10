// GameSystems avatar extension: rest-pose skin vertices of a character's hand, grouped by the hand / finger bone that
// dominates each vertex (input of handprofile.js measureHandProfile). Runs once per character (and after a rest change),
// never per frame: the bones are put in their rest rotations for the read and restored afterwards.
// Uses the character contract only: character.root (the character frame) and character.humanoid.bones (canonical joint
// -> bone object); every skinned mesh below the root that is visible and bound to those bones contributes.
import * as THREE from 'three';
import { resetPose } from '../humanoid/index.js';
import { HAND_BONES } from './handprofile.js';

/**
 * [{ p: [x, y, z] (character frame = character.root's local space, rig metres), bone: 'Hand' | '<Finger><Segment>', w }]
 * for one side, or null when the character has no humanoid bones / skinned mesh. minWeight: drop vertices whose dominant
 * weight is below it (blended joint creases).
 */
export function handSkinPoints(character, side, { minWeight = 0.05 } = {}) {
  const h = character?.humanoid, root = character?.root;
  if (!h?.bones || !root?.traverse) return null;
  const byBone = new Map();
  for (const name of HAND_BONES) { const b = h.bones[side + name]; if (b) byBone.set(b, name); }
  if (!byBone.size) return null;
  const saved = Object.values(h.bones).map(b => [b, b.quaternion.clone()]);
  const out = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
  try {
    resetPose(h);
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse(o => {
      if (!o.isSkinnedMesh || !o.skeleton || !o.geometry?.attributes?.skinIndex) return;
      for (let p = o; p && p !== root; p = p.parent) if (p.visible === false) return;
      const groups = o.skeleton.bones.map(b => byBone.get(b));
      if (!groups.some(Boolean)) return;
      o.skeleton.update();
      m.multiplyMatrices(toRoot, o.matrixWorld);
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, n = o.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) {
        let best = -1, w = 0;
        for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; best = si.getComponent(i, k); } }
        const bone = groups[best];
        if (!bone || w < minWeight) continue;
        o.getVertexPosition(i, v).applyMatrix4(m);
        out.push({ p: [v.x, v.y, v.z], bone, w });
      }
    });
  } finally {
    for (const [b, q] of saved) b.quaternion.copy(q);
    root.updateMatrixWorld(true);
  }
  return out.length ? out : null;
}
