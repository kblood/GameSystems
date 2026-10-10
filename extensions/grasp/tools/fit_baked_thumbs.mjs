// Refit the thumb (and, if needed, a small wrist nudge) of every baked wrap grasp so the thumb stays inside the plugin's
// joint ranges and still touches. Fingers are kept as baked. Fits against the ORIGINAL Godot bake (tools/data/
// baked_before.json, tracked here so the fitter never depends on an untracked file); writes tools/scratch/thumb_fit_<kind><TAG>.json.
// The lab runs the Contracts avatar (CONTRACTS_DIR, default ../NightfallContractsWebXR-interaction next to GameSystems)
// in headless Chrome (SwiftShader); see lab/lab_page.mjs. Apply the result with tools/apply_grasp_fit.mjs.
// usage: node tools/fit_baked_thumbs.mjs <kind> [evalsPerPose=700]     env: SIDE, LIMIT, TX/TY/TZ, TAG
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openLab } from './lab/lab_page.mjs';
import { CATALOG } from '../catalog.js';
import { verdict, HARD, COMFORT } from '../grasp_validator.js';
import { BEFORE, SCRATCH } from './apply_grasp_fit.mjs';

const BAKED = JSON.parse(await readFile(BEFORE, 'utf8').catch(() => { throw new Error(`missing ${fileURLToPath(BEFORE)}: the original bake (Contracts tools/convert_baked_grasps.mjs output)`); }));
const kind = process.argv[2], evals = Number(process.argv[3]) || 700;
if (!CATALOG[kind]) throw new Error(`kind? ${Object.keys(CATALOG)}`);
const side = process.env.SIDE, limit = Number(process.env.LIMIT) || 1e9, tx = Number(process.env.TX ?? 0.2), ty = Number(process.env.TY ?? 1.08), tz = Number(process.env.TZ ?? -0.38);
const poses = BAKED.poses.filter(p => p.kind === kind && p.mode === 'wrap' && (!side || p.side === side)).slice(0, limit);
const lab = await openLab();
const results = {};
try {
  await mkdir(SCRATCH, { recursive: true });
  for (let i = 0; i < poses.length; i += 6) {
    const batch = poses.slice(i, i + 6);
    const out = await lab.page.evaluate(({ batch, evals, shape, tx, ty, tz, thumbHard, thumbComfort }) => {
      const L = window.__lab, T = L.THREE;
      let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
      // Thumb ranges and comfort band from grasp_validator.js (grab_findings 2.11: one source for the limits).
      const HARD = thumbHard, C = thumbComfort.centre, W = thumbComfort.width;
      // Put the item so the baked wrist lands at a comfortable spot in front of the body, hand heading forward.
      const place = (p, tgt) => {
        const q0 = new T.Quaternion(...p.quat), f = new T.Vector3(0, 0, 1).applyQuaternion(q0), n = new T.Vector3(0, -1, 0).applyQuaternion(q0);
        const h = Math.hypot(f.x, f.z) > 0.35 ? f : n, heading = Math.atan2(h.x, h.z), target = new T.Vector3(p.side === 'left' ? -tgt[0] : tgt[0], tgt[1], tgt[2]);
        const yaw = Math.PI - heading + (Math.hypot(f.x, f.z) > 0.35 ? 0 : p.side === 'left' ? -Math.PI / 2 : Math.PI / 2);
        const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), off = new T.Vector3(...p.wrist).applyQuaternion(qy);
        L.setItem(shape, { pos: target.sub(off).toArray(), yaw });
      };
      return batch.map(p => {
        const TARGETS = [[tx, ty, tz], [0.06, 1.15, -0.45], [0.12, 1.2, -0.36], [0.1, 1.05, -0.35], [0.0, 1.12, -0.45], [0.16, 1.1, -0.4]];
        const reach = () => { L.player.resetTracking?.(); const w = { pos: p.wrist, quat: p.quat }; return L.measure(p.side, w, Object.fromEntries(['Thumb', 'Index', 'Middle', 'Ring', 'Little'].map((f, k) => [f, p.angles[k]])), { iterations: 40 }).wristErrorMm; };
        let usedTarget = null;
        for (const tg of TARGETS) { place(p, tg); const e = reach(); if (e <= 3) { usedTarget = tg; break; } }
        if (!usedTarget) return { id: p.id, ok: false, failures: ['arm cannot reach the wrist at any placement'], m: {}, rows: {}, thumb: p.angles[0], nudged: false };
        const fingers = Object.fromEntries(['Thumb', 'Index', 'Middle', 'Ring', 'Little'].map((f, k) => [f, p.angles[k]]));
        const baseQ = new T.Quaternion(...p.quat);
        const build = s => {
          const dq = new T.Quaternion().setFromEuler(new T.Euler(s.rot[0], s.rot[1], s.rot[2]));
          return { wrist: { pos: p.wrist.map((v, k) => v + s.pos[k]), quat: dq.multiply(baseQ).toArray() }, rows: { Thumb: s.thumb, ...Object.fromEntries(['Index', 'Middle', 'Ring', 'Little'].map((f, k) => [f, fingers[f].map((v, j) => j === 0 ? v : v * s.sc[k])])) } };
        };
        const ev = (s, nudge) => {
          const { wrist, rows } = build(s), m = L.measure(p.side, wrist, rows, { iterations: 5 });
          let c = Math.max(0, m.penetrationMm - 0.8) * 8;
          const tg = m.per.Thumb.gap; c += (Number.isFinite(tg) ? Math.abs(tg - 1) : 40) * 2;
          c += Math.max(0, 128 - m.thumbOppositionDeg) * 0.5;
          s.thumb.forEach((v, k) => { const [lo, hi] = HARD[k]; c += ((v - C[k]) / W[k]) ** 2 * 3; if (v < lo + 4) c += (lo + 4 - v) * 3; if (v > hi - 4) c += (v - hi + 4) * 3; });
          for (const f of ['Index', 'Middle', 'Ring', 'Little']) { const g = m.per[f].gap; c += (Number.isFinite(g) ? Math.abs(g - 1) : 40) * 1.2; }
          c += Math.abs(m.palmGapMm - 2) * 3;
          s.sc.forEach(v => { c += Math.max(0, Math.abs(v - 1) - 0.35) * 20; });
          c += Math.max(0, m.deviationDeg - 28) * 1.5 + Math.min(m.wristErrorMm, 80) * 2;
          c += (Math.hypot(...s.pos) * 1000) * (nudge ? 0.3 : 0) + Math.hypot(...s.rot) * (nudge ? 20 : 0);
          return { c, m };
        };
        const clone = s => ({ pos: [...s.pos], rot: [...s.rot], thumb: [...s.thumb], sc: [...s.sc] });
        const run = (start, nudge, n) => {
          let best = clone(start), be = ev(best, nudge), step = 1;
          for (let it = 0; it < n; it++) {
            const q = clone(best), cnt = 1 + Math.floor(rnd() * 2);
            for (let k = 0; k < cnt; k++) {
              const r = rnd();
              if (r < 0.5 || (!nudge && r < 0.75)) { const j = Math.floor(rnd() * 4); q.thumb[j] += gauss() * 9 * step; }
              else if (!nudge || r < 0.75) { const j = Math.floor(rnd() * 4); q.sc[j] = Math.max(0.4, Math.min(1.7, q.sc[j] + gauss() * 0.1 * step)); }
              else if (r < 0.88) q.pos[Math.floor(rnd() * 3)] += gauss() * 0.004 * step;
              else q.rot[Math.floor(rnd() * 3)] += gauss() * 0.08 * step;
            }
            q.thumb = q.thumb.map((v, k) => Math.max(HARD[k][0], Math.min(HARD[k][1], v)));
            q.pos = q.pos.map(v => Math.max(-0.03, Math.min(0.03, v)));
            const e = ev(q, nudge); if (e.c < be.c) { best = q; be = e; }
            if (it % 150 === 149) step = Math.max(0.3, step * 0.75);
          }
          return { best, be };
        };
        const starts = [[14, 20, 25, 15], [-25, 35, 40, 5], [-40, 45, 30, 10]];
        let top = null;
        for (const t of starts) { const r = run({ pos: [0, 0, 0], rot: [0, 0, 0], thumb: t, sc: [1, 1, 1, 1] }, false, Math.round(evals * 0.35)); if (!top || r.be.c < top.be.c) top = r; }
        const mm = top.be.m; if (mm.penetrationMm > 2.5 || !mm.thumbTouching || mm.thumbOppositionDeg < 120 || mm.fingersTouching < 3 || mm.palmGapMm > 5 || mm.palmGapMm < -2.5) { const r = run(top.best, true, evals); if (r.be.c < top.be.c) top = r; }
        const { wrist, rows } = build(top.best);
        L.player.resetTracking?.();
        const fin = L.measure(p.side, wrist, rows, { iterations: 40 });
        top.be.m = { ...fin, per: undefined };
        return { id: p.id, thumb: top.best.thumb, sc: top.best.sc, wrist: wrist.pos, quat: wrist.quat, nudged: Math.hypot(...top.best.pos) > 1e-9 || Math.hypot(...top.best.rot) > 1e-9, cost: top.be.c, m: { ...top.be.m, per: undefined }, rows };
      });
    }, { batch, evals, shape: CATALOG[kind].shape, tx, ty, tz, thumbHard: Object.values(HARD.Thumb), thumbComfort: COMFORT.Thumb });
    for (const r of out) { const v = verdict(r.m, r.rows); r.ok = v.ok; r.failures = v.failures; r.warnings = v.warnings; results[r.id] = r; }
    console.log(kind, i + batch.length, '/', poses.length, 'ok', Object.values(results).filter(r => r.ok).length);
  }
  const file = new URL(`thumb_fit_${kind}${process.env.TAG || ''}.json`, SCRATCH);
  await writeFile(file, JSON.stringify(results));
  console.log('wrote', fileURLToPath(file));
  console.log('errors', lab.errors.slice(0, 3));
} finally { await lab.close(); }
