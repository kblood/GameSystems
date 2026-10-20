// GameSystems gore extension: the runtime (three.js passed in, never imported). A gore world holds the shared materials,
// effects and gibs; characters that implement the humanoid character contract are attached to it as zombies.
//
//   const world = createGoreWorld({ THREE, scene, physics, gibs, config, floorY, walls })
//   const zombie = world.attach(character, { config, uncover }) // once the character is complete (CharacterCreator: after .ready);
//                                                              // uncover: show the skin CharacterCreator hides under clothes (torn clothing)
//   world.shoot(origin, direction, { damage }) -> { zombie, region, point, normal, events } | null
//   world.update(dt)                                          // after the characters were posed this frame
//
// Attaching swaps each baked mesh's geometry for the pre-split one (bake_format.js, assemble.js): same vertices plus the
// baked seam and cap vertices, the regions in depth-first order and the caps at the end, skin weights and (optionally)
// morph targets carried over by the bake's recipes. Severing then only changes draw ranges (geometry groups), shows the
// stump cap and spawns the pre-made gib: a SkinnedMesh on the same vertex buffers, bound to a frozen copy of the
// skeleton under a physics body. No triangle is created or cut at runtime.
// Meshes without a matching bake (another topology) still work: their regions collapse by bone scale (no caps).
import { REGIONS, REGION, REGION_IDS, boneRegions } from './regions.js';
import { createDamageModel } from './damage.js';
import { resolveGoreConfig, effectiveConfig } from './config.js';
import { decodeGibs, extendAttribute, extendSkin, extendNearest, positionHash } from './bake_format.js';
import { assembleMesh, bodyRanges, gibRanges } from './assemble.js';
import { buildInsides, visibleInsides } from './insides.js';
import { createCapMaterial, createInsidesMaterial } from './materials.js';
import { createGoreEffects } from './effects.js';
import { PARENT } from '../humanoid/index.js';

const FLESH_DENSITY = 1050; // kg/m³
/** Joint whose bone carries the body side of a seam (stump cap, bleeding) and the one the gib side moves with. */
function seamJoints(id) {
  const r = REGION[id];
  if (r.kind === 'patch') return [r.proxy[0], r.proxy[0]];
  const j = r.joints[0];
  return [PARENT[j] ?? 'hips', j];
}

/** Float copy of a (possibly interleaved / normalized) BufferAttribute. */
function floats(attr) {
  if (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array) return attr.array;
  const n = attr.itemSize, out = new Float32Array(attr.count * n), get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = attr[get[c]](i);
  return out;
}
function raw(attr) {
  if (!attr.isInterleavedBufferAttribute) return attr.array;
  const out = new attr.array.constructor(attr.count * attr.itemSize), get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr[get[c]](i);
  return out;
}

export function createGoreWorld({ THREE, scene, physics = null, gibs = null, config = {}, floorY = 0, walls = [], debris = {}, effects: effectsOption = null }) {
  if (!THREE || !scene) throw new TypeError('createGoreWorld needs { THREE, scene }');
  const bake = gibs?.format ? gibs : gibs?.json ? decodeGibs(gibs.json, gibs.bin) : null;
  let globalLayer = config, globalCfg = effectiveConfig(resolveGoreConfig(globalLayer));
  const capMaterial = createCapMaterial(THREE, { blood: globalCfg.blood.color });
  const insidesMaterial = createInsidesMaterial(THREE);
  const effects = effectsOption ?? createGoreEffects(THREE, scene, { config: globalCfg, floorY, walls });
  const zombies = new Set(), gibList = [], listeners = new Set();
  let frame = 0, lastSeverMs = 0;
  const severTimes = [];
  const tmp = { v: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion() };
  const emit = e => { for (const cb of [...listeners]) cb(e); };

  // ---------------------------------------------------------------- attach
  function attach(character, { config: over = null, uncover = false } = {}) {
    if (!character?.humanoid?.bones) throw new TypeError('gore: the character must implement the humanoid contract (humanoid.bones)');
    let layer = over;
    let cfg = effectiveConfig(resolveGoreConfig(globalLayer, layer));
    const hum = character.humanoid, bones = hum.bones;
    const skinned = (character.meshes ?? []).filter(m => m?.isSkinnedMesh);
    if (!skinned.length) throw new TypeError('gore: the character has no skinned meshes');
    const body = character.body ?? skinned.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
    const skeleton = body.skeleton;
    const boneIndex = new Map(skeleton.bones.map((b, i) => [b, i]));
    const jointOfBone = new Map(Object.entries(bones).map(([j, b]) => [b, j]));
    const parentIndex = i => boneIndex.get(skeleton.bones[i].parent) ?? -1;
    const boneRegion = boneRegions(skeleton.bones.map(b => b.name), name => {
      const b = skeleton.bones.find(x => x.name === name); return jointOfBone.get(b) ?? null;
    }, parentIndex);
    const heads = character.restHeads();
    const bindLocal = (joint, p) => {
      // rest point (character frame = the mesh's bind frame) -> the bone's local frame, pose independent
      const bi = boneIndex.get(bones[joint]);
      return new THREE.Vector3(...p).applyMatrix4(body.bindMatrix).applyMatrix4(skeleton.boneInverses[bi]);
    };
    const units = [], unbaked = [];
    const severed = new Set(), lost = new Set(), frozen = new Map();
    const t0 = performance.now();
    for (const mesh of skinned) {
      const pos = mesh.geometry.attributes.position, P = floats(pos);
      const bm = bake?.meshes.find(b => b.source.vertexCount === pos.count && b.source.positionHash === positionHash(P));
      if (bm) units.push(buildUnit(mesh, bm, cfg)); else unbaked.push(mesh);
    }
    const bodyUnit = units.find(u => u.bm.caps.length) ?? null;
    const attachMs = performance.now() - t0;
    // the damage model reads the live config (setConfig changes health, thresholds and the gore level in place)
    const model = createDamageModel({ get regions() { return cfg.regions; }, get sever() { return cfg.sever; }, get totalHealth() { return cfg.totalHealth; }, get mobility() { return cfg.mobility; } });
    const zombieGibs = [];
    let disposed = false;

    function buildUnit(mesh, bm, cfg) {
      const g0 = mesh.geometry, V = bm.source.vertexCount, N = bm.newVertexCount;
      const geo = new THREE.BufferGeometry();
      const freeze = cfg.performance.freezeMorphs;
      const morphP = g0.morphAttributes.position ?? [], morphN = g0.morphAttributes.normal ?? [];
      const inf = mesh.morphTargetInfluences ?? [], rel = g0.morphTargetsRelative;
      const applyMorphs = (base, targets) => {
        if (!freeze || !targets.length) return base;
        const out = Float32Array.from(base);
        targets.forEach((t, k) => {
          const w = inf[k];
          if (!w) return;
          const d = floats(t);
          if (rel) for (let i = 0; i < out.length; i++) out[i] += w * d[i];
          else for (let i = 0; i < out.length; i++) out[i] += w * (d[i] - base[i]);
        });
        return out;
      };
      const capOf = bm.cap;
      for (const [name, attr] of Object.entries(g0.attributes)) {
        if (name === 'skinIndex' || name === 'skinWeight') continue;
        const n = attr.itemSize;
        let out;
        if (name === 'position') out = extendAttribute(bm, applyMorphs(floats(attr), morphP), 3, { offsets: true });
        else if (name === 'normal') {
          out = extendAttribute(bm, applyMorphs(floats(attr), morphN), 3);
          for (let k = 0; k < N; k++) {
            const o = 3 * (V + k);
            if (capOf[k] >= 0) out.set(bm.caps[capOf[k]].normal, o);
            const l = Math.hypot(out[o], out[o + 1], out[o + 2]) || 1;
            out[o] /= l; out[o + 1] /= l; out[o + 2] /= l;
          }
        } else if (name.startsWith('_') || !(attr.array instanceof Float32Array) && !attr.normalized) out = extendNearest(bm, raw(attr), n);
        else {
          out = extendAttribute(bm, floats(attr), n);
          if (name === 'uv') for (let k = 0; k < N; k++) if (capOf[k] >= 0) { out[2 * (V + k)] = bm.uv[2 * k]; out[2 * (V + k) + 1] = bm.uv[2 * k + 1]; }
        }
        geo.setAttribute(name, new THREE.BufferAttribute(out, n, name.startsWith('_') ? false : attr.normalized && !(out instanceof Float32Array)));
      }
      if (!g0.attributes.uv && bm.caps.length) {
        const uv = new Float32Array((V + N) * 2);
        for (let k = 0; k < N; k++) if (capOf[k] >= 0) uv.set([bm.uv[2 * k], bm.uv[2 * k + 1]], 2 * (V + k));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const skin = extendSkin(bm, raw(g0.attributes.skinIndex), floats(g0.attributes.skinWeight));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.joints, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(skin.weights, 4));
      if (!freeze && morphP.length) {
        geo.morphTargetsRelative = rel;
        geo.morphAttributes.position = morphP.map(t => { const a = new THREE.BufferAttribute(extendAttribute(bm, floats(t), 3), 3); a.name = t.name; return a; });
        if (morphN.length) geo.morphAttributes.normal = morphN.map(t => {
          const d = extendAttribute(bm, floats(t), 3);
          for (let k = 0; k < N; k++) if (capOf[k] >= 0) d.fill(0, 3 * (V + k), 3 * (V + k) + 3);
          const a = new THREE.BufferAttribute(d, 3); a.name = t.name; return a;
        });
      }
      // triangles the character currently shows (CharacterCreator hides skin under clothes): match by corner triple.
      // uncover: the body shows all of its skin again (torn clothing would otherwise show holes into the insides)
      const cur = g0.index?.array, full = bm.index;
      let keep = () => true;
      if (cur && cur.length !== full.length && !(uncover && mesh === body)) {
        const shown = new Set();
        for (let i = 0; i < cur.length; i += 3) shown.add((cur[i] * V + cur[i + 1]) * V + cur[i + 2]);
        keep = t => shown.has((full[3 * t] * V + full[3 * t + 1]) * V + full[3 * t + 2]);
      }
      const asm = assembleMesh(bm, { variantOf: s => cfg.regions[s]?.variant, keep });
      geo.setIndex(new THREE.BufferAttribute(V + N > 65535 ? asm.index : Uint16Array.from(asm.index), 1));
      // material array: [the mesh's own, the cap material]; groups pick one (a garment only uses index 0)
      const material0 = mesh.material, material = [].concat(material0)[0];
      const unit = { mesh, bm, asm, geo, g0, material0, materials: bm.caps.length ? [material, capMaterial] : [material], morph0: { inf: mesh.morphTargetInfluences, dict: mesh.morphTargetDictionary }, freeze, positionCache: null, stamp: null };
      mesh.geometry = geo;
      mesh.material = unit.materials;
      if (freeze) { mesh.morphTargetInfluences = undefined; mesh.morphTargetDictionary = undefined; }
      geo.boundingSphere = g0.boundingSphere?.clone() ?? null;
      setGroups(unit);
      g0.dispose(); // frees the original GPU buffers (and its morph texture); restored on detach
      return unit;
    }
    function setGroups(unit) {
      unit.geo.clearGroups();
      for (const g of bodyRanges(unit.asm, lost, severed)) if (g.materialIndex < unit.materials.length) unit.geo.addGroup(g.start, g.count, g.materialIndex);
      unit.mesh.visible = unit.geo.groups.length > 0;
    }

    // ---- insides: per (key, joint) one vertex-coloured mesh on the bone, hidden until opened
    const insideMeshes = [], stubGeos = {};
    function buildInsideMeshes() {
      for (const m of insideMeshes) { m.removeFromParent(); m.geometry.dispose(); }
      insideMeshes.length = 0;
      if (!bodyUnit) return;
      const parts = buildInsides(heads, { body: bake.body, capAxis: bake.capAxis, variant: s => bodyUnit.asm.variant[s], layers: cfg.insides, baseHeads: bake.heads });
      const groups = new Map();
      for (const p of parts) { const k = `${p.key}|${p.joint}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      for (const [k, list] of groups) {
        const [key, joint] = k.split('|');
        if (!bones[joint]) continue;
        const geo = mergeParts(list, joint);
        const mesh = new THREE.Mesh(geo, insidesMaterial);
        mesh.name = `gore-insides:${key}`; mesh.visible = false; mesh.userData.goreKey = key; mesh.frustumCulled = false;
        bones[joint].add(mesh); insideMeshes.push(mesh);
        const stub = list.find(p => p.gibJoint);
        if (stub && bones[stub.gibJoint]) stubGeos[key.slice(5)] = { joint: stub.gibJoint, geo: mergeParts(list, stub.gibJoint) };
      }
    }
    function mergeParts(list, joint) {
      const bi = boneIndex.get(bones[joint]);
      const M = new THREE.Matrix4().multiplyMatrices(skeleton.boneInverses[bi], body.bindMatrix), Nm = new THREE.Matrix3().getNormalMatrix(M);
      let nv = 0, ni = 0;
      for (const p of list) { nv += p.positions.length / 3; ni += p.indices.length; }
      const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
      let ov = 0, oi = 0;
      const v = new THREE.Vector3();
      for (const p of list) {
        const n = p.positions.length / 3;
        for (let i = 0; i < n; i++) {
          v.fromArray(p.positions, 3 * i).applyMatrix4(M).toArray(P, 3 * (ov + i));
          v.fromArray(p.normals, 3 * i).applyMatrix3(Nm).normalize().toArray(Nn, 3 * (ov + i));
        }
        C.set(p.colors, 3 * ov);
        for (let i = 0; i < p.indices.length; i++) I[oi + i] = p.indices[i] + ov;
        ov += n; oi += p.indices.length;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? I : Uint16Array.from(I), 1));
      return geo;
    }
    buildInsideMeshes();
    function refreshInsides() {
      const keys = visibleInsides(id => lost.has(id));
      for (const m of insideMeshes) m.visible = keys.has(m.userData.goreKey);
    }

    // ---- proxies (world space, current pose)
    const proxyCache = {};
    function proxy(id) {
      const pr = bake?.proxies?.[id] ?? fallbackProxy(id);
      if (!pr) return null;
      if (pr.kind === 'sphere') {
        const local = (proxyCache[id] ??= bindLocal(pr.joint, heads[pr.joint].map((x, k) => x + pr.offset[k])));
        bones[pr.joint].updateWorldMatrix(true, false);
        return { kind: 'sphere', c: local.clone().applyMatrix4(bones[pr.joint].matrixWorld), r: pr.radius };
      }
      const P = j => { bones[j].updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(bones[j].matrixWorld); };
      if (!bones[pr.from] || !bones[pr.to]) return null;
      const A0 = P(pr.from);
      let B0 = P(pr.to);
      if (pr.plus) {
        const baseJ = pr.from === pr.to ? (PARENT[pr.from] ?? pr.from) : pr.from;
        const base = P(baseJ);
        B0 = B0.clone().addScaledVector(B0.clone().sub(base), pr.ext);
      }
      const L = B0.distanceTo(A0) || 1e-3;
      const A = A0.clone().lerp(B0, pr.a), B = A0.clone().lerp(B0, pr.b);
      return { kind: 'capsule', a: A, b: B, r: Math.max(0.02, pr.radius * L) };
    }
    function fallbackProxy(id) {
      const r = REGION[id];
      if (r.proxy.length === 1) return { kind: 'sphere', joint: r.proxy[0], offset: [0, 0.05, 0.05], radius: 0.06 };
      const to = r.proxy[1].replace('+', '');
      return { kind: 'capsule', from: r.proxy[0], to, plus: r.proxy[1].endsWith('+'), ext: 0.6, a: 0, b: 1, radius: 0.25 };
    }

    // ---- hit test
    function rayProxies(o, d, far) {
      const hits = [];
      for (const id of REGION_IDS) {
        if (lost.has(id)) continue;
        const p = proxy(id);
        if (!p) continue;
        const pad = 0.03;
        if (p.kind === 'sphere') {
          const oc = tmp.v.copy(o).sub(p.c), b = oc.dot(d), c = oc.lengthSq() - (p.r + pad) ** 2, disc = b * b - c;
          if (disc < 0) continue;
          const t = -b - Math.sqrt(disc);
          if (t > 0 && t < far) hits.push({ id, t, p });
        } else {
          const t = raySegment(o, d, p.a, p.b, p.r + pad);
          if (t !== null && t < far) hits.push({ id, t, p });
        }
      }
      return hits.sort((x, y) => x.t - y.t);
    }
    function skinnedPosition(unit, i, out) {
      const n = unit.geo.attributes.position.count;
      if (!unit.positionCache || unit.positionCache.length !== 3 * n) { unit.positionCache = new Float32Array(3 * n); unit.stamp = new Int32Array(n).fill(-1); }
      if (unit.stamp[i] !== frame) {
        unit.mesh.getVertexPosition(i, out).applyMatrix4(unit.mesh.matrixWorld);
        out.toArray(unit.positionCache, 3 * i); unit.stamp[i] = frame;
      } else out.fromArray(unit.positionCache, 3 * i);
      return out;
    }
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    function rayMesh(o, d, far, regions) {
      let best = null;
      for (const unit of units) {
        if (!unit.mesh.visible) continue;
        unit.mesh.updateWorldMatrix(true, false);
        const idx = unit.geo.index.array;
        for (const id of regions) {
          const [start, count] = unit.asm.region[id];
          for (let t = start; t < start + count; t++) {
            skinnedPosition(unit, idx[3 * t], A); skinnedPosition(unit, idx[3 * t + 1], B); skinnedPosition(unit, idx[3 * t + 2], C);
            const h = rayTriangle(o, d, A, B, C);
            if (h && h.t < far && (!best || h.t < best.t)) best = { ...h, unit, triangle: t, region: id, a: A.clone(), b: B.clone(), c: C.clone() };
          }
        }
      }
      return best;
    }
    /** Closest hit of a world ray on this zombie: { region, point, normal, distance, bone } or null. */
    function raycast(origin, direction, far = 100) {
      if (disposed) return null;
      const o = origin, d = direction.clone().normalize();
      const candidates = rayProxies(o, d, far);
      if (!candidates.length) return null;
      if (cfg.performance.meshHitTest && units.length) {
        // test the triangles of every candidate region (and their neighbours: the proxies overlap at the seams)
        const set = new Set();
        for (const c of candidates.slice(0, 4)) { set.add(c.id); if (REGION[c.id].parent) set.add(REGION[c.id].parent); for (const k of REGIONS.filter(r => r.parent === c.id)) set.add(k.id); }
        const regs = [...set].filter(id => !lost.has(id));
        const h = rayMesh(o, d, far, regs);
        if (!h) return null;
        const point = o.clone().addScaledVector(d, h.t);
        const normal = new THREE.Vector3().subVectors(h.b, h.a).cross(new THREE.Vector3().subVectors(h.c, h.a)).normalize();
        if (normal.dot(d) > 0) normal.negate();
        // the piece's region (baked from the skin weights) decides; seams make it exact on both sides of a cut
        const region = h.unit.asm.regionOfTriangle(h.triangle) ?? h.region;
        return { region, point, normal, distance: h.t, bone: dominantBone(h.unit, h.triangle, h.u, h.v) };
      }
      const c = candidates[0], point = o.clone().addScaledVector(d, c.t);
      const normal = point.clone().sub(c.p.kind === 'sphere' ? c.p.c : closestOnSegment(point, c.p.a, c.p.b)).normalize();
      return { region: c.id, point, normal, distance: c.t, bone: bones[seamJoints(c.id)[1]] ?? bones.hips };
    }
    function dominantBone(unit, t, u, v) {
      const idx = unit.geo.index.array, si = unit.geo.attributes.skinIndex, sw = unit.geo.attributes.skinWeight;
      const acc = new Map(), bary = [1 - u - v, u, v];
      for (let c = 0; c < 3; c++) {
        const i = idx[3 * t + c];
        for (let k = 0; k < 4; k++) { const b = si.array[4 * i + k], w = sw.array[4 * i + k] * bary[c]; if (w > 0) acc.set(b, (acc.get(b) ?? 0) + w); }
      }
      let best = 0, bw = -1;
      for (const [b, w] of acc) if (w > bw) { bw = w; best = b; }
      return unit.mesh.skeleton.bones[best];
    }

    // ---- severing
    function capWorld(seam, side, out = new THREE.Vector3(), dir = null) {
      const cap = bodyUnit?.bm.caps.find(c => c.seam === seam && c.side === side && c.loop === 0 && c.variant === bodyUnit.asm.variant[seam]);
      const joint = seamJoints(seam)[side === 'body' ? 0 : 1];
      const bone = bones[joint] ?? bones.hips;
      bone.updateWorldMatrix(true, false);
      if (!cap) {
        const p = proxy(seam);
        out.copy(p?.kind === 'capsule' ? p.a : p?.c ?? bone.getWorldPosition(out));
        dir?.set(0, 1, 0);
        return out;
      }
      const key = `${seam}|${side}`;
      const local = (capLocal[key] ??= {
        p: bindLocal(joint, cap.centroid),
        n: bindLocal(joint, cap.centroid.map((x, k) => x + cap.normal[k] * 0.1)),
      });
      out.copy(local.p).applyMatrix4(bone.matrixWorld);
      if (dir) dir.copy(local.n).applyMatrix4(bone.matrixWorld).sub(out).normalize();
      return out;
    }
    const capLocal = {};
    function freezeBones(regions) {
      for (const id of regions) for (const j of REGION[id].joints) {
        const b = bones[j];
        if (!b || frozen.has(b) || !hum.restLocal?.[j]) continue;
        frozen.set(b, hum.restLocal[j]);
      }
      // bones below a lost region's joints (fingers, toes) stay in rest too
      for (const [b, i] of boneIndex) if (lostBoneRegion(i)) { const j = jointOfBone.get(b); if (j && hum.restLocal?.[j] && !frozen.has(b)) frozen.set(b, hum.restLocal[j]); }
    }
    const lostBoneRegion = i => lost.has(REGION_IDS[boneRegion[i]]);

    function sever(event, hit = null) {
      const t0 = performance.now();
      const seam = event.region, lostNow = event.lost;
      const severedBefore = new Set(severed);
      for (const id of lostNow) lost.add(id);
      severed.add(seam);
      for (const u of units) setGroups(u);
      for (const mesh of unbaked) collapse(mesh, seam);
      refreshInsides();
      freezeBones(lostNow);
      effects.clearWounds(api, lostNow);
      if (cfg.gibs.max > 0) spawnGib(seam, lostNow, severedBefore, hit);
      // blood: burst at the cut, chunks, a bleeding stump
      const at = new THREE.Vector3(), dir = new THREE.Vector3();
      capWorld(seam, 'body', at, dir);
      if (cfg.blood.amount > 0) {
        effects.spray(at, dir, { count: 40, speed: 2.6, spread: 0.6 });
        if (!lost.has(REGION[seam].parent)) effects.emitter(o => capWorld(seam, 'body', o), d => capWorld(seam, 'body', tmp.w, d), cfg.blood.spurtSeconds, 16);
      }
      if (cfg.goreLevel === 'high') effects.chunks(at, hit?.direction ?? dir, REGION[seam].kind === 'patch' ? 8 : 5);
      const ms = performance.now() - t0;
      lastSeverMs = ms; severTimes.push(ms);
      return ms;
    }
    function collapse(mesh, seam) {
      const b = bones[REGION[seam].joints[0] ?? REGION[seam].proxy[0]];
      if (b && REGION[seam].kind === 'limb') frozen.set(b, 'collapse');
    }

    function spawnGib(seam, lostNow, severedBefore, hit) {
      const p = proxy(seam);
      if (!p) return;
      character.root.updateMatrixWorld(true);
      const root = new THREE.Group(); root.name = `gore-gib:${seam}`;
      let shapes, length = 0.1, radius = 0.05;
      if (p.kind === 'capsule') {
        const axis = tmp.v.subVectors(p.b, p.a);
        length = Math.max(0.02, axis.length()); radius = p.r;
        root.position.addVectors(p.a, p.b).multiplyScalar(0.5);
        root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
        shapes = [{ type: 'cylinder', radius, height: length, offset: [0, 0, 0] }, { type: 'sphere', radius, offset: [0, length / 2, 0] }, { type: 'sphere', radius, offset: [0, -length / 2, 0] }];
      } else {
        root.position.copy(p.c); radius = p.r; length = 0;
        shapes = [{ type: 'sphere', radius }];
      }
      // big pieces (the upper body) get the volume of every region that came off
      const vol = lostNow.reduce((s, id) => {
        const q = id === seam ? p : proxy(id);
        if (!q) return s;
        return s + (q.kind === 'sphere' ? (4 / 3) * Math.PI * q.r ** 3 : Math.PI * q.r ** 2 * q.a.distanceTo(q.b) + (4 / 3) * Math.PI * q.r ** 3);
      }, 0);
      const mass = Math.min(45, Math.max(0.15, FLESH_DENSITY * vol));
      scene.add(root); root.updateMatrixWorld(true);
      const inv = tmp.m.copy(root.matrixWorld).invert();
      const gibBones = skeleton.bones.map(b => {
        const nb = new THREE.Bone(); nb.name = b.name; nb.matrixAutoUpdate = false;
        b.updateWorldMatrix(true, false);
        nb.matrix.multiplyMatrices(inv, b.matrixWorld); root.add(nb);
        return nb;
      });
      const gs = new THREE.Skeleton(gibBones, skeleton.boneInverses.map(m => m.clone()));
      const meshes = [];
      for (const u of units) {
        const ranges = gibRanges(u.asm, seam, lostNow, severedBefore);
        if (!ranges.length) continue;
        const g = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(u.geo.attributes)) g.setAttribute(name, a);
        g.morphAttributes = u.geo.morphAttributes; g.morphTargetsRelative = u.geo.morphTargetsRelative;
        g.setIndex(u.geo.index);
        for (const r of ranges) if (r.materialIndex < u.materials.length) g.addGroup(r.start, r.count, r.materialIndex);
        if (!g.groups.length) continue;
        const m = new THREE.SkinnedMesh(g, u.materials);
        m.name = `${u.mesh.name}:gib`; m.frustumCulled = false; m.castShadow = u.mesh.castShadow;
        if (!u.freeze && u.morph0.inf) { m.morphTargetInfluences = u.morph0.inf.slice(); m.morphTargetDictionary = u.morph0.dict; }
        m.bind(gs, u.mesh.bindMatrix.clone());
        root.add(m); meshes.push(m);
      }
      for (const m of unbakedGibs(seam, root, radius, length)) meshes.push(m);
      // the bone stub sticking out of the gib's cap
      if (stubGeos[seam] && cfg.insides.bones) {
        const gb = gibBones[boneIndex.get(bones[stubGeos[seam].joint])];
        if (gb) { const s = new THREE.Mesh(stubGeos[seam].geo, insidesMaterial); s.frustumCulled = false; gb.add(s); }
      }
      // flung along the shot (lighter pieces faster) and a little up
      const kick = Math.min(4, 9 / Math.sqrt(mass));
      const velocity = (hit?.direction?.clone().normalize() ?? new THREE.Vector3()).multiplyScalar(kick).add(new THREE.Vector3(0, 1.2 + Math.random(), 0));
      const spin = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8];
      let handle = null;
      if (physics && cfg.gibs.physics) {
        handle = physics.addBody(shapes, mass, { position: root.position.toArray(), quaternion: root.quaternion.toArray() },
          { velocity: velocity.toArray(), spin, contacts: false, group: debris.group, mask: debris.mask, linearDamping: 0.05, angularDamping: 0.3, userData: { gore: 'gib', region: seam } });
      }
      const gib = { zombie: api, seam, root, meshes, handle, velocity, spin: new THREE.Vector3(...spin), age: 0, lifetime: cfg.gibs.lifetime, radius, mass, bleed: null };
      if (cfg.blood.amount > 0) gib.bleed = effects.emitter(o => o.copy(root.position), d => d.set(0, -1, 0).applyQuaternion(root.quaternion).negate(), cfg.blood.spurtSeconds * 0.6, 10);
      gibList.push(gib); zombieGibs.push(gib);
      const max = Math.min(...[...zombies].map(z => z.config.gibs.max), cfg.gibs.max);
      while (gibList.length > Math.max(0, max)) removeGib(gibList[0]);
    }
    function unbakedGibs(seam, root, radius, length) {
      if (!unbaked.length || REGION[seam].kind !== 'limb') return [];
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.8, Math.max(0.01, length), 4, 8), capMaterial);
      m.frustumCulled = false; root.add(m);
      return [m];
    }

    // ---- per frame
    function update() {
      if (disposed) return;
      for (const [b, q] of frozen) {
        if (q === 'collapse') { b.scale.setScalar(1e-4); continue; }
        b.quaternion.fromArray(q);
      }
      if (frozen.size) character.root.updateMatrixWorld(true);
    }

    function handleEvents(events, hit) {
      for (const e of events) {
        if (e.type === 'sever') e.ms = sever(e, hit);
        emit({ ...e, zombie: api });
      }
      return events;
    }

    const api = {
      character, model,
      get config() { return cfg; },
      get dead() { return model.dead; },
      get attachMs() { return attachMs; },
      get baked() { return units.length > 0; },
      lost: id => lost.has(id),
      lostRegions: () => [...lost],
      mobility: () => model.mobility(),
      speedFactor: () => model.speedFactor(),
      /** { leftArm, rightArm, leftLeg, rightLeg }: which limbs still work (for a crawl gait). */
      limbs: () => model.limbs(),
      /** The hurt leg while limping ('left' | 'right'), else null. */
      limpSide: () => model.limpSide(),
      raycast,
      /** World centre of a region's proxy (current pose), or null: an aim point for scripts and tests. */
      regionCenter(id) {
        const p = proxy(id);
        return !p ? null : p.kind === 'sphere' ? p.c.clone() : p.a.clone().lerp(p.b, 0.5);
      },
      /**
       * Damage from a shot: { region? (else from point/raycast), point, normal, direction, damage }. Spawns a wound and
       * blood, then severs / kills per the damage model. Returns the damage model's events (sever events carry `ms`).
       */
      hit({ region, point, normal, direction, damage = 25, bone = null }) {
        if (disposed || !region) return [];
        if (point && cfg.blood.amount > 0) {
          const out = (normal ?? new THREE.Vector3(0, 1, 0)).clone().multiplyScalar(0.7).addScaledVector(direction ?? new THREE.Vector3(), 0.5).normalize();
          effects.spray(point, out, { count: 18, speed: 1.8, spread: 0.5 });
          if (direction) effects.spray(point.clone().addScaledVector(direction, 0.15), direction, { count: 10, speed: 2.5, spread: 0.3 });
          if (bone && normal) effects.wound(bone, point, normal, api, region);
        }
        return handleEvents(model.hit(region, damage), { direction, point });
      },
      /** Takes a region off now (scripts, tests; force: also when not severable). */
      sever(id, { force = true, direction = null } = {}) { return handleEvents(model.sever(id, { force }), { direction }); },
      kill(why) { return handleEvents(model.kill(why), null); },
      /** Draw calls this zombie's meshes cost right now (groups per visible mesh; insides; its gibs). */
      drawCalls() {
        let n = 0;
        for (const u of units) if (u.mesh.visible) n += Math.max(1, u.geo.groups.length);
        for (const m of unbaked) if (m.visible) n += 1;
        n += insideMeshes.filter(m => m.visible).length;
        for (const g of zombieGibs) n += g.meshes.reduce((s, m) => s + Math.max(1, m.geometry.groups?.length ?? 1), 0);
        return n;
      },
      stats: () => ({ units: units.length, unbaked: unbaked.length, vertices: units.reduce((s, u) => s + u.geo.attributes.position.count, 0),
        triangles: units.reduce((s, u) => s + u.asm.triangles, 0), lost: [...lost], gibs: zombieGibs.length, attachMs }),
      /** Changes this zombie's config layer (blood, insides, gibs, regions' health...; variants and freezeMorphs apply on the next attach). */
      setConfig(next) { layer = next; api._refresh(); },
      _refresh() { cfg = effectiveConfig(resolveGoreConfig(globalLayer, layer)); buildInsideMeshes(); refreshInsides(); },
      /** Everything back on (gibs of this zombie removed). */
      reset() {
        model.reset(); lost.clear(); severed.clear();
        for (const [b, q] of frozen) if (q === 'collapse') b.scale.setScalar(1);
        frozen.clear();
        for (const u of units) setGroups(u);
        for (const g of [...zombieGibs]) removeGib(g);
        effects.clearWounds(api);
        refreshInsides();
      },
      update,
      /** Restores the character's original meshes and removes the zombie's gibs and insides. */
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const g of [...zombieGibs]) removeGib(g);
        for (const m of insideMeshes) { m.removeFromParent(); m.geometry.dispose(); }
        for (const s of Object.values(stubGeos)) s.geo.dispose();
        for (const [b, q] of frozen) if (q === 'collapse') b.scale.setScalar(1);
        for (const u of units) {
          u.mesh.geometry = u.g0; u.mesh.material = u.material0;
          if (u.freeze) { u.mesh.morphTargetInfluences = u.morph0.inf; u.mesh.morphTargetDictionary = u.morph0.dict; }
          u.geo.dispose();
        }
        effects.clearWounds(api);
        zombies.delete(api);
      },
      _units: units, _gibs: zombieGibs,
    };
    api._zombieGibs = zombieGibs;
    zombies.add(api);
    return api;
  }

  function removeGib(gib) {
    const i = gibList.indexOf(gib);
    if (i >= 0) gibList.splice(i, 1);
    const zi = gib.zombie._zombieGibs.indexOf(gib);
    if (zi >= 0) gib.zombie._zombieGibs.splice(zi, 1);
    if (gib.handle) physics.remove(gib.handle);
    if (gib.bleed) gib.bleed.alive = false;
    scene.remove(gib.root);
    gib.root.traverse(o => {
      if (!o.isMesh) return;
      // the gib geometry shares the zombie's vertex buffers: only release its own state
      if (o.isSkinnedMesh) { o.geometry.attributes = {}; o.geometry.index = null; o.geometry.morphAttributes = {}; o.geometry.dispose(); o.skeleton = null; }
      else if (o.geometry?.type === 'CapsuleGeometry') o.geometry.dispose();
    });
  }

  const pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  function update(dt) {
    frame++;
    for (const z of zombies) z.update(dt);
    for (const gib of [...gibList]) {
      gib.age += dt;
      if (gib.handle) {
        physics.pose(gib.handle, pose);
        gib.root.position.fromArray(pose.position); gib.root.quaternion.fromArray(pose.quaternion);
      } else {
        gib.velocity.y -= 9.81 * dt;
        gib.root.position.addScaledVector(gib.velocity, dt);
        const low = floorY + gib.radius * 0.8;
        if (gib.root.position.y < low) { gib.root.position.y = low; gib.velocity.multiplyScalar(0.4); gib.velocity.y = Math.abs(gib.velocity.y) * 0.2; gib.spin.multiplyScalar(0.5); }
        tmp.q.setFromEuler(new THREE.Euler(gib.spin.x * dt, gib.spin.y * dt, gib.spin.z * dt));
        gib.root.quaternion.multiply(tmp.q);
      }
      const left = gib.lifetime - gib.age;
      gib.root.scale.setScalar(left < 1 ? Math.max(0.001, left) : 1);
      gib.root.updateMatrixWorld(true);
      if (left <= 0) removeGib(gib);
    }
    effects.update(dt);
  }

  /** First zombie hit along a world ray: { zombie, region, point, normal, distance, bone } or null. */
  function raycast(origin, direction, far = 100) {
    let best = null;
    for (const z of zombies) { const h = z.raycast(origin, direction, far); if (h && (!best || h.distance < best.distance)) best = { ...h, zombie: z }; }
    return best;
  }

  return {
    THREE, effects, capMaterial, insidesMaterial,
    get bake() { return bake; },
    get config() { return globalCfg; },
    get zombies() { return [...zombies]; },
    get gibs() { return gibList.length; },
    attach, raycast, update,
    /** Raycast + hit: the shot's damage goes to the region hit. Returns { zombie, region, point, normal, events } or null. */
    shoot(origin, direction, { damage = 25, far = 100 } = {}) {
      const d = direction.clone().normalize(), h = raycast(origin, d, far);
      if (!h) return null;
      const events = h.zombie.hit({ region: h.region, point: h.point, normal: h.normal, direction: d, damage, bone: h.bone });
      return { ...h, events };
    },
    /** Global config layer (zombies keep their own layer on top); limits of the new gore level apply to new effects. */
    setConfig(next) {
      globalLayer = next; globalCfg = effectiveConfig(resolveGoreConfig(globalLayer));
      capMaterial.userData.gore.goreBlood.value.set(globalCfg.blood.color);
      effects.setConfig(globalCfg);
      for (const z of zombies) z._refresh();
      while (gibList.length > globalCfg.gibs.max) removeGib(gibList[0]);
    },
    on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    stats() {
      const zs = [...zombies];
      return { zombies: zs.length, gibs: gibList.length, drawCalls: zs.reduce((s, z) => s + z.drawCalls(), 0) + effects.stats().drawCalls,
        lastSeverMs, severMs: severTimes.length ? severTimes.reduce((a, b) => a + b, 0) / severTimes.length : 0, severs: severTimes.length, effects: effects.stats() };
    },
    dispose() {
      for (const z of [...zombies]) z.dispose();
      for (const g of [...gibList]) removeGib(g);
      if (!effectsOption) effects.dispose();
      capMaterial.dispose(); insidesMaterial.dispose(); listeners.clear();
    },
  };
}

// ---- geometry helpers (world space)
function raySegment(o, d, a, b, r) {
  // smallest t >= 0 where the ray comes within r of segment ab (sampled closest approach, good enough for a proxy)
  const ab = b.clone().sub(a), ao = o.clone().sub(a);
  const abab = ab.dot(ab), abd = ab.dot(d), abao = ab.dot(ao), dao = d.dot(ao);
  const den = abab - abd * abd;
  let s = den > 1e-9 ? (abab * -dao + abd * abao) / den : 0; // t on ray
  s = Math.max(0, s);
  let u = Math.max(0, Math.min(1, (abao + s * abd) / (abab || 1)));
  const p = o.clone().addScaledVector(d, s), q = a.clone().addScaledVector(ab, u);
  const dist = p.distanceTo(q);
  if (dist > r) return null;
  return Math.max(0, s - Math.sqrt(r * r - dist * dist));
}
function closestOnSegment(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return a.clone().addScaledVector(ab, t);
}
function rayTriangle(o, d, a, b, c) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-4 ? { t, u, v } : null;
}
export { rayTriangle, raySegment };
