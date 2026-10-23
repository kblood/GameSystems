// Offline generator of the PROCEDURAL grasps (extensions/grasp/data/procedural_grasps.data.json): grasp rows for the props
// that have no baked grasp that works, made by moving EXISTING baked rows onto the new shape (no new assets, no new bake):
//   mug handle  the Godot handle rows with the thumb moved inside the joint ranges onto the handle (mode 'hook': three or four
//               fingers through the handle, the thumb rests on it; no thumb-opposition gate, that is for wraps). Replaces the
//               baked mug/*/handle group, which failed the wrap gates (thumb row outside HARD, thumb opposition 57 deg).
//   mug body    the baked body wrap with the thumb pitch (100, outside the joint range) stored inside it, spun about the mug axis. Replaces mug/*/body.
//   mug top     the carton's top-face rows (palm on the lid, fingers over the rim) moved onto the mug top; role 'secondary'.
//   carton side the carton's baked rows on the +-X faces (palms on the two short sides) as their own group for two hands.
//   pole        the can's body wrap rows moved along the axis (stations). (the ladder follows below.)
//   ladder rung the pole wraps turned onto the rungs (axis X) with a per-pose grip axis (pose.axis), 5 rungs x 3 stations; two hands grip different rungs.
//   barrel side the carton's baked +-X-face rows turned about the barrel axis (palms flat on the side).
// Every pose is closed on the reference hand and judged by scoreGrasp (record.js) with the baked verdict gates; only
// accepted poses are written. Run: node extensions/grasp/tools/make_procedural_grasps.mjs [--check]   (--check: no write).
// The closure still refits the wrist and fingers on the character's own hand at grab time (graspPose), as for any bake.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as g from '../index.js';
import { qmul, rotate, add, sub } from '../math.js';

const OUT = fileURLToPath(new URL('../data/procedural_grasps.data.json', import.meta.url));
const check = process.argv.includes('--check');
const baked = JSON.parse(readFileSync(fileURLToPath(new URL('../baked_grasps.data.json', import.meta.url)), 'utf8')).poses;
const r5 = v => Math.round(v * 1e5) / 1e5 + 0, r2 = v => Math.round(v * 100) / 100 + 0;
const strip = rows => rows.map(r => r.map(v => r2(v)));
const qy = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const find = id => { const p = baked.find(q => q.id === id); if (!p) throw new Error(`no baked pose ${id}`); return p; };
const SIDES = ['right', 'left'];
const out = [], dropped = [];

function emit(template, patch) {
  const pose = {
    id: patch.id, kind: patch.kind, grasp: patch.grasp, mode: patch.mode ?? template.mode, side: template.side, default: !!patch.default,
    ...(patch.role && { role: patch.role }), ...(patch.axis && { axis: patch.axis }),
    wrist: patch.wrist.map(r5), quat: patch.quat.map(r5), angles: strip(patch.angles ?? template.angles), open: strip(patch.open ?? template.open),
    source: 'procedural', template: template.id,
  };
  const hand = g.referenceHand(pose.side), score = g.scoreGrasp(pose, hand);
  if (!score.ok) { dropped.push({ id: pose.id, failures: score.failures }); return null; }
  pose.metrics = { penetrationMm: score.metrics.penetrationMm, palmGapMm: score.metrics.palmGapMm, thumbOppositionDeg: score.metrics.thumbOppositionDeg, fingersTouching: score.metrics.fingersTouching, thumbTouching: score.metrics.thumbTouching };
  out.push(pose);
  return pose;
}

// ---- mug handle: thumb moved inside the joint ranges onto the handle --------------------------------------------------
function thumbRest(side, template) {
  const hand = g.referenceHand(side), shape = g.CATALOG.mug.shape;
  const four = rows => rows.map(r => r.slice(0, 4));
  const closed = g.closeToContact(template, hand, shape, { rows: { open: four(template.open), angles: four(template.angles) } });
  let best = null;
  for (let dy = -55; dy <= 30; dy += 5) for (let p = -35; p <= 65; p += 5) for (let b1 = -25; b1 <= 80; b1 += 5) for (let b2 = -25; b2 <= 95; b2 += 5) {
    const rows = closed.angles.map((r, i) => (i === 0 ? [dy, p, b1, b2] : r)), gaps = g.chainGaps(hand, shape, closed, rows).Thumb, [s0, s1, s2] = gaps.segments;
    if (Math.min(s0, s1, s2) < -0.0005 || s2 > 0.0015 || s2 < -0.0005 || s1 < 0.001) continue;      // distal pad resting on the handle, nothing inside
    const cost = g.validateRows(Object.fromEntries(['Thumb', 'Index', 'Middle', 'Ring', 'Little'].map((f, i) => [f, i === 0 ? [dy, p, b1, b2] : closed.angles[i]]))).cost;
    if (!best || cost < best.cost) best = { row: [dy, p, b1, b2], cost };
  }
  return best;
}
for (const side of SIDES) for (const t of ['t+1', 't-1']) {
  const template = find(`mug/${side}/handle/o+0.0000_r000_${t}`), best = thumbRest(side, template);
  if (!best) { dropped.push({ id: `mug/${side}/handle/${t}`, failures: ['no in-range thumb row rests on the handle'] }); continue; }
  const angles = template.angles.map((r, i) => (i === 0 ? best.row : r)), open = template.open.map((r, i) => (i === 0 ? [best.row[0], best.row[1], 0, 0] : r));
  emit(template, { id: `mug/${side}/handle/hook_${t}`, kind: 'mug', grasp: 'handle', mode: 'hook', default: t === 't+1', wrist: template.wrist, quat: template.quat, angles, open });
}

// ---- mug top: the carton's top-face rows on the mug lid -----------------------------------------------------------------
{
  const dy = 0.0525 - 0.07;                         // mug top (0.0525) vs carton top (0.07)
  for (const side of SIDES) for (const f of ['f-z', 'f+z', 'f-x', 'f+x']) {
    const template = baked.find(p => p.id === `carton/${side}/face/n+y_${f.replace('f', 'f')}`) ?? baked.find(p => p.kind === 'carton' && p.side === side && p.id.endsWith(`n+y_${f}`));
    if (!template) continue;
    emit(template, { id: `mug/${side}/top/n+y_${f}`, kind: 'mug', grasp: 'top', role: 'secondary', mode: 'flat', default: f === 'f-z', wrist: add(template.wrist, [0, dy, 0]), quat: template.quat });
  }
}

// ---- mug body: the baked body wrap with the thumb inside the joint ranges -------------------------------------------------
// ROOT CAUSE of the baked mug/*/body failure (4 rows, 0 % at hand scale 0.9/1.0/1.1): the Godot-baked thumb row is [-42, 100, 10, -20]
// and the CMC pitch 100 is outside HARD.Thumb.pitch (-35..65), so validateRows rejects the stored row; closure (clampRows) already pulls
// it to 65 and the thumb then still opposes (154 deg). So the fix is NOT a new thumb search, it is storing the row inside the range
// (pitch clamped to 65, the thumb closing onto the side of the body) and spinning the wrap about the mug axis (clear of the handle
// at +X, which is part of the shape the verdict checks) so a hand can come from several sides.
{
  const HARDP = g.HARD.Thumb.pitch, clampP = row => [row[0], Math.max(HARDP[0], Math.min(HARDP[1], row[1])), ...row.slice(2)];
  for (const side of SIDES) for (const t of baked.filter(p => p.id.startsWith(`mug/${side}/body/`))) for (const dy of [0, -0.012, 0.012]) for (const deg of [0, 25, 50].map(d => (d && t.wrist[2] > 0 ? -d : d))) {   // away from the handle side (+X): the other way is inside the handle
    const spun = qy(deg * Math.PI / 180), w0 = [t.wrist[0], t.wrist[1] + dy, t.wrist[2]];
    const angles = t.angles.map((r, i) => (i === 0 ? clampP(r) : r)), open = t.open.map((r, i) => (i === 0 ? clampP(r) : r));
    emit(t, { id: `${t.id.replace('/o+0.0000_', '/a')}_s${deg >= 0 ? '+' : '-'}${String(Math.abs(deg)).padStart(2, '0')}_y${dy > 0 ? '+' : dy < 0 ? '-' : '0'}`, kind: 'mug', grasp: 'body',
      default: dy === 0 && deg === 0 && t.id.includes("_t+1"), wrist: rotate(spun, w0), quat: qmul(spun, t.quat), angles, open });
  }
}

// ---- carton side: the +-X face rows as the two-hand group ----------------------------------------------------------------
for (const side of SIDES) for (const n of ['n+x', 'n-x']) for (const f of ['f-z', 'f+z', 'f-y', 'f+y']) {
  const template = baked.find(p => p.id === `carton/${side}/face/${n}_${f}`);
  if (template) emit(template, { id: `carton/${side}/side/${n}_${f}`, kind: 'carton', grasp: 'side', default: n === 'n+x' && f === 'f-z', wrist: template.wrist, quat: template.quat });
}

// ---- pole and ladder: the can's wrap rows along the axis ---------------------------------------------------------------------
const CAN = { right: ['r135', 'r180', 'r225', 'r270', 'r315'], left: ['r045', 'r090', 'r225', 'r270', 'r315'] };
function wraps(kind, grasp, radius, centres, stations) {
  for (const side of SIDES) for (const [ci, [cx, cz]] of centres.entries()) for (const y of stations) for (const roll of CAN[side]) {
    const template = baked.find(p => p.id === `can/${side}/body/o+0.0000_${roll}_t+1`) ?? baked.find(p => p.kind === 'can' && p.side === side && p.id.includes(`_${roll}_t`) && p.id.includes('o+0.0000'));
    if (!template) continue;
    const h = [template.wrist[0], template.wrist[2]], hl = Math.hypot(...h), k = (hl - (0.037 - radius)) / hl;
    const wrist = [cx + h[0] * k, y + template.wrist[1], cz + h[1] * k];
    emit(template, { id: `${kind}/${side}/${grasp}/${centres.length > 1 ? `x${cx >= 0 ? '+' : '-'}_` : ''}y${y >= 0 ? '+' : '-'}${Math.abs(y).toFixed(2)}_${roll}`, kind, grasp,
      default: ci === 0 && y === 0 && roll === CAN[side][0], wrist, quat: template.quat });
  }
}
const range = (a, b, s) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => r5(a + i * s));
wraps('pole', 'grip', 0.022, [[0, 0]], range(-0.6, 0.6, 0.15));

// ---- ladder rungs: the pole wraps moved onto a rung (axis along X), each pose carries its OWN grip axis ------------------------------
// The thumb-opposition gate (closure.js gradeGrasp / record.js scoreGrasp) measured angles around +Y through the origin. A pose may now
// carry `axis: { origin, dir }` (aroundOf in closure.js): a rung runs along X at its height, so the gate measures around that line.
// Poses without an axis are judged exactly as before (the baked library, every other procedural group). The wraps are the pole's
// (station along the rung = pole station), turned so the pole axis (+Y) lies along +X (Rz -90 deg) and lifted to the rung.
{
  const RUNGS = [-0.6, -0.3, 0, 0.3, 0.6], STATIONS = [-0.1, 0, 0.1], radius = 0.016, qT = [0, 0, Math.sin(-Math.PI / 4), Math.cos(-Math.PI / 4)];
  for (const side of SIDES) for (const [ri, yr] of RUNGS.entries()) for (const [si, sx] of STATIONS.entries()) for (const roll of CAN[side]) {
    const template = baked.find(p => p.id === `can/${side}/body/o+0.0000_${roll}_t+1`) ?? baked.find(p => p.kind === 'can' && p.side === side && p.id.includes(`_${roll}_t`) && p.id.includes('o+0.0000'));
    if (!template) continue;
    const hl = Math.hypot(template.wrist[0], template.wrist[2]), k = (hl - (0.037 - radius)) / hl;
    const w = [template.wrist[0] * k, sx + template.wrist[1], template.wrist[2] * k];     // pole frame (axis +Y, station sx)
    const wrist = [w[1], -w[0] + yr, w[2]];                                              // Rz(-90): (x, y) -> (y, -x); then up to the rung
    emit(template, { id: `ladder/${side}/rung/y${yr >= 0 ? '+' : '-'}${Math.abs(yr).toFixed(2)}_x${sx >= 0 ? '+' : '-'}${Math.abs(sx).toFixed(2)}_${roll}`, kind: 'ladder', grasp: 'rung',
      default: ri === 2 && si === 1 && roll === CAN[side][0], wrist, quat: qmul(qT, template.quat), axis: { origin: [0, yr, 0], dir: [1, 0, 0] } });
  }
}

// ---- barrel: the carton's
// ---- barrel: the carton's +-X-face rows turned about the barrel axis ------------------------------------------------------------
for (const side of SIDES) for (const f of ['f-z', 'f+z']) for (const dy of [-0.08, 0.08]) for (let deg = 0; deg < 360; deg += 30) {
  const template = baked.find(p => p.id === `carton/${side}/face/n+x_${f}`);
  if (!template) continue;
  const spun = qy(deg * Math.PI / 180), w0 = [template.wrist[0] + (0.2 - 0.11), template.wrist[1] + dy, template.wrist[2]];
  emit(template, { id: `barrel/${side}/side/a${String(deg).padStart(3, '0')}_${f}_y${dy > 0 ? '+' : '-'}`, kind: 'barrel', grasp: 'side', mode: 'flat',
    default: deg === 0 && f === 'f-z' && dy < 0, wrist: rotate(spun, w0), quat: qmul(spun, template.quat) });
}

const doc = {
  schema: 'gamesystems.procedural-grasps.v1',
  note: 'Generated by extensions/grasp/tools/make_procedural_grasps.mjs from baked rows (no new assets). OPT-IN: baked_grasps.js merges these into the library only after setProceduralGrasps(true) (games: ?proceduralgrasps=on; the Grasp Studio turns it on); `replaces` lists baked groups they supersede then (kind/side/grasp, * = any side). The bake itself (baked_grasps.data.json) is untouched.',
  replaces: ['mug/*/handle', 'mug/*/body'],
  poses: out,
};
const counts = {};
for (const p of out) counts[`${p.kind}/${p.grasp}`] = (counts[`${p.kind}/${p.grasp}`] ?? 0) + 1;
console.log('accepted', out.length, counts, 'dropped', dropped.length);
for (const d of dropped.slice(0, 25)) console.log('  dropped', d.id, d.failures.join('; '));
if (!check) {
  const text = `{\n  "schema": ${JSON.stringify(doc.schema)},\n  "note": ${JSON.stringify(doc.note)},\n  "replaces": ${JSON.stringify(doc.replaces)},\n  "poses": [\n${out.map(p => `    ${JSON.stringify(p)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(OUT, text);
  console.log('wrote', OUT, `${(text.length / 1024).toFixed(0)} KB`);
}
