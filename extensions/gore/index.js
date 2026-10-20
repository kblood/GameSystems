// GameSystems gore extension: public API. Shoot-apart zombies (House of the Dead style) for any character that implements
// the humanoid character contract (extensions/humanoid contract.js: humanoid.bones, restHeads(), skinned meshes).
//
// How a character comes apart is decided offline: tools/bake_gibs.mjs splits a topology (MakeHuman / CharacterCreator
// body, garments, hair) along authored seams (seams.js) into region pieces with stump caps and writes data/*.gibs.json +
// .gibs.bin. At runtime severing only switches draw ranges and spawns the pre-made gib (character.js); nothing is cut.
//
//   import { createGoreWorld, loadGibs, resolveGoreConfig } from '.../gore/index.js'
//   const world = createGoreWorld({ THREE, scene, physics, gibs: await loadGibs(), config: { goreLevel: 'high' } })
//   const zombie = world.attach(character, { config: { regions: { head: { health: 80 } } } })
//   world.shoot(origin, direction, { damage: 30 }); world.update(dt)
//
// Files: regions.js (body regions), config.js (the config, docs/gore_system.md), damage.js (health, severing, death),
// seams.js (authored seams), bake_format.js (data format), assemble.js (draw ranges), insides.js (procedural bones /
// organs), materials.js, effects.js (blood, decals, chunks), character.js (runtime), tools/ (node-only bake).
// Depends on: humanoid (public API), host (extension contract). Pure modules (no three.js): regions, config, damage,
// seams, bake_format, assemble, insides. Never imports avatar, grasp or a character system.
import { createGoreWorld } from './character.js';
import { decodeGibs, GIBS_FORMAT } from './bake_format.js';
import { resolveGoreConfig, effectiveConfig, validateGoreConfig, DEFAULT_GORE_CONFIG, GORE_LEVELS, SEAM_VARIANTS, LEVEL_LIMITS } from './config.js';

export { createGoreWorld, decodeGibs, GIBS_FORMAT };
export { resolveGoreConfig, effectiveConfig, validateGoreConfig, DEFAULT_GORE_CONFIG, GORE_LEVELS, SEAM_VARIANTS, LEVEL_LIMITS };
export { REGIONS, REGION, REGION_IDS, SEAM_IDS, subtree, ancestors, regionFromSkin } from './regions.js';
export { createDamageModel, MOBILITY } from './damage.js';
export { buildInsides, visibleInsides } from './insides.js';
export { assembleMesh, bodyRanges, gibRanges } from './assemble.js';
export { createCapMaterial, createInsidesMaterial, tearCloth } from './materials.js';
export { createGoreEffects } from './effects.js';

/** URLs of the bundled MakeHuman / CharacterCreator bake (data/ next to this module; the sync copies it). Both are
 * written out literally so bundlers (vite) emit both files. */
export const DEFAULT_GIBS_URL = new URL('./data/makehuman_cc.gibs.json', import.meta.url);
export const DEFAULT_GIBS_BIN_URL = new URL('./data/makehuman_cc.gibs.bin', import.meta.url);

/** Fetches and decodes a bake: url of the .gibs.json; bin: its .gibs.bin (default: next to it). */
export async function loadGibs(url = DEFAULT_GIBS_URL, { bin = null, signal } = {}) {
  const jsonURL = new URL(String(url), import.meta.url);
  const binURL = bin ? new URL(String(bin), import.meta.url)
    : String(url) === String(DEFAULT_GIBS_URL) ? DEFAULT_GIBS_BIN_URL : new URL(jsonURL.href.replace(/\.json$/, '.bin'));
  const [json, data] = await Promise.all([
    fetch(jsonURL, { signal }).then(r => { if (!r.ok) throw new Error(`${jsonURL}: HTTP ${r.status}`); return r.json(); }),
    fetch(binURL, { signal }).then(r => { if (!r.ok) throw new Error(`${binURL}: HTTP ${r.status}`); return r.arrayBuffer(); }),
  ]);
  return decodeGibs(json, data);
}

export const GORE_TIERS = GORE_LEVELS;

/**
 * Host extension: ctx.get('gore') is the gore world. options: { gibs (decoded bake, or a URL; default the bundled one),
 * config, floorY, walls }. The quality tier ('off' | 'low' | 'high') is the gore level.
 */
export default function goreExtension(options = {}) {
  let world = null;
  return {
    id: 'gore', requires: [], quality: GORE_TIERS,
    async init(ctx) {
      const gibs = options.gibs?.format ? options.gibs : await loadGibs(options.gibs ?? DEFAULT_GIBS_URL).catch(() => null);
      const config = { ...options.config, goreLevel: ctx.quality ?? options.config?.goreLevel ?? 'high' };
      world = createGoreWorld({ THREE: ctx.THREE, scene: ctx.scene, physics: ctx.physics, gibs, config, floorY: options.floorY ?? 0, walls: options.walls ?? [] });
      world.on(e => ctx.emit(`gore:${e.type}`, e));
      return world;
    },
    update(dt) { world?.update(dt); },
    setQuality(tier) { if (world) world.setConfig({ ...options.config, goreLevel: tier }); },
    dispose() { world?.dispose(); world = null; },
  };
}
