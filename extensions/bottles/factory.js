// Bottle factory: loads catalog bottles and *.bottle.json designs (GLB + liquid), gives each a physics body through
// BottleBodies (host physics adapter, no engine), and owns the per-frame liquid update and mass from fill.
// adopt() takes a model the game built itself (procedural bottles, tests): same bottle record, same body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupBottleFromUrl } from './bottle_liquid.js';
import { loadDesign } from './bottle_design.js';
import { BottleDamageProfile } from './damage.js';
import { bottleQuality, tierIndex } from './quality.js';
import { setBottleLiquidColor } from './liquid_color.js';

let loader = null; // created on first load, so node tests that adopt() never need a GLTFLoader
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** sRGB [r, g, b] (0..1) from an array or a 0xRRGGBB number. */
const srgbOf = c => typeof c === 'number' ? [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255] : [c[0], c[1], c[2]];

export class BottleFactory {
  /** bodies: BottleBodies; audio: { play(key, minGapMs) }; catalog: { assets: [{ id, file, … }] }; assetURL(path) -> url. */
  constructor(scene, bodies, audio, catalog = { assets: [] }, { assetURL = path => path, tier = 'high' } = {}) {
    this.scene = scene;
    this.bodies = bodies;
    this.audio = audio;
    this.assetURL = assetURL;
    this.assets = new Map((catalog?.assets ?? []).map(a => [a.id, a]));
    this.bottles = new Set();
    this.onImpact = null; // (bottle, impact) => void; the breakage system sets it
    this.tier = tier;
    this.settings = bottleQuality(tier);
    this.quality = tierIndex(tier); // 0..3, the demo's quality level
  }

  path(path) { return this.assetURL(path); }

  /** extra: more adopt() options (body, color, …); extra.breakInfo is merged over the loaded *.break.json. */
  async spawn(id, design, fill, position, open = false, extra = {}) {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`Unknown bottle: ${id}`);
    const url = this.path(design ? `export/designs/${design}.glb` : asset.file);
    let root, liquid, designHandle;
    if (design) {
      designHandle = await loadDesign(url, { fill, tier: 'high' });
      root = designHandle.root;
      liquid = designHandle.bottle;
    } else {
      root = (await (loader ??= new GLTFLoader()).loadAsync(url)).scene;
      let info;
      if (asset.liquid_sidecar) {
        const sidecarUrl = this.path(asset.liquid_sidecar);
        const response = await fetch(sidecarUrl);
        if (!response.ok) throw new Error(`Could not load liquid metadata for ${id}: HTTP ${response.status} (${sidecarUrl})`);
        info = await response.json();
        if (!info || typeof info !== 'object' || Array.isArray(info)) {
          throw new Error(`Invalid liquid metadata for ${id}: ${sidecarUrl}`);
        }
      }
      // Explicit catalog paths avoid speculative .liquid_v2.json requests for
      // newer bottles/containers. Legacy assets retain the helper's fallback.
      liquid = await setupBottleFromUrl(root, url, { fill, capOpen: open, info });
    }
    let breakInfo = {};
    if (asset.break_info) {
      try { const response = await fetch(this.path(asset.break_info)); if (response.ok) breakInfo = await response.json(); }
      catch (error) { console.warn(`No break metadata for ${id}`, error); }
    }
    return this.adopt({ id, design, asset, root, liquid, designHandle, fill, position, open, ...extra,
      breakInfo: { ...breakInfo, ...extra.breakInfo } });
  }

  /**
   * Make a bottle from a loaded model. root: Object3D with its origin at the centre of the base; liquid: a
   * bottle_liquid.js driver (or anything with info, fill, capOpen, agitate(), update(), liquid mesh + lut for pouring);
   * asset: catalog entry (height_m, capacity_ml, glass, shards); breakInfo: *.break.json content.
   * body (optional): { shape, options } for the physics adapter — the game's own collision shape (e.g. its exact
   * silhouette, so grasping and collision use the same geometry) and extra addBody options (userData, …).
   * color (optional): the liquid's colour, sRGB as [r, g, b] (0..1) or a 0xRRGGBB number; it becomes the bottle's
   * absorbance (liquid_color.js), so its drops, streams and puddles and anything it is mixed into carry it.
   */
  adopt({ id, design = '', asset = {}, root, liquid, designHandle = null, breakInfo = {}, fill = 0.5, position = null, open = false,
    body = null, color = null }) {
    if (position) root.position.copy(position);
    root.updateMatrixWorld(true);
    this.scene.add(root);
    const info = liquid.info || {};
    const height = asset.height_m || (info.bounds?.max?.[1] || 0.25);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = clamp(Math.max(size.x, size.z) * 0.45, 0.025, 0.13);
    const isPlastic = /pet|plastic/i.test(breakInfo.material || asset.glass || '');
    const shatters = !!breakInfo.shatters;
    const profile = new BottleDamageProfile(breakInfo, asset);
    const capacity = info.capacity_ml || asset.capacity_ml || 500;
    const bottle = {
      id, design, asset, root, liquid, designHandle, height, radius, capacity, breakInfo, profile,
      fillMl: capacity * fill, open: open || !!info.open, isPlastic, shatters, broken: false,
      lastImpact: -Infinity, lastPour: 0, entry: null, mass: profile.mass(fill), holes: [], damage: 0, damageStage: 'intact',
    };
    bottle.setOpen = value => {
      if (info.open) return;
      bottle.open = !!value;
      liquid.capOpen = bottle.open;
      root.traverse(o => { if (o.name.startsWith('Cap')) o.visible = !bottle.open; });
      this.audio.play('cap', 250);
    };
    if (open) bottle.setOpen(true);
    // entry: the physics adapter handle (the game holds and releases it through its own adapter).
    if (color != null) setBottleLiquidColor(bottle, srgbOf(color));
    bottle.entry = this.bodies.bottle(root, {
      radius, height, mass: bottle.mass, surface: isPlastic ? 'plastic' : 'bottle',
      onImpact: (speed, impact) => this._impact(bottle, speed, impact), shape: body?.shape ?? null, options: body?.options ?? null,
    });
    root.userData.bottle = bottle;
    root.traverse(o => { o.userData.bottle = bottle; });
    this.bottles.add(bottle);
    this._applyQuality(bottle);
    return bottle;
  }

  _impact(bottle, speed, impact) {
    if (!this.bottles.has(bottle)) return;
    const now = performance.now();
    if (this.bodies.isHeld(bottle.entry)) return;
    if (now - bottle.lastImpact < 180 || bottle.broken) return;
    bottle.lastImpact = now;
    bottle.liquid.agitate(Math.min(1, speed / 6));
    this.onImpact?.(bottle, { ...impact, speed });
    this.audio.play(bottle.isPlastic ? 'plastic' : 'clink', 90);
  }

  remove(bottle) {
    if (!this.bottles.delete(bottle)) return;
    this.bodies.remove(bottle.entry);
    this.scene.remove(bottle.root);
    bottle.designHandle?.dispose();
  }

  _applyQuality(b) {
    const s = this.settings;
    b.liquid.bubbles = s.bubbles;
    b.liquid.slosh = s.slosh;
    b.root.traverse(o => { if (o.isMesh) { o.castShadow = s.shadows; o.receiveShadow = true; } });
  }

  /** tier: one of BOTTLE_TIERS. */
  setQuality(tier) {
    this.tier = tier;
    this.settings = bottleQuality(tier);
    this.quality = tierIndex(tier);
    for (const b of this.bottles) this._applyQuality(b);
  }

  update(dt) {
    for (const b of this.bottles) {
      b.liquid.update(dt);
      b.mass = b.profile.mass(b.fillMl / b.capacity);
      this.bodies.setMass(b.entry, b.mass);
    }
  }
}
