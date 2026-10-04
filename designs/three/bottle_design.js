// three.js runtime helper for *.bottle.json designs built by scripts/bottle_designer.py.   MIT / CC0.
//   import { loadDesign } from './bottle_design.js';
//   const d = await loadDesign('/shared/export/designs/wine_classic.glb', { tier: 'high', fill: 0.6 });
//   scene.add(d.root);  d.update(dt);                       // d.bottle = setupBottle() result (liquid)
//   d.slots()                                                // [{name, kind, material_kind, width_mm, height_mm, aspect, arc_deg, empty, visible}]
//   await d.setLabelImage('front', url | Blob | HTMLImageElement | ImageBitmap | THREE.Texture)
//   d.setLabelTint('front', '#ffd0d0'); d.setLabelVisible('back', false); d.clearLabel('neck');
//   await d.setTier('low')                                   // reloads <name>_low.glb (swap keeps the pose/parent)
// Tier files: <name>.glb (high), <name>_medium.glb, <name>_low.glb (one atlas), <name>_minimal.glb (one colour band).
// Slot swap works on high/medium (one mesh per slot). On low/minimal the slots live in a single atlas/band mesh:
// setLabelImage() returns false there (reload a higher tier first).
//
// TODO(owner) - liquid settings in extras.liquid that shaders/three/bottle_liquid.js cannot honour yet:
//   viscosity, opacity, foam static head, tint_strength, bubble_size runtime setter, density.  (see docs/bottle_designs.md)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupBottle } from '/shared/shaders/three/bottle_liquid.js';

export const TIERS = ['high', 'medium', 'low', 'minimal'];

export function tierPath(path, tier) {
  const base = path.replace(/_(medium|low|minimal)(?=\.glb$)/, '');
  return tier === 'high' ? base : base.replace(/\.glb$/, `_${tier}.glb`);
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function toTexture(src) {
  if (src && src.isTexture) return Promise.resolve(src);
  return new Promise((resolve, reject) => {
    const mk = (img) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;      // glTF UV convention (v down), same as the exported labels
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
      resolve(t);
    };
    if (typeof src === 'string' || src instanceof Blob) {
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => mk(img); img.onerror = () => reject(new Error('cannot load ' + url)); img.src = url;
    } else mk(src);
  });
}

function hasAlpha(img) {
  const w = Math.min(64, img.width), h = Math.min(64, img.height);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

export async function loadDesign(path, { tier = 'high', fill = 0.6, slosh = true, withLiquid = true } = {}) {
  const gltf = await new GLTFLoader().loadAsync(tierPath(path, tier));
  const root = gltf.scene;
  const out = { root, path, tier, bottle: null, labels: {}, atlas: null };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const ex = o.userData || {};
    if (ex.slot !== undefined && o.name.startsWith('Label_')) {
      o.material = o.material.clone();                           // per-slot swap must not leak between instances
      out.labels[ex.slot] = o;
    } else if (o.name === 'Labels') out.atlas = o;
  });
  if (withLiquid) out.bottle = setupBottle(root, { fill, slosh });
  out.update = (dt) => out.bottle && out.bottle.update(dt);
  out.supportsSlotSwap = () => Object.keys(out.labels).length > 0;

  out.slots = () => {
    if (out.atlas) {
      const s = parse(out.atlas.userData.slots) || {};
      return Object.entries(s).map(([name, v]) => ({ name, kind: 'atlas', material_kind: 'atlas', width_mm: v.width_m * 1000, height_mm: v.height_m * 1000,
        aspect: v.width_m / v.height_m, arc_deg: 0, empty: false, visible: out.atlas.visible }));
    }
    return Object.entries(out.labels).map(([name, m]) => {
      const u = m.userData;
      return { name, kind: u.kind || '', material_kind: u.material_kind || m.material.userData?.material_kind || '', width_mm: u.width_m * 1000,
        height_mm: u.height_m * 1000, aspect: u.aspect, arc_deg: u.arc_deg, empty: !!(u.empty), visible: m.visible };
    });
  };
  out.setLabelVisible = (slot, on) => { const m = out.labels[slot]; if (m) m.visible = on; else if (out.atlas) out.atlas.visible = on; };
  out.setLabelTint = (slot, color) => { const m = out.labels[slot]; if (m) m.material.color.set(color); };
  out.clearLabel = (slot) => { const m = out.labels[slot]; if (m) m.visible = false; };
  out.setLabelImage = async (slot, src) => {
    const m = out.labels[slot];
    if (!m) return false;
    const tex = await toTexture(src);
    const mat = m.material;
    mat.map = tex; mat.color.set(0xffffff);
    mat.roughnessMap = null; mat.roughness = 0.85; mat.metalness = 0;     // user art: plain matte paper, no old wear mask
    const clear = (m.userData.material_kind === 'clear_film');
    const a = tex.image && tex.image.width ? hasAlpha(tex.image) : false;
    mat.transparent = clear || a; mat.alphaTest = 0; mat.depthWrite = !mat.transparent;
    mat.needsUpdate = true; m.visible = true;
    return true;
  };
  out.setTier = async (t) => {
    const next = await loadDesign(path, { tier: t, fill: out.bottle ? out.bottle.fill : fill, slosh, withLiquid });
    const parent = root.parent;
    if (parent) { next.root.position.copy(root.position); next.root.quaternion.copy(root.quaternion); next.root.scale.copy(root.scale); parent.add(next.root); parent.remove(root); }
    return next;                                                         // caller replaces its reference
  };
  out.dispose = () => root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); } });
  return out;
}
