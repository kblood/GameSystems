// Test fixture for the gore runtime: a character built straight from the synced CharacterCreator assets with three.js
// (no GLTFLoader, no textures): body + face parts + garments + hair as SkinnedMeshes on one skeleton, the humanoid from
// extensions/humanoid, and the character contract fields the gore world uses (root, body, meshes, humanoid, restHeads).
import * as THREE from 'three';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readGLB } from '../../extensions/gore/tools/glb.mjs';
import { createHumanoid, restHeads, MPFB_GAME_ENGINE } from '../../extensions/humanoid/index.js';

export const ASSETS = fileURLToPath(new URL('../public/avatar-assets/', import.meta.url));
export const hasAssets = () => existsSync(`${ASSETS}base_body.glb`);
export const FILES = ['base_body.glb', 'clothing_shirt.glb', 'clothing_jeans.glb', 'clothing_shoes.glb', 'hair_short02.glb'];

const cache = new Map();
const read = f => { if (!cache.has(f)) cache.set(f, readGLB(`${ASSETS}${f}`)); return cache.get(f); };

/**
 * Builds a character. options: files (default FILES), morphs ({ targetName: weight } on every mesh), hide ({ meshName:
 * predicate(triangle corners) } drops triangles from that mesh's index, like CharacterCreator's clothing zones).
 */
export function buildCharacter({ files = FILES, morphs = {}, hide = {} } = {}) {
  const body = read('base_body.glb');
  const root = new THREE.Group(); root.name = 'CharacterModel';
  const armature = new THREE.Group(); armature.name = 'Armature'; root.add(armature);
  // bones from the body's skin, hierarchy from the glTF nodes
  const skin = body.skins[0], nodes = body.nodes, byName = new Map();
  const nodeIndex = new Map(nodes.map((n, i) => [n.name, i]));
  for (const name of skin.joints) {
    const n = nodes[nodeIndex.get(name)], b = new THREE.Bone(); b.name = name;
    if (n.translation) b.position.fromArray(n.translation);
    if (n.rotation) b.quaternion.fromArray(n.rotation);
    if (n.scale) b.scale.fromArray(n.scale);
    byName.set(name, b);
  }
  for (const name of skin.joints) {
    const n = nodes[nodeIndex.get(name)], b = byName.get(name);
    for (const c of n.children ?? []) { const child = byName.get(nodes[c].name); if (child) b.add(child); }
  }
  for (const b of byName.values()) if (!b.parent) armature.add(b);
  const bones = skin.joints.map(n => byName.get(n));
  const inverses = bones.map((_, i) => new THREE.Matrix4().fromArray(skin.inverseBindMatrices, 16 * i));
  const skeleton = new THREE.Skeleton(bones, inverses);
  root.updateMatrixWorld(true);

  const meshes = [];
  for (const f of files) {
    for (const m of read(f).meshes) {
      if (!m.joints) continue;
      const g = new THREE.BufferGeometry();
      const a = m.attributes;
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(a.POSITION), 3));
      if (a.NORMAL) g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(a.NORMAL), 3));
      if (a.TEXCOORD_0) g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(a.TEXCOORD_0), 2));
      for (const k of Object.keys(a)) if (k.startsWith('_')) g.setAttribute(k.toLowerCase(), new THREE.BufferAttribute(Float32Array.from(a[k]), m.itemSize[k]));
      // skin indices remapped onto the body skeleton by bone name (CharacterCreator bindToSkeleton)
      const J = new Uint16Array(a.JOINTS_0.length);
      for (let i = 0; i < J.length; i++) J[i] = skin.joints.indexOf(m.joints[a.JOINTS_0[i]]);
      g.setAttribute('skinIndex', new THREE.BufferAttribute(J, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(a.WEIGHTS_0), 4));
      let index = Array.from(m.index);
      if (hide[m.name]) {
        const keep = [];
        for (let t = 0; t < index.length; t += 3) if (!hide[m.name](index.slice(t, t + 3), a.POSITION)) keep.push(index[t], index[t + 1], index[t + 2]);
        index = keep;
      }
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1));
      if (m.targets.length) {
        g.morphTargetsRelative = true;
        g.morphAttributes.position = m.targets.map(t => new THREE.BufferAttribute(Float32Array.from(t.POSITION), 3));
        if (m.targets[0].NORMAL) g.morphAttributes.normal = m.targets.map(t => new THREE.BufferAttribute(Float32Array.from(t.NORMAL ?? new Float32Array(t.POSITION.length)), 3));
      }
      const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ name: m.material ?? m.name }));
      mesh.name = m.primitive ? m.name : m.node; // GLTFLoader names a single-primitive mesh after its node
      if (m.targets.length) {
        mesh.updateMorphTargets();
        mesh.morphTargetDictionary = Object.fromEntries(m.targetNames.map((n, i) => [n, i]));
        for (const [n, w] of Object.entries(morphs)) { const i = mesh.morphTargetDictionary[n]; if (i !== undefined) mesh.morphTargetInfluences[i] = w; }
      }
      armature.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      meshes.push(mesh);
    }
  }
  root.updateMatrixWorld(true);
  const bodyMesh = meshes.find(m => m.name === 'Body');
  const humanoid = createHumanoid(bodyMesh, { root, map: MPFB_GAME_ENGINE });
  return { root, body: bodyMesh, meshes, humanoid, restHeads: () => restHeads(humanoid) };
}
