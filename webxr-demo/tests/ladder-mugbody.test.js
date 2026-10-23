// Mug BODY grasp (procedural, in-range thumb) and the LADDER (rungs along X, per-pose grip axis): root cause, hit rates on hands of
// 0.9 / 1.0 / 1.1 scale, and that the default (no flag) results are bit-identical to before the additions.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../../extensions/grasp/index.js';
import { closureDigest } from './helpers/regression-digest.js';

// Golden digest of the closure of every baked pose (low / mid, reference hands), produced on the code BEFORE the axis addition.
const GOLDEN_CLOSURE = { n: 442, hash: '02665ac848ec5c899936c67a4dbe01e99ce17a43a67c5f84e020aafa02deefc9' };

beforeEach(() => g.setProceduralGrasps(true));
afterEach(() => g.setProceduralGrasps(false));
const hands = scale => Object.fromEntries(['left', 'right'].map(side => { const r = g.referenceHand(side); return [side, g.referenceHand(side, { scale: r.scale * scale })]; }));
function hitRate(rows, scale) {
  const h = hands(scale); let ok = 0;
  for (const p of rows) if (g.scoreGrasp(p, h[p.side]).ok) ok++;
  return { ok, n: rows.length };
}

test('default: every existing closure result is bit-identical (golden digest of all baked poses, low and mid with search)', () => {
  const d = closureDigest(g);
  assert.deepEqual(d, GOLDEN_CLOSURE);
});

test('aroundOf: no axis is exactly the old +Y-through-origin angle; an axis measures around that line', () => {
  const a = g.aroundOf(null);
  for (const p of [[1, 0, 0], [0.3, 5, -0.4], [-0.2, -1, 0.7]]) assert.equal(a(p), Math.atan2(p[2], p[0]));
  const rung = g.aroundOf({ origin: [0, 0.3, 0], dir: [1, 0, 0] });
  // points on a circle about the X axis through (0, 0.3, 0): the angle advances evenly, whatever the x coordinate
  const at = (deg, x) => [x, 0.3 + 0.05 * Math.cos(deg * Math.PI / 180), 0.05 * Math.sin(deg * Math.PI / 180)];
  const sep = (u, v) => { const d = Math.abs(rung(u) - rung(v)) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  assert.ok(Math.abs(sep(at(0, 0), at(180, 0.2)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(sep(at(10, -0.1), at(100, 0.1)) - Math.PI / 2) < 1e-9);
});

test('mug body, root cause: the baked thumb row has CMC pitch 100, outside the joint range (-35..65), so 0 % pass at every hand size', () => {
  const body = g.BAKED.poses.filter(p => p.kind === 'mug' && p.grasp === 'body');
  assert.equal(body.length, 4);
  for (const p of body) {
    assert.ok(p.angles[0][1] > g.HARD.Thumb.pitch[1], `${p.id} pitch ${p.angles[0][1]}`);
    assert.ok(g.scoreGrasp(p, g.referenceHand(p.side)).failures.some(f => /Thumb\.pitch/.test(f)), p.id);
  }
  const report = {};
  for (const scale of [0.9, 1, 1.1]) { const r = hitRate(body, scale); report[scale] = `${r.ok}/${r.n}`; assert.equal(r.ok, 0, `baked body @${scale}`); }
  console.log('mug body BAKED hit-rate', JSON.stringify(report));
});

test('mug body, fix: procedural poses keep the thumb inside the joint ranges and 100 % pass on hands of 0.9 / 1.0 / 1.1', () => {
  const rows = g.PROCEDURAL.filter(p => p.kind === 'mug' && p.grasp === 'body');
  assert.ok(rows.length >= 30);
  for (const p of rows) {
    assert.equal(p.source, 'procedural');
    assert.ok(p.angles[0][1] <= g.HARD.Thumb.pitch[1] && p.angles[0][1] >= g.HARD.Thumb.pitch[0], p.id);
    assert.ok(g.validateRows(Object.fromEntries(g.FINGERS.map((f, i) => [f, p.angles[i]]))).ok, p.id);
  }
  const report = {};
  for (const scale of [0.9, 1, 1.1]) { const r = hitRate(rows, scale); report[scale] = `${r.ok}/${r.n}`; assert.equal(r.ok, r.n, `procedural body @${scale}`); }
  console.log('mug body PROCEDURAL hit-rate', JSON.stringify(report));
  for (const side of ['left', 'right']) assert.equal(g.posesFor('mug', side).filter(p => p.grasp === 'body' && p.default).length, 1);
  g.setProceduralGrasps(false);
  assert.ok(!g.posesFor('mug', 'right').some(p => p.source === 'procedural'), 'default library: no procedural pose');
  assert.equal(g.posesFor('mug', 'right').filter(p => p.grasp === 'body').length, 2, 'default library: the 2 baked body rows per side as before');
});

test('mug body: graspPose closes procedural body poses on the hand at mid and high quality (finite, in the joint ranges)', () => {
  const was = g.graspQuality();
  try {
    for (const q of ['mid', 'high']) {
      g.setGraspQuality(q);
      for (const side of ['left', 'right']) for (const p of g.posesFor('mug', side).filter(x => x.grasp === 'body').slice(0, 6)) {
        const r = g.graspPose(p, g.referenceHand(side));
        assert.ok([...r.wrist, ...r.quat, ...r.angles.flat()].every(Number.isFinite), `${q} ${p.id}`);
        assert.ok(g.validateRows(Object.fromEntries(g.FINGERS.map((f, i) => [f, r.angles[i]]))).ok, `${q} ${p.id} rows`);
      }
    }
  } finally { g.setGraspQuality(was); }
});

// ---- ladder ---------------------------------------------------------------------------------------------------------------

test('ladder catalogue row: rails and five X-axis rungs; signed distance, hull and inertia follow the cylinder axis', () => {
  const e = g.CATALOG.ladder;
  assert.ok(e && e.shape.type === 'parts' && e.mass > 0);
  const rungs = e.shape.parts.filter(p => p.type === 'cylinder');
  assert.equal(rungs.length, 5);
  for (const r of rungs) {
    assert.equal(r.axis, 'x');
    const y = r.at[1];
    assert.ok(g.signedDistance(e.shape, [0, y, 0]) < -0.015, 'rung centre inside');
    assert.ok(Math.abs(g.signedDistance(e.shape, [0.1, y + r.radius, 0])) < 1e-9, 'rung surface');
    assert.ok(Math.abs(g.signedDistance(e.shape, [0.1, y, r.radius + 0.01]) - 0.01) < 1e-9, 'distance 1 cm off the rung');
  }
  assert.ok(g.signedDistance(e.shape, [0, 0.15, 0]) > 0.1, 'between rungs is open');
  // a cylinder without axis is unchanged, with axis it is the same cylinder turned: distance of the permuted point
  const plain = { type: 'cylinder', radius: 0.02, half: 0.2 }, alongX = { ...plain, axis: 'x' }, alongZ = { ...plain, axis: 'z' };
  for (const p of [[0.1, 0.05, 0.03], [-0.3, 0.01, 0.02], [0, 0.2, 0.1]]) {
    assert.equal(g.signedDistance(alongX, [p[1], p[0], p[2]]), g.signedDistance(plain, p));
    assert.equal(g.signedDistance(alongZ, [p[0], p[2], p[1]]), g.signedDistance(plain, p));
  }
  const hull = g.hullPoints(e.shape);
  assert.ok(hull.length > 40 && hull.every(p => p.every(Number.isFinite)));
  assert.ok(hull.some(p => Math.abs(p[0]) > 0.19 && Math.abs(p[0]) < 0.21), 'rung ends reach x = +-0.2');
  const mp = g.massProperties(e.shape, e.mass);
  assert.ok(mp.volume > 0 && mp.inertia.every(v => v > 0 && Number.isFinite(v)));
  assert.equal(g.signedDistance(g.CATALOG.pole.shape, [0.03, 0, 0]), 0.03 - 0.022, 'the existing kinds are untouched');
});

test('ladder: default library has no ladder pose (opt-in, like pole and barrel); proceduralgrasps adds the rung group', () => {
  g.setProceduralGrasps(false);
  assert.equal(g.hasPoses('ladder'), false);
  g.setProceduralGrasps(true);
  assert.equal(g.hasPoses('ladder'), true);
  for (const side of ['left', 'right']) {
    const rows = g.posesFor('ladder', side).filter(p => p.grasp === 'rung');
    assert.equal(rows.length, 75);
    assert.equal(rows.filter(p => p.default).length, 1);
    assert.ok(rows.every(p => p.axis && p.axis.dir[0] === 1 && p.axis.origin[0] === 0 && g.isPose(p)));
    assert.equal(new Set(rows.map(p => p.axis.origin[1])).size, 5, 'five rungs');
  }
});

test('ladder: closure hit-rate on the rungs is 100 % on hands of 0.9 / 1.0 / 1.1, and it needs the per-pose axis (stripped of it most rows fail)', () => {
  const rows = g.PROCEDURAL.filter(p => p.kind === 'ladder'), report = {};
  assert.equal(rows.length, 150);
  for (const scale of [0.9, 1, 1.1]) { const r = hitRate(rows, scale); report[scale] = `${r.ok}/${r.n}`; assert.equal(r.ok, r.n, `ladder @${scale}`); }
  const stripped = rows.map(({ axis, ...p }) => p), s = hitRate(stripped, 1);
  report.withoutAxis = `${s.ok}/${s.n}`;
  assert.ok(s.ok < rows.length * 0.5, `without the axis the +Y-axis assumption fails the rung wraps (${s.ok}/${s.n})`);
  console.log('ladder hit-rate', JSON.stringify(report));
});

test('ladder: two hands on DIFFERENT rungs; the secondary pick is a rung >= minSeparation away and the hands never overlap', () => {
  const spec = g.twoHandSpec('ladder');
  assert.deepEqual([spec.primary, spec.secondary], ['rung', 'rung']);
  assert.ok(g.isTwoHanded('ladder'));
  const p1 = g.defaultPose('ladder', 'right', 'rung');
  const pick = g.pickSecondary('ladder', 'left', { pos: p1.wrist, quat: p1.quat }, { primary: p1 });
  assert.ok(pick && g.gripSeparation(pick.pose, p1) >= spec.minSeparation - 1e-9);
  assert.notEqual(pick.pose.axis.origin[1], p1.axis.origin[1], 'another rung');
  const R = g.referenceHand('right'), L = g.referenceHand('left'), shape = g.CATALOG.ladder.shape;
  let pairs = 0, clear = 0, primaries = 0, served = 0;
  for (const a of g.posesFor('ladder', 'right').filter(p => p.axis.origin[1] === 0)) {
    primaries++; const ca = g.closeToContact(a, R, shape); let any = false;
    for (const b of g.secondaryPoses('ladder', 'left', a)) { const cb = g.closeToContact(b, L, shape), gap = g.handsClearance(R, ca, L, cb); pairs++; if (gap >= 0) { clear++; any = true; } }
    if (any) served++;
  }
  assert.equal(served, primaries, 'every primary has a clear partner');
  assert.ok(clear / pairs >= 0.85, `${clear}/${pairs} pairs clear`);
  console.log('ladder two-hand pairs clear', `${clear}/${pairs}`, 'primaries served', `${served}/${primaries}`);
});

test('pose.axis survives mirror and validation; a broken axis is not a pose', () => {
  const p = g.defaultPose('ladder', 'right', 'rung'), m = g.mirrorPose(p);
  assert.equal(m.axis.dir[0], 1);
  assert.equal(m.axis.origin[1], p.axis.origin[1]);
  assert.ok(g.isPose(m));
  assert.ok(!g.isPose({ ...p, axis: { origin: [0, 0, 0], dir: [0, 0, 0] } }));
  assert.ok(!g.isPose({ ...p, axis: { origin: [0, 0], dir: [1, 0, 0] } }));
  assert.ok(!g.isPose({ ...p, axis: { origin: [0, NaN, 0], dir: [1, 0, 0] } }));
  assert.ok(g.isPose({ ...p, axis: undefined }), 'no axis = the default +Y axis');
});

test('the generator reproduces the ladder and body rows (--check)', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['extensions/grasp/tools/make_procedural_grasps.mjs', '--check'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.match(out, new RegExp(`accepted ${g.PROCEDURAL.length} `));
  assert.match(out, /'ladder\/rung': 150/);
  assert.match(out, /'mug\/body': 36/);
  assert.match(out, /dropped 0/);
});
