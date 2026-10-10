// Grasp lab: close-to-contact measurements on the rendered CharacterCreator skin (extensions plan step 3).
//   CONTRACTS_DIR=... node tools/lab/closure_lab.mjs [calibrate|report] [out.json]      env: KINDS=bottle_beer,mug  ALL=1 (every pose)  IDS=r180_t+1,... (pose id substrings)
//   CLOSURE='{"overshoot":0.2}' (tuning: overrides closure.js CLOSURE for 'mid')   SEARCH=mid|high|none (closure search, default mid)
//   PROFILE='{"size":1.1,"girth":1.2}' (hand-profile override on the avatar, entity.setHandProfile: the hand mesh is unchanged, the
//   closure sees the adjusted profile; shows the grasp adapting to a profile). CHARACTER=cc|vrm (lab_page.mjs).
// calibrate: per finger segment, the contact radius the skin has on this character when posed (bone-model gap minus skin
//   gap on the closed wrap grasps, where the skin is at the surface) vs the hand profile's pad, as a hand-profile override
//   ({ pad }, rig metres: pass it as the provider / plugin handProfile option or entity.setHandProfile()); plus the palm offset.
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
import { handGeometry, closeToContact, fingerChain } from '../../closure.js';

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
  if (process.env.PROFILE) await lab.page.evaluate(o => window.__lab.setHandProfile(o), JSON.parse(process.env.PROFILE));
  const search = process.env.SEARCH === 'none' ? null : process.env.SEARCH || 'mid';
  for (const side of ['left', 'right']) {
    const { scale, rest } = await lab.page.evaluate(s => window.__lab.restHand(s), side);
    hands[side] = { scale, rest, hand: handGeometry(rest, { scale }), bare: handGeometry(rest, { scale, radii: Object.fromEntries(FINGERS.map(f => [f, [0, 0, 0]])) }) };
  }

  if (mode === 'calibrate') {
    // Per finger segment: the contact radius the skin actually has on this character, posed = (bone-model gap without
    // pad) - (skin gap), sampled where the skin is at the surface (-4..8 mm) on the closed (mid, close-to-contact) grasps,
    // vs the hand profile's pad; the medians per side as a profile override ({ left: { pad, palmOffset }, right }, rig metres) for createCharacterPlugin /
    // provider `handProfile` or entity.setHandProfile(); pads floored at 3 mm). Plus the palm: profile palm-patch gap - posed
    // palm-skin gap -> palmOffset.
    const { signedDistance } = await import('../../catalog.js');
    const samples = {}, palm = {};
    const poses = BAKED.poses.filter(p => CATALOG[p.kind] && kinds.includes(p.kind) && p.mode === 'wrap' && (process.env.ALL || p.default || p.id.includes('_r000_')));
    const qrot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
    for (const p of poses) {
      const h = hands[p.side], s = h.scale, shape = CATALOG[p.kind].shape, exempt = CLAMP_EXEMPT.includes(p.kind);
      const closed = closeToContact(p, h.hand, shape, { rows: exempt ? p : { open: clampList(p.open), angles: clampList(p.angles) }, keep: exempt ? ['Thumb'] : [], search });
      if (!await place({ ...p, wrist: closed.wrist, quat: closed.quat }, rowsObj(closed.angles))) continue;
      const m = await measure(p.side, closed.wrist, closed.quat, rowsObj(closed.angles));
      const toItem = l => { const r = qrot(closed.quat, l.map(v => v * s)); return [closed.wrist[0] + r[0], closed.wrist[1] + r[1], closed.wrist[2] + r[2]]; };
      FINGERS.forEach((f, i) => {
        const c = fingerChain(h.hand.fingers[f], closed.angles[i]);
        for (let k = 0; k < 3; k++) {
          const skin = m.groups[segName(f, k)];
          if (!(skin > -4 && skin < 8)) continue;
          const a = c[k], b = c[k + 1], mid = a.map((v, j) => (v + b[j]) / 2);
          const bone = Math.min(signedDistance(shape, toItem(mid)), signedDistance(shape, toItem(b))) * 1000;
          (samples[`${p.side}:${f}${k}`] ||= []).push((bone - skin) / 1000 / s);
        }
      });
      if (Number.isFinite(closed.grade?.palmGap) && m.groups.Hand > -4 && m.groups.Hand < 12) (palm[p.side] ||= []).push(closed.grade.palmGap * 1000 - m.groups.Hand);
    }
    const median = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const r5 = v => Math.round(v * 1e5) / 1e5, mm = (v, sc) => Math.round(v * sc * 10000) / 10;
    const result = { mode, character: process.env.CHARACTER || 'cc', search, scale: hands.left.scale, sides: {}, override: {} };
    for (const side of ['left', 'right']) {
      const prof = hands[side].hand.profile, sc = hands[side].scale, got = (f, k) => samples[`${side}:${f}${k}`] ?? [];
      const pad = Object.fromEntries(FINGERS.map(f => [f, [0, 1, 2].map(k => got(f, k).length ? r5(Math.max(0.003 / sc, median(got(f, k)))) : prof.pad[f][k])]));
      const pm = palm[side] ?? [];
      result.sides[side] = {
        profilePadMm: Object.fromEntries(FINGERS.map(f => [f, prof.pad[f].map(v => mm(v, sc))])),
        measuredPadMm: Object.fromEntries(FINGERS.map(f => [f, [0, 1, 2].map(k => got(f, k).length ? mm(median(got(f, k)), sc) : null)])),
        counts: Object.fromEntries(FINGERS.map(f => [f, [0, 1, 2].map(k => got(f, k).length)])),
        palmOffsetMm: pm.length ? Math.round(median(pm) * 10) / 10 : null,
      };
      result.override[side] = { pad, ...(pm.length >= 3 && { palmOffset: r5(median(pm) / 1000 / sc) }) };
    }
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 1));
  } else {
    const poses = BAKED.poses.filter(p => CATALOG[p.kind] && kinds.includes(p.kind) && (process.env.ALL || p.default) && (!process.env.IDS || process.env.IDS.split(',').some(s => p.id.includes(s))));
    const rows = [];
    for (const p of poses) {
      const h = hands[p.side], shape = CATALOG[p.kind].shape, wrap = p.mode === 'wrap';
      if (!await place(p, rowsObj(clampList(p.angles)))) { rows.push({ id: p.id, unreachable: true }); continue; }
      const exempt = CLAMP_EXEMPT.includes(p.kind), low = exempt ? p.angles : clampList(p.angles);
      const closed = closeToContact(p, h.hand, shape, { rows: exempt ? p : { open: clampList(p.open), angles: low }, keep: exempt ? ['Thumb'] : [], options: JSON.parse(process.env.CLOSURE || '{}'), search });
      const row = { id: p.id, kind: p.kind, side: p.side, grasp: p.grasp };
      for (const [name, wrist, quat, angles] of [['before', p.wrist, p.quat, before(p)], ['low', p.wrist, p.quat, low], ['mid', closed.wrist, closed.quat, closed.angles]]) {
        const m = await measure(p.side, wrist, quat, rowsObj(angles)), v = verdict(m, rowsObj(angles), { wrap });
        row[name] = { wristErr: m.wristErrorMm, pen: m.penetrationMm, worst: m.worstGroup, palm: m.palmGapMm, tips: m.tipGapMm, touching: m.fingersTouching, thumb: m.thumbTouching, opp: m.thumbOppositionDeg, ok: v.ok, failures: v.failures };
      }
      row.closure = Object.fromEntries(Object.entries(closed.fingers).map(([f, c]) => [f, { ...c, t: c.t.map(x => Math.round(x * 100) / 100) }]));
      rows.push(row);
      row.tried = closed.tried; row.grade = { score: Math.round(closed.grade.score * 10) / 10, palmGapMm: Math.round(closed.grade.palmGap * 10000) / 10, thenarGapMm: Math.round(closed.grade.thenarGap * 10000) / 10 };
      console.log(p.id, 'grade', JSON.stringify(row.grade), closed.grade.fingersTouching + (closed.grade.thumbTouching ? '+T' : ''), ['before', 'low', 'mid'].map(n => `${n}: werr ${row[n].wristErr} pen ${row[n].pen} palm ${row[n].palm} opp ${row[n].opp} touch ${row[n].touching}${row[n].thumb ? '+T' : ''} ${row[n].ok ? 'OK' : 'FAIL ' + row[n].failures.join('; ')}`).join(' | '));
    }
    const summary = {};
    for (const r of rows.filter(r => !r.unreachable)) for (const n of ['before', 'low', 'mid']) {
      const s = (summary[`${r.kind}/${n}`] ||= { poses: 0, ok: 0, maxPen: 0, minOpp: 999, meanOpp: 0 });
      s.poses++; s.ok += r[n].ok ? 1 : 0; s.maxPen = Math.max(s.maxPen, r[n].pen); s.minOpp = Math.min(s.minOpp, r[n].opp); s.meanOpp += r[n].opp;
    }
    for (const s of Object.values(summary)) s.meanOpp = Math.round(s.meanOpp / s.poses * 10) / 10;
    await writeFile(outPath, JSON.stringify({ mode, scale: hands.left.scale, handLength: hands.left.hand.length, profile: hands.left.rest.profile ?? null, search, summary, rows }, null, 2));
    console.log(JSON.stringify(summary, null, 1));
  }
  if (lab.errors.length) console.error('page errors', lab.errors);
} finally { await lab.close(); }
