// three.js builder for furniture: buildFurnitureMesh(spec | type id, options) -> { group, update(furniture), setValues(), pick targets, stats, dispose() }.
// The only file of the extension that imports three; the kernel (spec.js, furniture.js, grips.js) stays engine-free.
//
// Budget (Quest): every primitive of a piece is merged. The static parts (body panels, shelves, fixed boards) become one mesh per material class,
// every moving part one mesh per material class under its own pivot group (handle merged into the part, vertex colours for the colours),
// so a four-drawer dresser is ~9 draw calls and a 12-type room stays in the low hundreds. Geometry is shared between pieces of the same type
// (a geometry cache keyed by spec/part/class; disposeFurnitureCache() frees it), the three materials are shared by every piece.
// update(furniture) only writes pivot position/quaternion (no allocation); call it once per frame (or only when furniture.part(id).value changed).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bodyPanels, parseSpec, typeSpec } from './spec.js';

const CLASS_OF = { metal: 'metal', glass: 'glass' };
const classOf = material => CLASS_OF[material] ?? 'matte';
const HANDLE_COLOR = new THREE.Color('#c9ced2'), KNOB_COLOR = new THREE.Color('#b9a37b'), RECESS_COLOR = new THREE.Color('#2b2d30');

let sharedMaterials = null;
export function furnitureMaterials() {
  return sharedMaterials ??= {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.4, depthWrite: false }),
  };
}
const geometryCache = new Map();
/** Frees the shared geometry and materials (all built pieces become invalid). */
export function disposeFurnitureCache() {
  for (const g of geometryCache.values()) g.dispose(); geometryCache.clear();
  if (sharedMaterials) { for (const m of Object.values(sharedMaterials)) m.dispose(); sharedMaterials = null; }
}
export const furnitureCacheSize = () => geometryCache.size;

function prim(geometry, color, at = [0, 0, 0], rotate = null) {
  const g = geometry;
  if (rotate) { if (rotate.x) g.rotateX(rotate.x); if (rotate.y) g.rotateY(rotate.y); if (rotate.z) g.rotateZ(rotate.z); }
  g.translate(at[0], at[1], at[2]);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const box = (size, at, color) => prim(new THREE.BoxGeometry(size[0], size[1], size[2]), color, at);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Handle primitives in part-centred coordinates (origin = part centre). */
function handleGeometries(part, h) {
  const out = [], d = part.size[2], at = h.at, r = h.radius, horizontal = h.orientation === 'horizontal';
  const faceZ = d / 2, stand = Math.max(0.012, at[2] - faceZ);
  switch (h.style) {
    case 'bar': {
      const L = h.length, rot = horizontal ? { z: Math.PI / 2 } : null;
      out.push(prim(new THREE.CylinderGeometry(r, r, L, 10), HANDLE_COLOR, at, rot));
      for (const s of [-1, 1]) {
        const off = horizontal ? [s * (L / 2 - r), 0, 0] : [0, s * (L / 2 - r), 0];
        out.push(prim(new THREE.CylinderGeometry(r * 0.7, r * 0.7, stand, 8), HANDLE_COLOR, [at[0] + off[0], at[1] + off[1], faceZ + stand / 2], { x: Math.PI / 2 }));
      }
      break;
    }
    case 'knob':
      out.push(prim(new THREE.SphereGeometry(r, 12, 8), KNOB_COLOR, at));
      out.push(prim(new THREE.CylinderGeometry(r * 0.35, r * 0.35, stand, 8), KNOB_COLOR, [at[0], at[1], faceZ + stand / 2], { x: Math.PI / 2 }));
      break;
    case 'lever': { // door lever (klinke): rosette + short stem + bar
      const L = h.length;
      out.push(prim(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 12), HANDLE_COLOR, [at[0], at[1], faceZ + 0.004], { x: Math.PI / 2 }));
      out.push(prim(new THREE.CylinderGeometry(r, r, stand, 8), HANDLE_COLOR, [at[0], at[1], faceZ + stand / 2], { x: Math.PI / 2 }));
      out.push(prim(new THREE.CylinderGeometry(r, r, L, 8), HANDLE_COLOR, [at[0] + (horizontal ? -L / 2 + r : 0), at[1] + (horizontal ? 0 : -L / 2 + r), at[2]], horizontal ? { z: Math.PI / 2 } : null));
      break;
    }
    case 'wheel': { // safe wheel: rim + three spokes + hub, facing +Z
      const R = h.length / 2;
      out.push(prim(new THREE.TorusGeometry(R, r, 6, 20), HANDLE_COLOR, at));
      out.push(prim(new THREE.CylinderGeometry(0.025, 0.025, stand, 10), HANDLE_COLOR, [at[0], at[1], faceZ + stand / 2], { x: Math.PI / 2 }));
      for (let i = 0; i < 3; i++) { const g = prim(new THREE.BoxGeometry(R * 2, r * 1.2, r * 1.2), HANDLE_COLOR, [0, 0, 0], { z: i * Math.PI / 3 }); g.translate(at[0], at[1], at[2]); out.push(g); }
      break;
    }
    case 'recessed':
      out.push(box([0.02, h.length, 0.012], [at[0], at[1], faceZ - 0.004], RECESS_COLOR));
      break;
    default: break;
  }
  return out;
}

/** Geometry of one moving part (centre-origin), without handles. */
function partGeometries(part, color) {
  const [w, h, d] = part.size, out = [];
  if (part.kind === 'drawer') {
    const t = 0.02, wall = 0.012;
    out.push(box([w, h, t], [0, 0, d / 2 - t / 2], color));
    out.push(box([w - 2 * wall - 0.01, wall, d - t - 0.005], [0, -h / 2 + wall / 2, -t / 2], color));
    for (const s of [-1, 1]) out.push(box([wall, h, d - t], [s * (w / 2 - wall / 2 - 0.005), 0, -t / 2], color));
    out.push(box([w - 0.03, h, wall], [0, 0, -d / 2 + wall / 2], color));
  } else out.push(box([w, h, d], [0, 0, 0], color));
  return out;
}

function merged(list) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); return g; }

/**
 * Builds the meshes of a furniture piece. Options: { position:[x,y,z], yaw, shadows:false, materials }.
 * Returns { group, pivots: Map(partId -> Group), meshes: Mesh[] (pickable; userData.partId on moving parts), update(furniture), setValue(partId, v), stats, dispose() }.
 */
export function buildFurnitureMesh(specOrId, options = {}) {
  const spec = typeof specOrId === 'string' ? typeSpec(specOrId) : parseSpec(specOrId);
  const mats = options.materials ?? furnitureMaterials();
  const group = new THREE.Group(); group.name = `furniture:${spec.id}`;
  if (options.position) group.position.set(...options.position);
  group.rotation.y = options.yaw ?? 0;
  const meshes = [], pivots = new Map(), movers = [];
  const cached = (key, make) => { let g = geometryCache.get(key); if (!g) { g = make(); geometryCache.set(key, g); } return g; };
  const addMesh = (parent, key, make, cls, userData) => {
    const m = new THREE.Mesh(cached(key, make), mats[cls]);
    m.castShadow = m.receiveShadow = !!options.shadows; Object.assign(m.userData, userData); parent.add(m); meshes.push(m); return m;
  };
  // static parts: bodies, shelves and boards, one merged mesh per class
  const staticByClass = { matte: [], metal: [], glass: [] };
  for (const p of spec.parts) {
    if (p.kind === 'body') for (const panel of bodyPanels(p)) staticByClass[classOf(p.material)].push({ at: panel.at, size: panel.size, color: p.color });
    else if (p.kind === 'shelf') staticByClass[classOf(p.material)].push({ at: p.position, size: p.size, color: p.color });
  }
  for (const [cls, list] of Object.entries(staticByClass)) {
    if (!list.length) continue;
    addMesh(group, `${spec.id}:static:${cls}:${list.length}:${JSON.stringify(list.map(x => x.at))}`, () => merged(list.map(x => box(x.size, x.at, new THREE.Color(x.color)))), cls, { static: true });
  }
  // moving parts: pivot group + one mesh per class (part + handle)
  for (const p of spec.parts) {
    if (!p.mechanism) continue;
    const m = p.mechanism, pivot = new THREE.Group(); pivot.name = `part:${p.id}`;
    const base = m.type === 'hinge' ? m.pivot : p.position;
    pivot.position.set(...base); pivot.userData = { partId: p.id, axis: new THREE.Vector3(...m.axis), hinge: m.type === 'hinge', base: new THREE.Vector3(...base) };
    group.add(pivot); pivots.set(p.id, pivot);
    const cls = classOf(p.material), rel = sub(p.position, base), color = new THREE.Color(p.color);
    const key = `${spec.id}:${p.id}:${cls}:${JSON.stringify([p.size, p.position, p.color, p.handles.map(h => [h.style, h.at, h.length, h.radius, h.orientation])])}`;
    const g = cached(key, () => {
      const list = partGeometries(p, color); for (const h of p.handles) list.push(...handleGeometries(p, h));
      for (const x of list) x.translate(rel[0], rel[1], rel[2]);
      return merged(list);
    });
    const mesh = new THREE.Mesh(g, mats[cls]); mesh.castShadow = mesh.receiveShadow = !!options.shadows; mesh.userData.partId = p.id; mesh.userData.moving = true;
    pivot.add(mesh); meshes.push(mesh); movers.push(pivot);
  }
  group.updateMatrixWorld(true);
  const stats = { drawCalls: meshes.length, triangles: meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0), pivots: movers.length };
  const setValue = (id, v) => {
    const pv = pivots.get(id); if (!pv) return;
    const u = pv.userData;
    if (u.hinge) pv.quaternion.setFromAxisAngle(u.axis, v); else pv.position.set(u.base.x + u.axis.x * v, u.base.y + u.axis.y * v, u.base.z + u.axis.z * v);
  };
  return {
    group, pivots, meshes, stats, spec, setValue,
    /** Copies every moving part's value from a furniture runtime (furniture.parts is live; no allocation). */
    update(furniture) { for (const r of furniture.moving) setValue(r.id, r.value); },
    dispose() { group.removeFromParent(); group.clear(); meshes.length = 0; pivots.clear(); }, // geometry/materials are shared: disposeFurnitureCache()
  };
}
