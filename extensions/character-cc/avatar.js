// GameSystems character-cc extension; fork of the Contracts character plugin (src/avatar.js), itself a fork of the
// CharacterCreatorXR avatar (MIT, Copyright (c) 2026 Kasper Olesen). Source of truth: GameSystems/extensions/character-cc.
// The CharacterCreator body as a character (extensions plan "Karakter-kontrakt"): body, hair, headless clothing, cloth,
// eyes, morphs, its own shader uniforms and lifetime. No IK and no game settings: the avatar extension poses it.
// CharacterCreator web modules are generated into ./vendor/cc by sync_cc.mjs (do not edit them); the skeleton binding
// comes from the humanoid extension.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CC from './vendor/cc/character.js';
import { createEyeLife, applyMorphWeights } from './vendor/cc/eyelife.js';
import { createClothRuntime } from './vendor/cc/cloth/runtime.js';
import { createHumanoid, applyPose, resetPose, restHeads, MPFB_GAME_ENGINE, LAYERS } from '../humanoid/index.js';
import { upgradeSkin, upgradeHair, upgradeCornea, setSkinParams, createHairCollider } from './materials.js';
import { createClothing } from './clothing.js';
import { createLifetime, createResourceOwner, frameDelta } from './lifecycle.js';

export { LAYERS };
const FACE_PART = /^(Eyebrows|Eyelashes|Eyes|Teeth|Tongue)(_\d+)?$/;
export const DEFAULT_ASSETS_URL = new URL('./assets/', import.meta.url);
/** Character quality tiers (contract `quality`): low = no skin/hair shader upgrade, no shadows, no cloth. */
export const CHARACTER_QUALITY = Object.freeze(['low', 'high']);

export function assetBaseURL(url = DEFAULT_ASSETS_URL) {
  const resolved = new URL(String(url), import.meta.url);
  if (!resolved.pathname.endsWith('/')) resolved.pathname += '/';
  return resolved;
}

/**
 * Creates a CharacterCreator character. Resolves once the body is bound; `.ready` resolves after the complete outfit/hair.
 * Returns the character contract { root, meshes, humanoid, headBone, capabilities, quality, ready, restHeads(), eyeOffset(),
 * bodyShape, applyPose(pose), resetPose(), onRestChange(cb), setFirstPerson(on), tick(dt, physics, { gaze, frozen }),
 * resetSecondary(), dispose() } plus CharacterCreator extras (body, parts, values, clothing, cloth, eyeLife, hair, setSlider,
 * update).
 */
export async function createAvatar({ scene, physicsScene = scene, assetsURL, settings = { values: {} }, quality = {}, signal }) {
  const lifetime = createLifetime(), owner = createResourceOwner(), S = settings.values;
  let root = null, cloth = null, clothing = null, humanoid = null, lastPose = null;
  let headHidden = false, firstPerson = false;
  const restListeners = new Set(), colliders = new Map();
  const dispose = () => lifetime.dispose();
  lifetime.onDispose(() => {
    signal?.removeEventListener('abort', dispose);
    restListeners.clear(); colliders.clear(); clothing?.dispose(); cloth?.dispose(); root?.removeFromParent();
    owner.dispose();
  });
  if (signal?.aborted) dispose(); else signal?.addEventListener('abort', dispose, { once: true });
  const base = assetBaseURL(assetsURL);
  const loader = new GLTFLoader().setPath(base.href);
  const load = loader.loadAsync.bind(loader);
  loader.loadAsync = async (...args) => {
    lifetime.assertAlive();
    const g = await lifetime.accept(load(...args), g => {
      owner.track(g.scene); owner.dispose();
    });
    owner.track(g.scene);
    return g;
  };
  async function json(name, required = false) {
    try {
      const response = await fetch(new URL(name, base), { signal: lifetime.signal });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (required || lifetime.disposed) throw error;
      return null;
    }
  }
  // Attach rejection handlers immediately, even when the body GLB fails first.
  const manifests = Promise.all([json('base_body.joints.json', true), json('hair.json'), json('clothing.json', true), quality.cloth ? json('body_colliders.json') : null]);
  manifests.catch(() => {});
  try {
    lifetime.assertAlive();
    const g = await loader.loadAsync('base_body.glb');
    root = g.scene; root.name = 'CharacterModel'; scene.add(root);
    const meshes = CC.characterMeshes(root);
    const body = meshes.find(m => m.name === 'Body') ?? meshes.find(m => [].concat(m.material).some(mat => CC.materialRole(mat?.name) === 'skin'));
    if (!body) throw new Error('base_body.glb: no skinned body mesh');
    const parts = [...meshes];
    // glTF defaults can have every morph at 1. Never snapshot/rebase a non-neutral rest.
    for (const mesh of meshes) {
      mesh.morphTargetInfluences?.fill(0);
      if (mesh !== body) CC.bindToSkeleton(mesh, body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false;
    }
    root.updateMatrixWorld(true);
    const headBone = body.skeleton.bones.find(b => b.name === MPFB_GAME_ENGINE.head) ?? null;
    const headRest = headBone?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.515, 0.04);
    const eyeBox = new THREE.Box3();
    for (const mesh of meshes.filter(m => /^Eyes(_\d+)?$/.test(m.name))) {
      mesh.geometry.computeBoundingBox(); eyeBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    const eyeMid = eyeBox.isEmpty() ? new THREE.Vector3(0, 1.553, 0.118) : eyeBox.getCenter(new THREE.Vector3());
    const eyeOffset0 = eyeMid.sub(headRest).toArray(), headH0 = headRest.y || 1.515;
    const [joints, hairManifest, clothingManifest, colliderManifest] = await manifests;
    lifetime.assertAlive();
    if (!joints?.morphs) throw new Error('base_body.joints.json: invalid joint sidecar');
    const values = { ...CC.defaultValues(), skin: S.skin ?? '#c99a80', hairColor: S.hairColor ?? hairManifest?.defaultColor ?? '#3b2a1e', eyeColor: S.eyeColor ?? '#4a2f19', lashes: '#1c1510' };
    for (const slider of CC.SLIDERS) if (Number.isFinite(Number(S.body?.[slider.id]))) values[slider.id] = Math.max(-1, Math.min(1, Number(S.body[slider.id])));
    values.gender = CC.genderOfSex(S.sex ?? 'male') ?? 1;
    let hair = null;
    function markHeads() {
      for (const mesh of parts) {
        const isHead = mesh.userData.pluginHair || FACE_PART.test(mesh.name) || [].concat(mesh.material).some(mat => /^(Eyebrow|Eyelash|Eye|Iris|Cornea|Teeth|Tongue)$/.test(mat?.name || ''));
        if (isHead) { mesh.layers.enable(LAYERS.HEAD); if (firstPerson) mesh.layers.disable(LAYERS.MAIN); else mesh.layers.enable(LAYERS.MAIN); }
      }
    }
    function update() {
      if (lifetime.disposed) return;
      // Rebase and calibrate colliders at REST, not in the last animated/hide-head pose.
      if (humanoid) resetPose(humanoid);
      if (headBone) headBone.scale.setScalar(1);
      for (const mesh of parts) CC.applySliders(mesh, values);
      CC.applySkeleton(body, joints, values);
      CC.applyTints(root, { skin: values.skin, hair: values.hairColor, brows: values.hairColor, eyes: values.eyeColor, lashes: values.lashes });
      setSkinParams(parts, values.gender);
      root.updateMatrixWorld(true);
      for (const c of colliders.values()) c.calibrate(parts.filter(m => m.visible && m.userData.ccClothing));
      // Rest geometry changed (sliders, sex): the avatar re-measures its IK rig (restHeads() is pose independent).
      if (humanoid) for (const callback of [...restListeners]) callback();
      if (lastPose) applyPose(humanoid, lastPose);
      if (headBone && headHidden) headBone.scale.setScalar(1e-3);
      markHeads(); root.updateMatrixWorld(true);
    }
    // First applySkeleton must snapshot unmodified rest rotations. Only then create humanoid.
    update();
    humanoid = createHumanoid(body, { root, map: MPFB_GAME_ENGINE });
    await upgradeMaterials(root, g.parser, quality, lifetime, owner);
    setupMaterials(root, quality); update();
    const eyeLife = createEyeLife({ blink: true });
    clothing = createClothing({ loader, body, parts, lifetime, owner, getSex: () => CC.sexOf(values), onChange: () => {
      setupMaterials(root, quality); update(); cloth?.reset();
    } });
    if (quality.cloth) {
      cloth = createClothRuntime({ THREE, scene: physicsScene, colliders: colliderManifest, getBody: () => body,
        getInfluences: () => CC.sliderInfluences(values), getRootSpeed: () => 0,
        getForward: () => new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).toArray(), useWorker: quality.useWorker !== false });
      cloth.setEnabled(true); cloth.setWind(S.wind ?? 0);
    }
    async function loadHair(id) {
      if (!id || id === 'none') return;
      const style = hairManifest?.styles?.find(style => style.id === id);
      if (!style) throw new Error(`Unknown hair style: ${id}`);
      const hg = await loader.loadAsync(style.file), hairMeshes = CC.characterMeshes(hg.scene);
      if (!hairMeshes.length) throw new Error(`${style.file}: no skinned hair mesh`);
      await upgradeMaterials(hg.scene, hg.parser, quality, lifetime, owner);
      lifetime.assertAlive();
      setupMaterials(hg.scene, quality);
      for (const mesh of hairMeshes) {
        mesh.morphTargetInfluences?.fill(0); mesh.removeFromParent();
        mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
        if (CC.bindToSkeleton(mesh, body.skeleton, body.bindMatrix).missing.length) throw new Error(`${style.file}: missing body bones`);
        body.parent.add(mesh); mesh.frustumCulled = false; mesh.userData.pluginHair = true; parts.push(mesh);
        if (quality.hairCollision !== false) {
          const collider = createHairCollider(mesh);
          if (collider.ok && collider.weightedVertices) colliders.set(mesh, collider);
        }
      }
      hair = id; update();
    }
    const ready = Promise.all([
      loadHair(S.hair === undefined ? 'short02' : S.hair),
      clothing.init(Promise.resolve(clothingManifest), S.outfit ?? ['shirt', 'jeans', 'shoes']).then(() => {
        for (const [id, colors] of Object.entries(S.colors || {})) for (const which of ['primary', 'secondary']) if (colors?.[which]) clothing.setColor(id, which, colors[which]);
      }),
    ]).then(() => { lifetime.assertAlive(); owner.refresh(); }).catch(error => { dispose(); throw error; });
    ready.catch(() => {});
    const character = {
      id: 'cc', root, body, parts, meshes: parts, values, clothing, eyeLife, ready, headBone,
      capabilities: Object.freeze({ fingers: true, eyes: true, cloth: !!quality.cloth, morphs: true }),
      quality: CHARACTER_QUALITY,
      get humanoid() { return humanoid; }, get cloth() { return cloth; }, get hair() { return hair; },
      get disposed() { return lifetime.disposed; },
      /** Rest joint heads (character frame) of the current body. */
      restHeads: () => restHeads(humanoid),
      /** Eye centre minus head joint at rest (character frame), scaled with the current head height. */
      eyeOffset() { const k = restHeads(humanoid).head[1] / headH0; return [0, eyeOffset0[1] * k, eyeOffset0[2] * k]; },
      /** Torso profile for the avatar's hand-vs-body collision. */
      get bodyShape() { return { male: values.gender >= 0 ? 1 : 0, bust: values.gender < 0 ? Math.max(0, values.breastSize) * 0.04 : 0 }; },
      /** callback() after the rest geometry changed; returns an idempotent unsubscribe. */
      onRestChange(callback) {
        if (lifetime.disposed) return () => {};
        restListeners.add(callback);
        return () => restListeners.delete(callback);
      },
      applyPose(pose) { if (lifetime.disposed) return; lastPose = pose; applyPose(humanoid, pose); },
      resetPose() { if (lifetime.disposed) return; lastPose = null; resetPose(humanoid); },
      update,
      setSlider(id, value) { if (CC.SLIDERS.some(s => s.id === id)) { values[id] = Math.max(-1, Math.min(1, Number(value) || 0)); update(); cloth?.reset(); } },
      setFirstPerson(on) {
        if (lifetime.disposed) return;
        firstPerson = !!on; headHidden = firstPerson;
        if (headBone) { headBone.scale.setScalar(firstPerson ? 1e-3 : 1); root.updateMatrixWorld(true); }
        markHeads();
      },
      resetSecondary() { cloth?.reset(); },
      // gaze is {yaw,pitch} in the canonical HEAD frame; frozen preserves all eye-life timers/weights.
      tick(dt, physics = true, { gaze = null, frozen = false } = {}) {
        if (lifetime.disposed) return;
        dt = frameDelta(dt); root.updateMatrixWorld(true);
        if (!frozen) {
          const weights = eyeLife.update(dt, gaze);
          for (const mesh of parts) applyMorphWeights(mesh, weights);
        }
        if (!physics) return;
        for (const collider of colliders.values()) collider.update();
        cloth?.update(dt, parts);
      },
      dispose,
    };
    return character;
  } catch (error) { dispose(); throw error; }
}

async function upgradeMaterials(root, parser, quality, lifetime, owner) {
  const jobs = [];
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    [].concat(mesh.material).forEach((material, i) => {
      const role = CC.materialRole(material?.name);
      const swap = next => {
        if (Array.isArray(mesh.material)) mesh.material[i] = next; else mesh.material = next;
        owner.refresh(); lifetime.assertAlive();
      };
      if (role === 'skin' && quality.skinUpgrade !== false) jobs.push((async () => {
        const index = material.userData?.ccRegions?.index;
        const texture = index !== undefined ? await lifetime.accept(parser.getDependency('texture', index), texture => owner.own(texture)) : null;
        if (texture) owner.own(texture);
        lifetime.assertAlive(); swap(upgradeSkin(material, texture));
      })());
      else if (role === 'hair' && quality.hairUpgrade !== false) swap(upgradeHair(material, mesh.geometry));
      else if (material?.name === 'Cornea') upgradeCornea(material);
    });
  });
  await Promise.all(jobs); owner.refresh(); lifetime.assertAlive();
}
function setupMaterials(root, quality) {
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = quality.shadows !== false;
    for (const material of [].concat(mesh.material || [])) {
      const role = CC.materialRole(material?.name);
      if (['hair', 'brows', 'lashes'].includes(role)) {
        material.alphaToCoverage = true; material.transparent = false; material.depthWrite = true; material.side = THREE.DoubleSide;
        if (role !== 'hair') mesh.castShadow = false;
      }
      if (material?.name === 'Cornea') { material.envMapIntensity = 0.7; mesh.castShadow = mesh.receiveShadow = false; mesh.renderOrder = 2; }
      if (['Eye', 'Iris'].includes(material?.name)) mesh.castShadow = false;
    }
  });
}
