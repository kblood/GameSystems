// Grasp lab: close-to-contact measurements on the rendered CharacterCreator skin (extensions plan step 3).
//   CONTRACTS_DIR=... node tools/lab/closure_lab.mjs [calibrate|report] [out.json]      env: KINDS=bottle_beer,mug  ALL=1 (every pose)
//   CLOSURE='{"overshoot":0.2}' (tuning: overrides closure.js CLOSURE for 'mid')
// calibrate: per finger segment, how far the skin reaches beyond the bone model of closure.js (pad radius = bone-model gap
//   minus skin gap, on the refitted lab-v1 poses where the skin touches) -> PAD_RADIUS as a fraction of the hand length;
//   plus the hand length and the palm anchor of this hand -> REFERENCE_HAND.
// report: skin contact metrics (contact.js) + validator verdict per pose for
//   before = the step-2 runtime (clamped rows + the old per-kind SKIN_MARGIN, mug raw: CLAMP_EXEMPT),
//   low    = the bake clamped to the joint ranges (no margin; CLAMP_EXEMPT kinds raw),
//   mid    = close-to-contact on this hand (closure.js; a CLAMP_EXEMPT kind keeps its raw thumb, as graspPose does).
// Default poses only unless ALL=1. Writes tools/scratch/closure_lab_<mode>.json unless an output path is given.
import { writeFile, mkdir } from 'node:fs/promises';
import { openLab } from './lab_page.mjs';
import { BAKED, defaultPose, CLAMP_EXEMPT } from '../../baked_grasps.js';
import { CATALOG } from '../../catalog.js';
import { clampRows, verdict } from '../../grasp_validator.js';
import { handGeometry, closeToContact, fingerChain, PAD_RADIUS } from '../../closure.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEGMENT = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'] };
const segName = (f, k) => `${f}${(SEGMENT[f] || SEGMENT.Index)[k]}`;
const mode = process.argv[2] || 'report', outPath = process.argv[3] || new URL(`../scratch/closure_lab_${mode}.json`, import.meta.url);
const kinds = (process.env.KINDS || 'bottle_beer,bottle_wine,mug,can,carton').split(',');
// The step-2 runtime correction this step replaces (baked_grasps.js SKIN_MARGIN before step 3), kept here for the comparison.
// Its mug thumb part (+10 deg bend1) moved into baked_grasps.data.json in step 3, so only the finger back-off remains here.
const LEGACY_MARGIN = { mug: { back: [0, -0.06, 0, -0.06, 0] } };
const rowsObj = list => Object.fromEntries(FINGERS.map((f, i) => [f, list[i]]));
const clampList = list => { const r = clampRows(rowsObj(list)); return FINGERS.map(f => r[f]); };
const before = p => {
  const m = !p.fit && LEGACY_MARGIN[p.kind], angles = m ? p.angles.map((row, i) => row.map((v, j) => v + (p.open[i][j] - v) * (m.back?.[i] ?? 0) + (m.add?.[i]?.[j] ?? 0))) : p.angles;
  return p.kind === 'mug' ? angles : clampList(angles);
};

const lab = await openLab();
const L = fn => lab.page.evaluate(fn);
try {
  await mkdir(new URL('../scratch/', import.meta.url), { recursive: true });
  // Place the item so the pose's wrist is reachable in front of the body (same placement as tools/fit_baked_thumbs.mjs).
  const place = (p, rows) => lab.page.evaluate(({ p, rows, shape }) => {
    const Lb = window.__lab, T = Lb.THREE;
    for (const tg of [[0.2, 1.08, -0.38], [0.06, 1.15, -0.45], [0.12, 1.2, -0.36], [0.1, 1.05, -0.35], [0.0, 1.12, -0.45], [0.16, 1.1, -0.4]]) {
      const q0 = new T.Quaternion(...p.quat), f = new T.Vector3(0, 0, 1).applyQuaternion(q0), n = new T.Vector3(0, -1, 0).applyQuaternion(q0);
      const h = Math.hypot(f.x, f.z) > 0.35 ? f : n, heading = Math.atan2(h.x, h.z), target = new T.Vector3(p.side === 'left' ? -tg[0] : tg[0], tg[1], tg[2]);
      const yaw = Math.PI - heading + (Math.hypot(f.x, f.z) > 0.35 ? 0 : p.side === 'left' ? -Math.PI / 2 : Math.PI / 2);
      const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), off = new T.Vector3(...p.wrist).applyQuaternion(qy);
      Lb.setItem(shape, { pos: target.sub(off).toArray(), yaw });
      Lb.player.resetTracking?.();
      if (Lb.measure(p.side, { pos: p.wrist, quat: p.quat }, rows, { iterations: 40 }).wristErrorMm <= 3) return true;
    }
    return false;
  }, { p, rows, shape: CATALOG[p.kind].shape });
  const measure = (side, wrist, quat, rows) => lab.page.evaluate(({ side, wrist, quat, rows }) => window.__lab.measure(side, { pos: wrist, quat }, rows, { iterations: 10 }), { side, wrist, quat, rows });
  const hands = {};
  for (const side of ['left', 'right']) {
    const { scale, rest } = await lab.page.evaluate(s => window.__lab.restHand(s), side);
    hands[side] = { scale, rest, hand: handGeometry(rest, { scale }), bare: handGeometry(rest, { scale, radii: Object.fromEntries(FINGERS.map(f => [f, [0, 0, 0]])) }) };
  }

  if (mode === 'calibrate') {
    const samples = {};
    const poses = BAKED.poses.filter(p => p.fit && kinds.includes(p.kind) && (process.env.ALL || p.id.includes('_r000_') || p.default));
    for (const p of poses) {
      const rows = clampList(p.angles);
      if (!await place(p, rowsObj(rows))) continue;
      const m = await measure(p.side, p.wrist, p.quat, rowsObj(rows)), h = hands[p.side], s = h.scale;
      const shape = CATALOG[p.kind].shape;
      const { signedDistance } = await import('../../catalog.js');
      const qrot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
      const toItem = l => { const r = qrot(p.quat, l.map(v => v * s)); return [p.wrist[0] + r[0], p.wrist[1] + r[1], p.wrist[2] + r[2]]; };
      FINGERS.forEach((f, i) => {
        const c = fingerChain(h.bare.fingers[f], rows[i]);
        for (let k = 0; k < 3; k++) {
          const skin = m.groups[segName(f, k)];
          if (!(skin > -4 && skin < 6)) continue;          // only segments at the surface say something about the pad
          const a = c[k], b = c[k + 1], mid = a.map((v, j) => (v + b[j]) / 2);
          const bone = Math.min(signedDistance(shape, toItem(mid)), signedDistance(shape, toItem(b))) * 1000;
          (samples[`${f}${k}`] ||= []).push((bone - skin) / 1000 / h.hand.length);
        }
      });
    }
    const median = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const radii = Object.fromEntries(FINGERS.map(f => [f, [0, 1, 2].map(k => samples[`${f}${k}`]?.length ? Math.round(median(samples[`${f}${k}`]) * 1000) / 1000 : null)]));
    // Palm anchor: the palm skin in the hand frame (lowest 10 % of the 'Hand' vertices along +Y, their mean).
    const p0 = defaultPose('bottle_beer', 'left');
    await place(p0, rowsObj(clampList(p0.angles)));
    const local = await lab.page.evaluate(() => window.__lab.handLocalPoints('left').filter(x => x.group === 'Hand').map(x => x.p));
    const ys = local.map(p => p[1]).sort((a, b) => a - b), cut = ys[Math.floor(ys.length * 0.1)], palm = local.filter(p => p[1] <= cut);
    const mean = k => Math.round(palm.reduce((s, p) => s + p[k], 0) / palm.length * 10000) / 10000;
    const result = { mode, radii, counts: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, v.length])), current: PAD_RADIUS,
      reference: { length: Math.round(hands.left.hand.length * 10000) / 10000, palm: [0, mean(1), mean(2)], scale: hands.left.scale } };
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 1));
  } else {
    const poses = BAKED.poses.filter(p => CATALOG[p.kind] && kinds.includes(p.kind) && (process.env.ALL || p.default));
    const rows = [];
    for (const p of poses) {
      const h = hands[p.side], shape = CATALOG[p.kind].shape, wrap = p.mode === 'wrap';
      if (!await place(p, rowsObj(clampList(p.angles)))) { rows.push({ id: p.id, unreachable: true }); continue; }
      const exempt = CLAMP_EXEMPT.includes(p.kind), low = exempt ? p.angles : clampList(p.angles);
      const closed = closeToContact(p, h.hand, shape, { rows: exempt ? p : { open: clampList(p.open), angles: low }, keep: exempt ? ['Thumb'] : [], options: JSON.parse(process.env.CLOSURE || '{}') });
      const row = { id: p.id, kind: p.kind, side: p.side, grasp: p.grasp };
      for (const [name, wrist, quat, angles] of [['before', p.wrist, p.quat, before(p)], ['low', p.wrist, p.quat, low], ['mid', closed.wrist, closed.quat, closed.angles]]) {
        const m = await measure(p.side, wrist, quat, rowsObj(angles)), v = verdict(m, rowsObj(angles), { wrap });
        row[name] = { pen: m.penetrationMm, worst: m.worstGroup, palm: m.palmGapMm, tips: m.tipGapMm, touching: m.fingersTouching, thumb: m.thumbTouching, opp: m.thumbOppositionDeg, ok: v.ok, failures: v.failures };
      }
      row.closure = Object.fromEntries(Object.entries(closed.fingers).map(([f, c]) => [f, { ...c, t: c.t.map(x => Math.round(x * 100) / 100) }]));
      rows.push(row);
      console.log(p.id, ['before', 'low', 'mid'].map(n => `${n}: pen ${row[n].pen} opp ${row[n].opp} touch ${row[n].touching}${row[n].thumb ? '+T' : ''} ${row[n].ok ? 'OK' : 'FAIL ' + row[n].failures.join('; ')}`).join(' | '));
    }
    const summary = {};
    for (const r of rows.filter(r => !r.unreachable)) for (const n of ['before', 'low', 'mid']) {
      const s = (summary[`${r.kind}/${n}`] ||= { poses: 0, ok: 0, maxPen: 0, minOpp: 999, meanOpp: 0 });
      s.poses++; s.ok += r[n].ok ? 1 : 0; s.maxPen = Math.max(s.maxPen, r[n].pen); s.minOpp = Math.min(s.minOpp, r[n].opp); s.meanOpp += r[n].opp;
    }
    for (const s of Object.values(summary)) s.meanOpp = Math.round(s.meanOpp / s.poses * 10) / 10;
    await writeFile(outPath, JSON.stringify({ mode, scale: hands.left.scale, handLength: hands.left.hand.length, summary, rows }, null, 2));
    console.log(JSON.stringify(summary, null, 1));
  }
  if (lab.errors.length) console.error('page errors', lab.errors);
} finally { await lab.close(); }
