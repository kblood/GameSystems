import { registry, positive, tierState, SYSTEM_TIERS } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

export const CAMERA_BUDGETS = Object.freeze({ minimal: { width: 128, fps: 2, perStep: 1 }, low: { width: 256, fps: 4, perStep: 1 }, mid: { width: 512, fps: 8, perStep: 2 }, high: { width: 1024, fps: 15, perStep: 2 } });

// Cameras are application-owned; this system owns render targets and display materials only.
export function createCameraSystem({ THREE, renderer, scene, quality = 'high', emit = () => {}, maxFeeds = 16, maxScreens = 32 } = {}) {
  if (!THREE?.WebGLRenderTarget || !renderer?.render || !scene?.isScene) throw new TypeError('Cameras require THREE, renderer and scene');
  for (const budget of [maxFeeds, maxScreens]) if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError('Camera registry budget must be a positive integer');
  const feeds = registry(), screens = registry(), tiers = tierState(quality); tiers.setQuality(quality);
  let clock = 0, cursor = 0, disposed = false;
  function live() { if (disposed) throw new Error('System is disposed'); }
  function budget() { return CAMERA_BUDGETS[tiers.quality]; }
  function dimensions(aspect) { const size = budget().width; return [Math.max(1, Math.round(Math.min(size, size * aspect))), Math.max(1, Math.round(Math.min(size, size / aspect)))]; }
  function visible(mesh) { for (let o = mesh; o; o = o.parent) if (!o.visible) return false; return true; }
  function allocate(aspect) {
    const [width, height] = dimensions(aspect);
    const target = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    target.texture.name = 'GameSystems camera feed'; return target;
  }
  function display(screen) {
    const feed = screen.feedId === null ? null : feeds.get(screen.feedId);
    const active = screen.enabled && feed?.enabled && feed.frames > 0;
    screen.material.map = active ? feed.target.texture : null;
    screen.material.color.set(active ? 0xffffff : 0x080d12); screen.material.needsUpdate = true;
  }
  function refresh() { for (const screen of screens.entries.values()) display(screen); }
  function draw(feed) {
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const oldTarget = renderer.getRenderTarget(), cubeFace = renderer.getActiveCubeFace?.() ?? 0, mipLevel = renderer.getActiveMipmapLevel?.() ?? 0, scissorTest = renderer.getScissorTest(), xrEnabled = renderer.xr?.enabled, autoClear = renderer.autoClear;
    const visibility = [...screens.entries.values()].map(s => [s.mesh, s.mesh.visible]);
    try {
      for (const [mesh] of visibility) mesh.visible = false; // Avoid monitor recursion and feedback texture sampling.
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.autoClear = true; renderer.setRenderTarget(feed.target); renderer.setViewport(0, 0, feed.target.width, feed.target.height); renderer.setScissorTest(false);
      renderer.render(feed.scene, feed.camera); feed.frames++; feed.lastTime = clock;
    } finally {
      renderer.setRenderTarget(oldTarget,cubeFace,mipLevel); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear; if (renderer.xr) renderer.xr.enabled = xrEnabled;
      for (const [mesh, visible] of visibility) mesh.visible = visible;
    }
  }
  const api = {
    get quality() { return tiers.quality; },
    setQuality(value) {
      live(); tiers.setQuality(value);
      for (const feed of feeds.entries.values()) { feed.target.setSize(...dimensions(feed.aspect)); feed.frames = 0; feed.lastTime = -Infinity; }
      refresh();
    },
    addFeed(id, { camera, feedScene = scene, enabled = true } = {}) {
      live(); if (feeds.entries.size >= maxFeeds) throw new RangeError('Camera feed budget exceeded');
      if (!camera?.isPerspectiveCamera || !feedScene?.isScene) throw new TypeError('Perspective camera and scene required');
      const aspect = positive(camera.aspect, 'camera aspect'); if (aspect < .25 || aspect > 4) throw new RangeError('Camera aspect outside render budget');
      booleanState(enabled);
      // Validate registry id before allocating a GPU resource.
      if (typeof id !== 'string' || !id || feeds.entries.has(id)) throw new Error('Invalid or duplicate camera feed');
      const target = allocate(aspect); feeds.add(id, { id, camera, scene: feedScene, aspect, enabled, target, frames: 0, lastTime: -Infinity });
      return api.feedState(id);
    },
    addScreen(id, { mesh, feedId = null, enabled = true } = {}) {
      live(); if (screens.entries.size >= maxScreens) throw new RangeError('Camera screen budget exceeded');
      if (!mesh?.isMesh || !mesh.material || Array.isArray(mesh.material)) throw new TypeError('Screen needs a mesh with one material');
      if ([...screens.entries.values()].some(s => s.mesh === mesh)) throw new Error('Screen mesh already bound');
      if (feedId !== null) feeds.get(feedId); booleanState(enabled);
      if (typeof id !== 'string' || !id || screens.entries.has(id)) throw new Error('Invalid or duplicate screen');
      const original = mesh.material, material = new THREE.MeshBasicMaterial({ color: 0x080d12, toneMapped: false });
      screens.add(id, { id, mesh, original, material, feedId, enabled }); mesh.material = material; display(screens.get(id)); return api.screenState(id);
    },
    feedState(id) { live(); const f = feeds.get(id); return { id, enabled: f.enabled, aspect: f.aspect, frames: f.frames, width: f.target.width, height: f.target.height }; },
    screenState(id) { live(); const s = screens.get(id); return { id, feedId: s.feedId, enabled: s.enabled }; },
    texture(id) { live(); return feeds.get(id).target.texture; },
    switchFeed(screenId, feedId) { live(); if (feedId !== null) feeds.get(feedId); const s = screens.get(screenId); s.feedId = feedId; display(s); emit('cameras:screen', api.screenState(screenId)); },
    setScreenEnabled(id, value) { live(); const s = screens.get(id); s.enabled = booleanState(value); display(s); },
    setFeedEnabled(id, value) { live(); const f = feeds.get(id); f.enabled = booleanState(value); f.lastTime = -Infinity; refresh(); },
    removeScreen(id) { live(); const s = screens.get(id); if (s.mesh.material === s.material) s.mesh.material = s.original; s.material.dispose(); screens.remove(id); },
    removeFeed(id) { live(); const f = feeds.get(id); for (const s of screens.entries.values()) if (s.feedId === id) { s.feedId = null; display(s); } f.target.dispose(); feeds.remove(id); },
    step(dt) {
      live(); positive(dt, 'dt', true); clock += dt;
      const selected = new Set([...screens.entries.values()].filter(s => s.enabled && s.feedId !== null && visible(s.mesh)).map(s => s.feedId));
      const ordered = [...feeds.entries.values()].filter(f => f.enabled && selected.has(f.id)).sort((a, b) => a.id.localeCompare(b.id));
      let rendered = 0;
      for (let i = 0; i < ordered.length; i++) {
        const index = (cursor + i) % ordered.length, f = ordered[index];
        if (clock - f.lastTime + 1e-9 < 1 / budget().fps) continue;
        draw(f); rendered++;
        if (rendered >= budget().perStep) { cursor = (index + 1) % ordered.length; break; }
      }
      if (rendered) refresh(); return rendered;
    },
    stats() { live(); return { quality: tiers.quality, feeds: feeds.entries.size, screens: screens.entries.size, frames: [...feeds.entries.values()].reduce((n, f) => n + f.frames, 0), ...budget() }; },
    capture() { live(); return { schema: 'gamesystems.cameras.v1', feeds: [...feeds.entries.values()].map(f => ({ id: f.id, enabled: f.enabled })), screens: [...screens.entries.keys()].map(id => api.screenState(id)) }; },
    prepareRestore(raw) {
      live(); const data = jsonState(raw);
      if (data.schema !== 'gamesystems.cameras.v1' || !Array.isArray(data.feeds) || !Array.isArray(data.screens) || data.feeds.length !== feeds.entries.size || data.screens.length !== screens.entries.size) throw new Error('Camera topology differs');
      const feedFlags = new Map(), screenFlags = new Map();
      for (const f of data.feeds) { feeds.get(f.id); if (feedFlags.has(f.id)) throw new Error('Duplicate camera'); feedFlags.set(f.id, booleanState(f.enabled)); }
      for (const s of data.screens) { screens.get(s.id); if (screenFlags.has(s.id)) throw new Error('Duplicate screen'); if (s.feedId !== null) feeds.get(s.feedId); screenFlags.set(s.id, { feedId: s.feedId, enabled: booleanState(s.enabled) }); }
      return { commit() { live(); for (const [id, enabled] of feedFlags) { const f = feeds.get(id); f.enabled = enabled; f.frames = 0; f.lastTime = -Infinity; } for (const [id, state] of screenFlags) Object.assign(screens.get(id), state); }, notify: refresh };
    },
    restore(raw) { const p = api.prepareRestore(raw); p.commit(); p.notify(); },
    dispose() { if (disposed) return; for (const id of [...screens.entries.keys()]) api.removeScreen(id); for (const id of [...feeds.entries.keys()]) api.removeFeed(id); disposed = true; screens.dispose(); feeds.dispose(); },
  };
  return api;
}
export default function camerasExtension(options = {}) {
  let api;
  return { id: 'cameras', quality: SYSTEM_TIERS,
    init(ctx) { api = createCameraSystem({ ...options, THREE: ctx.THREE, renderer: ctx.renderer, scene: ctx.scene, emit: ctx.emit, quality: ctx.quality }); return api; },
    update(dt) { api.step(dt); }, setQuality(tier) { api.setQuality(tier); }, dispose() { api?.dispose(); } };
}
