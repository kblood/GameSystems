// Apply tools/fit_baked_thumbs.mjs results (tools/scratch/thumb_fit_<kind><TAG>.json) to ../baked_grasps.data.json.
// The library is rebuilt from the original Godot bake (tools/data/baked_before.json) for every kind given, so applying
// twice gives the same result: accepted fits replace the pose's angles (all five rows), wrist/quat when nudged and
// metrics; their open approach gets a relaxed thumb. Poses whose refit failed the grasp validator are dropped (their
// thumbs broke the joint limits). Other kinds and non-wrap poses are kept as they are in the library.
// Default flags (grab_findings 1.3): every grasp group (kind/side/grasp) that had a default in the bake keeps exactly
// one. When the old default was dropped, the flag moves to the `_r000_t+1` pose with the smallest |offset| (same
// azimuth, nearest height), else to the pose nearest the old default by nearestPose cost; ties go to the lower cost.
// usage: node tools/apply_grasp_fit.mjs <kind> [kind...] [--out <file>]     TAG=<suffix> reads thumb_fit_<kind><suffix>.json
//        node tools/apply_grasp_fit.mjs --defaults [--out <file>]           only repair the default flags
// Then sync the games (webxr-demo: npm run sync; Contracts: npm run sync:extensions) and run their tests.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict, FINGERS, GATES } from '../grasp_validator.js';
import { ANGLE_WEIGHT, quatAngle } from '../baked_grasps.js';

export const LIBRARY = new URL('../baked_grasps.data.json', import.meta.url);
export const BEFORE = new URL('./data/baked_before.json', import.meta.url);
export const SCRATCH = new URL('./scratch/', import.meta.url);
const OPEN_THUMB = [0, 10, 5, 5];
const r1 = v => Math.round(v * 100) / 100;
const group = p => `${p.kind}/${p.side}/${p.grasp}`;

/** Library with the kind's wrap poses rebuilt from `before` and the fit results applied. Pure. */
export function applyFit(data, before, kind, fit) {
  const current = new Map(data.poses.map(p => [p.id, p])), seen = new Set();
  let kept = 0, dropped = 0;
  const poses = before.poses.flatMap(p => {
    seen.add(p.id);
    if (p.kind !== kind || p.mode !== 'wrap') return current.has(p.id) ? [current.get(p.id)] : [];
    const f = fit[p.id];
    const v = f && verdict(f.m, f.rows, { wrap: true, gates: { ...GATES, palmGapMaxMm: 5 } });
    if (!f || !v.ok) { dropped++; return []; }
    kept++;
    const rows = FINGERS.map(n => f.rows[n].map(r1));
    const open = p.open.map((row, i) => i === 0 ? [...OPEN_THUMB] : row);
    const out = { ...p, angles: rows, open, fit: 'lab-v1', metrics: { penetrationMm: f.m.penetrationMm, palmGapMm: f.m.palmGapMm, thumbOppositionDeg: f.m.thumbOppositionDeg } };
    if (f.nudged) { out.wrist = f.wrist.map(x => Math.round(x * 1e5) / 1e5); out.quat = f.quat.map(x => Math.round(x * 1e5) / 1e5); }
    return [out];
  });
  for (const p of data.poses) if (!seen.has(p.id)) poses.push(p); // poses the bake never had stay
  const summary = { ...data.summary, [kind]: { ...data.summary[kind], accepted: kept, fitDropped: dropped } };
  return { data: { ...data, summary, poses }, kept, dropped };
}

/** Exactly one default per grasp group that had one in `before` (see the header). Returns { data, moved: [..] }. */
export function restoreDefaults(data, before) {
  const moved = [], poses = data.poses.map(p => ({ ...p }));
  for (const old of before.poses.filter(p => p.default)) {
    const list = poses.filter(p => group(p) === group(old));
    if (!list.length) continue;
    const flagged = list.filter(p => p.default);
    if (flagged.length === 1) continue;
    for (const p of flagged.slice(1)) p.default = false;
    if (flagged.length) continue;
    const cost = p => Math.hypot(...p.wrist.map((v, i) => v - old.wrist[i])) + ANGLE_WEIGHT * quatAngle(p.quat, old.quat);
    const offset = p => { const m = /o([+-]\d+(?:\.\d+)?)_r000_t\+1$/.exec(p.id); return m ? Math.abs(Number(m[1])) : null; };
    const same = list.filter(p => offset(p) != null), pool = same.length ? same : list;
    const rank = p => [same.length ? offset(p) : 0, cost(p)];
    const pick = pool.reduce((a, p) => { const x = rank(p), y = rank(a); return x[0] < y[0] - 1e-9 || (Math.abs(x[0] - y[0]) <= 1e-9 && x[1] < y[1]) ? p : a; });
    pick.default = true;
    moved.push({ group: group(old), from: old.id, to: pick.id });
  }
  return { data: { ...data, poses }, moved };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2), at = args.indexOf('--out'), out = at >= 0 ? args.splice(at, 2)[1] : null;
  const kinds = args.filter(a => !a.startsWith('--'));
  if (!kinds.length && !args.includes('--defaults')) { console.error('usage: node tools/apply_grasp_fit.mjs <kind> [kind...] | --defaults [--out file]'); process.exit(2); }
  const read = async url => JSON.parse(await readFile(url, 'utf8'));
  let data = await read(LIBRARY);
  const before = await read(BEFORE).catch(() => { throw new Error(`missing ${fileURLToPath(BEFORE)}: the original bake (Contracts tools/convert_baked_grasps.mjs output)`); });
  for (const kind of kinds) {
    const file = new URL(`thumb_fit_${kind}${process.env.TAG || ''}.json`, SCRATCH);
    const fit = await read(file).catch(() => { throw new Error(`missing ${fileURLToPath(file)}: run node tools/fit_baked_thumbs.mjs ${kind} first`); });
    const r = applyFit(data, before, kind, fit);
    data = r.data;
    console.log(kind, 'kept', r.kept, 'dropped', r.dropped);
  }
  const r = restoreDefaults(data, before);
  for (const m of r.moved) console.log(`default ${m.group}: ${m.from} -> ${m.to}`);
  await writeFile(out || LIBRARY, JSON.stringify(r.data));
  console.log('wrote', out || fileURLToPath(LIBRARY));
}
