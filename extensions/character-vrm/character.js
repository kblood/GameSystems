// GameSystems character-vrm extension: a loaded VRM (three-vrm VRM instance, 0.x or 1.0) behind the character contract
// (docs/extensions_plan.md "Karakter-kontrakt"), so the avatar extension poses it exactly like the CharacterCreator one.
// No three-vrm import here: the VRM is used duck-typed (vrm.scene, vrm.meta.metaVersion, vrm.humanoid.getRawBoneNode,
// optional springBoneManager / expressionManager / nodeConstraintManager / firstPerson), so tests can feed a fake one.
// The skeleton binding is the humanoid extension's public API: createHumanoid + boneMapFromVRM on the RAW bones.
//
// Character frame (+X left, +Y up, +Z forward): VRM 1.0 faces +Z; a VRM 0.x model faces -Z and is turned 180 deg about Y
// inside the character root (vrm.scene.rotation), so restHeads() and poses are in the contract's frame for both.
// The avatar owns character.root's transform (it writes position/quaternion/scale every frame); the VRM sits below it.
// three-vrm's own humanoid update (normalized -> raw copy) must be off (autoUpdateHumanBones: false, see loader.js):
// applyPose writes the raw bones directly.
//
// Quality tiers (VRM_QUALITY): 'low' = no spring bones, no expressions (blink), no shadows; node constraints only.
// 'high' = spring bones, blink, shadows. setQuality() switches live.
import * as THREE from 'three';
import { createHumanoid, applyPose, resetPose, restHeads, boneMapFromVRM, checkSkeleton, LAYERS } from '../humanoid/index.js';

export const VRM_QUALITY = Object.freeze(['low', 'high']);
const frameDelta = dt => (Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0);

/** 0 for VRM 0.x, 1 for VRM 1.0 (three-vrm meta.metaVersion '0' | '1'). */
export const vrmVersion = vrm => (String(vrm?.meta?.metaVersion ?? '1') === '0' ? 0 : 1);

/** The skinned mesh carrying the most humanoid bones (createHumanoid's candidate list starts with its skeleton). */
function mainSkinnedMesh(scene, bones) {
  const wanted = new Set(bones);
  let best = null, score = -1;
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const s = o.skeleton.bones.filter(b => wanted.has(b)).length;
    if (s > score) { best = o; score = s; }
  });
  return best;
}

/**
 * Wraps a loaded VRM as a character. options: quality 'low' | 'high' (default 'high'), signal (AbortSignal: disposes).
 * Returns the contract { id: 'vrm', root, meshes, humanoid, headBone, capabilities, quality, tier, skeleton, restHeads(),
 * eyeOffset(), applyPose(pose), resetPose(), setFirstPerson(on), tick(dt, physics, { frozen }), resetSecondary(),
 * setQuality(tier), dispose() } plus vrm, meta, version.
 */
export function createVRMCharacter(vrm, { quality = 'high', signal } = {}) {
  if (!vrm?.scene || typeof vrm.humanoid?.getRawBoneNode !== 'function') throw new TypeError('createVRMCharacter needs a three-vrm VRM');
  if (vrm.humanoid.autoUpdateHumanBones) vrm.humanoid.autoUpdateHumanBones = false; // poses go to the raw bones
  const version = vrmVersion(vrm);
  const root = new THREE.Group();
  root.name = 'VRMCharacter';
  vrm.scene.removeFromParent();
  if (version === 0) vrm.scene.rotation.set(0, Math.PI, 0); // VRM 0.x faces -Z (same as three-vrm VRMUtils.rotateVRM0)
  root.add(vrm.scene);
  root.updateMatrixWorld(true);

  // three-vrm (>= 1) already renames a VRM 0.x humanoid to the VRM 1.0 bone names at import (its thumbBoneNameMap:
  // 0.x thumbProximal/Intermediate -> 1.0 thumbMetacarpal/Proximal), so getRawBoneNode always takes 1.0 names: map
  // version 1 for both. (boneMapFromVRM's version 0 is for raw VRM 0.x JSON names.)
  const rawBones = [];
  const map = boneMapFromVRM(name => { const node = vrm.humanoid.getRawBoneNode(name); if (node) rawBones.push(node); return node; }, { version: 1 });
  const body = mainSkinnedMesh(vrm.scene, rawBones);
  if (!body) throw new Error('VRM has no skinned mesh bound to its humanoid bones');
  const humanoid = createHumanoid(body, { root, map });
  const skeleton = checkSkeleton(restHeads(humanoid));

  const meshes = [];
  vrm.scene.traverse(o => { if (o.isMesh) { meshes.push(o); o.frustumCulled = false; } });
  const headBone = humanoid.bones.head ?? null;
  // First person: meshes the VRM marks third-person-only (and everything skinned mostly to the head when it has no
  // annotations) go to the HEAD layer; the head bone shrinks (as character-cc does), which also hides hair/accessories.
  const annotations = vrm.firstPerson?.meshAnnotations ?? [];
  const headMeshes = new Set(annotations.filter(a => a.type === 'thirdPersonOnly').flatMap(a => [a.meshes ?? a.mesh].flat()).filter(Boolean));
  let firstPerson = false, tier = VRM_QUALITY.includes(quality) ? quality : 'high', disposed = false;
  let lastPose = null, blinkT = 0, nextBlink = 2.5;
  const blink = vrm.expressionManager?.getExpression?.('blink') ? 'blink' : null;

  function applyTier() {
    for (const m of meshes) m.castShadow = m.receiveShadow = tier === 'high';
    if (tier !== 'high') { if (blink) vrm.expressionManager.setValue(blink, 0); vrm.expressionManager?.update?.(); }
  }
  function markHeads() {
    for (const m of headMeshes) {
      m.layers.enable(LAYERS.HEAD);
      if (firstPerson) m.layers.disable(LAYERS.MAIN); else m.layers.enable(LAYERS.MAIN);
    }
  }
  applyTier(); markHeads();

  // Eye centre - head joint (rest, character frame): from the eye bones when the VRM has them, else from the VRM
  // look-at offset (head-local; VRM 0.x firstPersonBoneOffset), else null (the avatar scales a default by head height).
  function eyeOffset() {
    const H = restHeads(humanoid);
    const eyes = ['leftEye', 'rightEye'].map(n => vrm.humanoid.getRawBoneNode(n)).filter(Boolean);
    if (eyes.length && H.head) {
      root.updateWorldMatrix(true, false);
      const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert(), p = new THREE.Vector3(), mid = new THREE.Vector3();
      for (const e of eyes) mid.add(e.getWorldPosition(p).applyMatrix4(toRoot));
      mid.multiplyScalar(1 / eyes.length);
      return [mid.x - H.head[0], mid.y - H.head[1], mid.z - H.head[2]];
    }
    const o = vrm.lookAt?.offsetFromHeadBone;
    if (o && o.lengthSq?.() > 1e-6) { const v = o.clone().applyQuaternion(vrm.scene.quaternion); return [v.x, v.y, v.z]; }
    return null;
  }

  const character = {
    id: 'vrm', vrm, meta: vrm.meta, version, root, body, meshes, humanoid, headBone, skeleton,
    capabilities: Object.freeze({ fingers: !skeleton.mitten, eyes: !!(blink || vrm.lookAt), cloth: false, morphs: !!vrm.expressionManager }),
    quality: VRM_QUALITY,
    get tier() { return tier; },
    get disposed() { return disposed; },
    /** Rest joint heads in the character frame (pose independent). */
    restHeads: () => restHeads(humanoid),
    eyeOffset,
    applyPose(pose) { if (disposed) return; lastPose = pose; applyPose(humanoid, pose); },
    resetPose() { if (disposed) return; lastPose = null; resetPose(humanoid); },
    get pose() { return lastPose; },
    setFirstPerson(on) {
      if (disposed) return;
      firstPerson = !!on;
      if (headBone) { headBone.scale.setScalar(firstPerson ? 1e-3 : 1); root.updateMatrixWorld(true); }
      markHeads();
    },
    /** 'low' | 'high' (VRM_QUALITY); returns the tier in effect. */
    setQuality(next) {
      if (disposed || !VRM_QUALITY.includes(next) || next === tier) return tier;
      tier = next; applyTier();
      if (tier === 'high') vrm.springBoneManager?.reset?.();
      return tier;
    },
    resetSecondary() { vrm.springBoneManager?.reset?.(); },
    // frozen keeps expressions as they are (NPC death). Spring bones run only at 'high' with physics.
    tick(dt, physics = true, { frozen = false } = {}) {
      if (disposed) return;
      dt = frameDelta(dt);
      root.updateMatrixWorld(true);
      vrm.nodeConstraintManager?.update?.();
      if (tier !== 'high') return;
      if (blink && !frozen) {
        blinkT += dt;
        const k = blinkT - nextBlink;
        vrm.expressionManager.setValue(blink, k > 0 && k < 0.15 ? Math.sin(k / 0.15 * Math.PI) : 0);
        if (k >= 0.15) { blinkT = 0; nextBlink = 2 + Math.random() * 4; }
        vrm.expressionManager.update();
      }
      if (physics) vrm.springBoneManager?.update?.(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener('abort', character.dispose);
      root.removeFromParent();
      vrm.scene.traverse(o => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) u.value.dispose();
          m.dispose?.();
        }
        o.skeleton?.dispose?.();
      });
    },
  };
  if (signal?.aborted) character.dispose(); else signal?.addEventListener('abort', character.dispose, { once: true });
  return character;
}
