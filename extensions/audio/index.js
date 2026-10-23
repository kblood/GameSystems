// Audio extension (docs/audio_system.md): spatial Web Audio voice pool with contact sounds by material pair and impact
// strength, loops, hand grab/release and footsteps, muffled through the acoustics extension's room/portal graph.
//
//   system.js           createAudioSystem: voices, tiers (off | low 16 voices | mid 32, stereo | high 48, HRTF + lowpass),
//                       buffer cache, rate limits, contact(), play(), loops, acoustics muffling
//   bottle_adapter.js   { play(key, minGapMs) } for the bottles extension's `audio` option (BottleAudio keys)
//   sound_materials.json  materials, thing -> material map, strength thresholds, sound names (edit data, not code)
//
// Extension: host.load(audioExtension, { assetURL?, preload?, unlock?, acoustics?, data? }) -> api. Needs a browser
// AudioContext (without one the api is silent). Events it listens to: 'grab' / 'release' (hand sounds at the bottle),
// 'audio:play' { key, ...options }, 'audio:contact' { material1, material2, speed, position, ... }, 'xrStart' (resume),
// 'mechanics:changed' (door/drawer creaks by speed; options.creaks === false turns it off). Other options go to
// createAudioSystem (delayBySpeed, sharedContext, ...). footsteps.js (createFootstepTracker) is used by the game per frame.
// Everything is opt-in: nothing changes in a game until it loads this extension.
import { createAudioSystem, AUDIO_TIERS, AUDIO_QUALITY } from './system.js';
import { createCreakTrigger } from './creaks.js';

export { createAudioSystem, AUDIO_TIERS, AUDIO_QUALITY } from './system.js';
export { createBottleAudioAdapter } from './bottle_adapter.js';
export { createFootstepTracker } from './footsteps.js';
export { createCreakTrigger } from './creaks.js';
export { default as SOUND_DATA } from './sound_materials.json' with { type: 'json' };

/** Resume the AudioContext on the first user gesture (browsers and Quest keep it suspended until then). Returns an off function. */
export function installUnlock(system, target = globalThis.document, events = ['pointerdown', 'keydown', 'touchend', 'click']) {
  if (!target?.addEventListener) return () => {};
  const off = () => { for (const e of events) target.removeEventListener(e, handler); };
  const handler = () => { system.resume().then(ok => { if (ok) off(); }); };
  for (const e of events) target.addEventListener(e, handler, { passive: true });
  return off;
}

export default function audioExtension(options = {}) {
  let api = null, camera = null, clock = 0, creaks = null; const offs = [];
  const position = b => b?.root?.position ?? b?.position ?? null;
  return {
    id: 'audio',
    quality: AUDIO_TIERS,
    init(ctx) {
      api = createAudioSystem({ ...options, emit: ctx.emit, quality: ctx.quality,
        assetURL: options.assetURL ?? (path => String(ctx.assetURL(path))), acoustics: options.acoustics ?? (() => ctx.get('acoustics')) });
      camera = ctx.camera;
      offs.push(ctx.on('xrStart', () => api.resume()), ctx.on('audio:play', ({ key, ...o }) => api.play(key, o)),
        ctx.on('audio:contact', c => api.contact(c)));
      if (options.events !== false) offs.push(ctx.on('grab', e => api.grab({ position: position(e.bottle), sourceId: e.bottle?.id })),
        ctx.on('release', e => api.release({ position: position(e.bottle), sourceId: e.bottle?.id })));
      if (options.creaks !== false) {
        creaks = createCreakTrigger(api, options.creaks && typeof options.creaks === 'object' ? options.creaks : undefined);
        offs.push(ctx.on('mechanics:changed', s => creaks.handle(s, clock)));
      }
      if (options.unlock !== false) offs.push(installUnlock(api));
      if (options.preload !== false && ctx.quality !== 'off') api.preload(options.preload ?? ['contacts', 'hand', 'bottles']);
      return api;
    },
    update(dt) { clock += dt; if (camera?.matrixWorld) api.listenerFromMatrix(camera.matrixWorld.elements); api.step(dt); },
    setQuality(tier) { api.setQuality(tier); if (tier !== 'off') api.preload(options.preload ?? ['contacts', 'hand', 'bottles']); },
    dispose() { for (const off of offs.splice(0)) off(); api?.dispose(); api = null; },
  };
}
