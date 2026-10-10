// GameSystems character-cc extension; from the Contracts character plugin (src/lifecycle.js). Source of truth:
// GameSystems/extensions/character-cc.
// MIT; fork of CharacterCreatorXR (Copyright (c) 2026 Kasper Olesen).
// A closed lifetime never accepts a late async resource. Cleanup is idempotent.
export function abortError() {
  const error = new Error('Character plugin disposed');
  error.name = 'AbortError';
  return error;
}

export function createLifetime() {
  const controller = new AbortController(), cleanups = new Set();
  return {
    signal: controller.signal,
    get disposed() { return controller.signal.aborted; },
    assertAlive() { if (controller.signal.aborted) throw abortError(); },
    onDispose(fn) {
      if (controller.signal.aborted) { fn(); return () => {}; }
      cleanups.add(fn);
      return () => cleanups.delete(fn);
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const fn of [...cleanups]) {
        try { fn(); } catch (error) { console.warn('[character-cc] cleanup failed', error); }
      }
      cleanups.clear();
    },
    accept(promise, release) {
      return new Promise((resolve, reject) => {
        const aborted = () => reject(abortError());
        if (controller.signal.aborted) aborted();
        else controller.signal.addEventListener('abort', aborted, { once: true });
        // GLTFLoader has no reliable cancellation API. Reject promptly, but keep
        // a handler on the original operation to release any late successful load.
        Promise.resolve(promise).then(resource => {
          controller.signal.removeEventListener('abort', aborted);
          if (controller.signal.aborted) { release(resource); reject(abortError()); }
          else resolve(resource);
        }, error => {
          controller.signal.removeEventListener('abort', aborted); reject(error);
        }).catch(error => reject(error));
      });
    },
  };
}

/** Own only imported model resources, never game-owned children (weapons etc.). */
export function createResourceOwner() {
  const meshes = new Set(), resources = new Set(), released = new WeakSet(), closedImages = new WeakSet();
  let closed = false;
  function collect(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.isTexture) { resources.add(value); return; }
    if (Array.isArray(value)) { value.forEach(v => collect(v, seen)); return; }
    // Material uniforms may contain textures inside {value}, including cloth masks.
    for (const v of Object.values(value)) {
      if (v?.isTexture || Array.isArray(v) || v?.value !== undefined) collect(v, seen);
    }
    if (value.value !== undefined) collect(value.value, seen);
  }
  function scan(mesh) {
    if (mesh.geometry) resources.add(mesh.geometry);
    if (mesh.skeleton) resources.add(mesh.skeleton);
    for (const material of [].concat(mesh.material || [])) {
      resources.add(material);
      collect(material);
      collect(material.uniforms);
      collect(material.userData?.ccUniforms);
      collect(material.userData?.pluginUniforms);
    }
  }
  function release() {
    for (const mesh of meshes) { scan(mesh); mesh.removeFromParent(); }
    for (const resource of resources) if (resource && !released.has(resource)) {
      released.add(resource); resource.dispose?.();
      if (resource.isTexture) for (const image of [].concat(resource.source?.data || [])) {
        if (image?.close && !closedImages.has(image)) { closedImages.add(image); image.close(); }
      }
    }
  }
  return {
    track(root) {
      root.traverse(o => { if (o.isMesh) { meshes.add(o); scan(o); } });
      if (closed) release();
      return root;
    },
    own(resource) { if (resource) resources.add(resource); if (closed) release(); return resource; },
    refresh() { for (const mesh of meshes) scan(mesh); if (closed) release(); },
    dispose() { closed = true; release(); },
  };
}

export const frameDelta = dt => Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
