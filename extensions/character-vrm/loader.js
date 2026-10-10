// GameSystems character-vrm extension: loads a .vrm with three.js GLTFLoader + three-vrm (@pixiv/three-vrm, MIT, pinned
// in each app's package.json). Only this file imports three-vrm, so character.js stays testable with a fake VRM.
// The model is untrusted data: it is parsed, never executed.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * Loads a VRM (0.x or 1.0). Returns three-vrm's VRM with autoUpdateHumanBones off (the character contract writes the raw
 * bones). options: signal (AbortSignal), loader (a GLTFLoader to reuse, e.g. with extra plugins in tests),
 * optimize (default true: VRMUtils.removeUnnecessaryVertices + combineSkeletons, fewer vertices and bone textures).
 */
export async function loadVRM(url, { signal, loader = new GLTFLoader(), optimize = true } = {}) {
  loader.register(parser => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
  const gltf = await (typeof url === 'string' || url instanceof URL
    ? loader.loadAsync(String(url))
    : loader.parseAsync(url, ''));
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error(`${typeof url === 'string' ? url : 'model'}: not a VRM (no VRM / VRMC_vrm extension)`);
  if (signal?.aborted) { VRMUtils.deepDispose(vrm.scene); const e = new Error('VRM load aborted'); e.name = 'AbortError'; throw e; }
  if (optimize) { VRMUtils.removeUnnecessaryVertices(vrm.scene); VRMUtils.combineSkeletons(vrm.scene); }
  return vrm;
}
