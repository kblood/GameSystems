// Procedural insides (extensions/gore/insides.js): fitted from the rest joints, so they follow body shape; solid parts
// face outward, cavity linings face inward (seen from inside a wound); visibility rules per lost region. Pure, no assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInsides, visibleInsides, STUB_SEAMS, COLORS } from '../../extensions/gore/insides.js';
import { REGION } from '../../extensions/gore/regions.js';

const bake = JSON.parse(readFileSync(new URL('../../extensions/gore/data/makehuman_cc.gibs.json', import.meta.url), 'utf8'));
const scaled = (heads, sx, sy) => Object.fromEntries(Object.entries(heads).map(([k, p]) => [k, [p[0] * sx, p[1] * sy, p[2]]]));
const build = (heads, extra = {}) => buildInsides(heads, { body: bake.body, capAxis: bake.capAxis, baseHeads: bake.heads, ...extra });
/** Signed volume (> 0: closed surface facing outward) and the share of triangles whose winding agrees with the normals. */
function shape(p) {
  const P = p.positions, N = p.normals, I = p.indices;
  let vol = 0, agree = 0, n = 0;
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, c] = [I[i] * 3, I[i + 1] * 3, I[i + 2] * 3];
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(...g) < 1e-14) continue;
    n++; if (g[0] * (N[a] + N[b] + N[c]) + g[1] * (N[a + 1] + N[b + 1] + N[c + 1]) + g[2] * (N[a + 2] + N[b + 2] + N[c + 2]) > 0) agree++;
  }
  return { vol, agree: agree / n };
}

test('a full build: chest and belly cavities, the head, a bone stub per limb seam', () => {
  const parts = build(bake.heads), keys = new Set(parts.map(p => p.key));
  for (const k of ['cavity:chest', 'cavity:pelvis', 'cavity:head', 'spill:chest', ...STUB_SEAMS.map(s => `stub:${s}`)]) assert.ok(keys.has(k), k);
  for (const s of STUB_SEAMS) assert.equal(REGION[s].kind, 'limb', s);
  const tris = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  assert.ok(tris > 2000 && tris < 12000, `${tris} triangles (Quest budget)`);
  for (const p of parts) {
    assert.equal(p.positions.length, p.normals.length); assert.equal(p.positions.length, p.colors.length);
    assert.ok(p.positions.every(Number.isFinite) && p.normals.every(Number.isFinite), p.key);
    assert.ok(Math.max(...p.indices) < p.positions.length / 3, p.key);
    assert.ok(['bones', 'organs', 'flesh'].includes(p.layer) && typeof p.joint === 'string', p.key);
  }
  assert.deepEqual(build(bake.heads).map(p => p.indices.length), parts.map(p => p.indices.length), 'deterministic');
});

test('solids face outward, cavity linings face inward', () => {
  for (const p of build(bake.heads)) {
    const { vol, agree } = shape(p);
    assert.ok(agree > 0.85, `${p.key}/${p.layer}: ${(agree * 100).toFixed(0)} % of triangles wound like their normals`);
    if (p.key.startsWith('cavity:') && p.layer === 'flesh') assert.ok(vol < 0, `${p.key} lining faces inward`);
    if (p.layer === 'organs') assert.ok(vol > 0, `${p.key} organs face outward`);
  }
});

test('the insides follow the body: wider and taller joints give a wider and taller ribcage', () => {
  const size = parts => {
    const p = parts.find(q => q.key === 'cavity:chest' && q.layer === 'bones').positions, lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (const k of [0, 1]) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
    return [hi[0] - lo[0], hi[1] - lo[1]];
  };
  const base = size(build(bake.heads)), wide = size(build(scaled(bake.heads, 1.25, 1))), tall = size(build(scaled(bake.heads, 1, 1.15)));
  assert.ok(wide[0] > base[0] * 1.15, `width ${base[0]} -> ${wide[0]}`);
  assert.ok(tall[1] > base[1] * 1.08, `height ${base[1]} -> ${tall[1]}`);
});

test('layers can be switched off', () => {
  const none = build(bake.heads, { layers: { bones: false, organs: false, flesh: false } });
  assert.equal(none.length, 0);
  const bones = build(bake.heads, { layers: { bones: true, organs: false, flesh: false } });
  assert.ok(bones.length && bones.every(p => p.layer === 'bones'));
  assert.ok(Object.values(COLORS).every(c => c.length === 3));
});

test('visibility: stumps while the parent is there, cavities behind open patches, guts spill when the chest goes', () => {
  const lost = set => visibleInsides(id => set.includes(id));
  assert.deepEqual([...lost([])].sort(), []);
  const arm = lost(['leftUpperArm', 'leftLowerArm', 'leftHand']);
  assert.ok(arm.has('stub:leftUpperArm')); assert.ok(!arm.has('stub:leftLowerArm') && !arm.has('stub:leftHand'));
  assert.ok(lost(['chestLeft']).has('cavity:chest')); assert.ok(lost(['belly']).has('cavity:pelvis')); assert.ok(lost(['cranium']).has('cavity:head'));
  const torso = lost(['chest', 'neck', 'head', 'jaw', 'cranium', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'chestLeft', 'chestRight']);
  assert.ok(torso.has('stub:chest') && torso.has('spill:chest')); assert.ok(!torso.has('cavity:chest'));
});
