// The offline gib bake (extensions/gore/tools/bake_gibs.mjs) on the synced CharacterCreator assets: the committed data
// is what the tool produces (deterministic), no triangle area is lost or doubled by the split, every stump is closed on
// both sides (only the mesh's own open edges stay open), and the caps keep up with the slider morphs. Skipped without
// the assets (npm run sync).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bakeAssets, loadAssetMeshes } from '../../extensions/gore/tools/bake_gibs.mjs';
import { decodeGibs, extendAttribute, NONE } from '../../extensions/gore/bake_format.js';
import { assembleMesh } from '../../extensions/gore/assemble.js';
import { REGIONS, REGION, subtree } from '../../extensions/gore/regions.js';
import { ASSETS, hasAssets } from './gore-fixture.js';

const DATA = fileURLToPath(new URL('../../extensions/gore/data/', import.meta.url));
const skip = !hasAssets() && 'CharacterCreator assets not synced';
let baked = null;
const bake = () => (baked ??= bakeAssets(ASSETS));
const committed = () => decodeGibs(JSON.parse(readFileSync(`${DATA}makehuman_cc.gibs.json`, 'utf8')), readFileSync(`${DATA}makehuman_cc.gibs.bin`));
const meshesByName = () => new Map(loadAssetMeshes(ASSETS).meshes.map(m => [m.name, m]));
const area = (P, a, b, c) => {
  const u = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], v = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};
/** Edges used by exactly one triangle (undirected), as "a,b" with a < b; and directed edges used twice (bad winding). */
function edges(index) {
  const count = new Map(), dir = new Set(); let twice = 0;
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = index[t + k], b = index[t + (k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
    if (dir.has(`${a}>${b}`)) twice++; else dir.add(`${a}>${b}`);
  }
  return { open: new Set([...count].filter(([, n]) => n === 1).map(([k]) => k)), twice };
}
const slice = (asm, ranges) => { const out = []; for (const [s, c] of ranges) for (let i = 3 * s; i < 3 * (s + c); i++) out.push(asm.index[i]); return out; };
const variantsOf = mesh => [...new Set(mesh.pieces.filter(p => p.seam).map(p => p.variant))];

test('the bake is deterministic and the committed data is up to date (node extensions/gore/tools/bake_gibs.mjs)', { skip }, () => {
  const a = bake(), b = bakeAssets(ASSETS);
  assert.equal(a.text, b.text); assert.deepEqual(Buffer.from(a.bin), Buffer.from(b.bin));
  assert.equal(readFileSync(`${DATA}makehuman_cc.gibs.json`, 'utf8'), a.text, 'stale gibs.json: re-run the bake tool');
  assert.ok(Buffer.from(a.bin).equals(readFileSync(`${DATA}makehuman_cc.gibs.bin`)), 'stale gibs.bin: re-run the bake tool');
  assert.ok(a.json.meshes.length >= 13 && a.json.meshes.some(m => m.name === 'base'));
});

test('the body splits without conflicts and with closed seam loops', { skip }, () => {
  const body = committed().meshes.find(m => m.name === 'base');
  assert.equal(body.stats.conflicts, 0);
  const open = body.stats.loops.filter(l => l.seam !== 'jaw').flatMap(l => l.loops.filter(x => !x.closed).map(() => l.seam));
  assert.deepEqual(open, [], 'only the jaw (cut through the open mouth) may leave loop fragments');
  for (const r of REGIONS.filter(r => r.parent)) assert.ok(body.caps.some(c => c.seam === r.id), `caps for ${r.id}`);
});

test('triangle conservation: the pieces of every source triangle cover exactly its area (every mesh, every variant)', { skip }, () => {
  const src = meshesByName();
  for (const m of committed().meshes) {
    const P = extendAttribute(m, Float32Array.from(src.get(m.name).attributes.POSITION), 3, { offsets: true });
    const orig = m.index;
    for (const variant of variantsOf(m).length ? variantsOf(m) : [null]) {
      const sum = new Float64Array(orig.length / 3);
      const asm = assembleMesh(m, { variantOf: () => variant });
      // region ranges only (caps are new surface); map each assembled triangle back to its source via the pieces
      const seen = new Set();
      for (const p of m.pieces) {
        if (p.role === 'bodyCap' || p.role === 'gibCap' || (p.seam && p.variant !== asm.variant[p.seam])) continue;
        for (let t = p.start; t < p.start + p.count; t++) {
          const s = m.src[t]; assert.notEqual(s, NONE); assert.notEqual(s, 0xffff);
          sum[s] += area(P, m.tris[3 * t], m.tris[3 * t + 1], m.tris[3 * t + 2]); seen.add(s);
        }
      }
      let worst = 0, missing = 0;
      for (let s = 0; s < sum.length; s++) {
        const a = area(P, orig[3 * s], orig[3 * s + 1], orig[3 * s + 2]);
        if (a < 1e-12) continue;
        if (!seen.has(s)) missing++;
        worst = Math.max(worst, Math.abs(sum[s] - a) / a);
      }
      assert.equal(missing, 0, `${m.name}/${variant}: source triangles without a piece`);
      assert.ok(worst < 1e-3, `${m.name}/${variant}: area off by ${(worst * 100).toFixed(3)} %`);
      const total = Object.values(asm.region).reduce((s, [, c]) => s + c, 0);
      assert.ok(total >= orig.length / 3, `${m.name}: ${total} pieces for ${orig.length / 3} source triangles`);
    }
  }
});

/** Caps have their own vertices (own normals and cap uv) on the same recipes as the cut: weld by position to compare. */
function welder(E) {
  const ids = new Map(), out = new Int32Array(E.length / 3);
  for (let i = 0; i < out.length; i++) {
    const key = `${Math.round(E[3 * i] * 1e5)},${Math.round(E[3 * i + 1] * 1e5)},${Math.round(E[3 * i + 2] * 1e5)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    out[i] = ids.get(key);
  }
  return index => index.map(i => out[i]);
}
const bodyData = () => {
  const src = meshesByName(), glb = src.get('base'), body = committed().meshes.find(m => m.name === 'base');
  return { glb, body, E: extendAttribute(body, Float32Array.from(glb.attributes.POSITION), 3, { offsets: true }) };
};

test('caps close every stump: limb seams are watertight on the body and the gib side, patch gibs are closed', { skip }, () => {
  const { body, E } = bodyData(), weld = welder(E);
  let checked = 0;
  for (const variant of variantsOf(body)) {
    const asm = assembleMesh(body, { variantOf: () => variant });
    const whole = edges(weld(slice(asm, Object.values(asm.region))));
    for (const r of REGIONS.filter(r => r.parent)) {
      const inside = new Set(subtree(r.id));
      const gib = edges(weld(slice(asm, [...subtree(r.id).map(id => asm.region[id]), asm.gibCap[r.id]].filter(Boolean))));
      const gibLeak = [...gib.open].filter(e => !whole.open.has(e)).length;
      if (r.id !== 'jaw') assert.equal(gibLeak, 0, `${variant}/${r.id}: gib side open along the cut`); // jaw: cut through the open mouth
      checked++;
      if (r.kind !== 'limb') continue; // a patch leaves a hole with a flesh rim on the body (the insides show through)
      const rest = Object.entries(asm.region).filter(([id]) => !inside.has(id)).map(([, rg]) => rg);
      const stump = edges(weld(slice(asm, [...rest, asm.bodyCap[r.id]])));
      const leak = [...stump.open].filter(e => !whole.open.has(e)).length;
      assert.equal(leak, 0, `${variant}/${r.id}: body side open along the cut`);
      checked++;
    }
  }
  assert.ok(checked >= 2 * 30, `${checked} sides checked`);
});

test('caps follow the slider morphs: no gap at the seam and the cap stays inside its loop at several body shapes', { skip }, () => {
  const { glb, body, E: E0 } = bodyData(), T = name => glb.targetNames.indexOf(name);
  const shapes = { heavy: { weight_max: 1, muscle_max: 0.6 }, thin: { weight_min: 1, height_tall: 1 }, woman: { gender_female: 1, breast_cup_max: 0.8, age_old: 0.5 }, child: { age_child: 0.8, proportions_uncommon: 1 } };
  const asm = assembleMesh(body, { variantOf: () => 'jagged' });
  // each cap's rim vertex has a twin on the cut (same position at rest); the twins must stay together under every morph
  const weld = welder(E0), pieceVerts = new Map();
  for (const i of slice(asm, Object.values(asm.region))) pieceVerts.set(weld([i])[0], i);
  const caps = [];
  for (const [table, side] of [[asm.bodyCap, 'body'], [asm.gibCap, 'gib']]) for (const [seam, rg] of Object.entries(table)) {
    if (seam === 'jaw') continue;
    const all = [...new Set(slice(asm, [rg]))], twins = all.map(i => [i, pieceVerts.get(weld([i])[0])]).filter(([, j]) => j !== undefined && j !== null);
    assert.ok(twins.length >= 3, `${seam}/${side}: the cap rim lies on the cut`);
    caps.push({ key: `${seam}/${side}`, all, twins });
  }
  assert.ok(caps.length >= 30);
  for (const [name, w] of Object.entries(shapes)) {
    const P = Float32Array.from(glb.attributes.POSITION);
    for (const [t, x] of Object.entries(w)) { assert.ok(T(t) >= 0, t); const d = glb.targets[T(t)].POSITION; for (let i = 0; i < P.length; i++) P[i] += x * d[i]; }
    const E = extendAttribute(body, P, 3, { offsets: true });
    const d = (i, j) => Math.hypot(E[3 * i] - E[3 * j], E[3 * i + 1] - E[3 * j + 1], E[3 * i + 2] - E[3 * j + 2]);
    let moved = 0, worstGap = 0;
    for (const { key, all, twins } of caps) {
      const gap = Math.max(...twins.map(([i, j]) => d(i, j)));
      worstGap = Math.max(worstGap, gap);
      const ring = twins.map(([i]) => i), c = [0, 0, 0];
      for (const i of ring) for (let k = 0; k < 3; k++) c[k] += E[3 * i + k] / ring.length;
      const R = Math.max(...ring.map(i => Math.hypot(E[3 * i] - c[0], E[3 * i + 1] - c[1], E[3 * i + 2] - c[2])));
      const far = Math.max(...all.map(i => Math.hypot(E[3 * i] - c[0], E[3 * i + 1] - c[1], E[3 * i + 2] - c[2])));
      assert.ok(far <= R * 1.25 + 1e-4, `${name} ${key}: cap reaches ${far.toFixed(4)} m from a ${R.toFixed(4)} m loop`);
      moved = Math.max(moved, ...ring.map(i => Math.hypot(E[3 * i] - E0[3 * i], E[3 * i + 1] - E0[3 * i + 1], E[3 * i + 2] - E0[3 * i + 2])));
    }
    console.log(`# ${name}: worst cap gap ${(worstGap * 1000).toFixed(4)} mm, rim moved up to ${(moved * 1000).toFixed(1)} mm`);
    assert.ok(worstGap < 1e-4, `${name}: ${(worstGap * 1000).toFixed(3)} mm gap between a cap and its cut`);
    assert.ok(moved > 0.005, `${name}: the morph moves the caps (${moved.toFixed(4)} m)`);
  }
});
