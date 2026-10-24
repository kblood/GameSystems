// JS <-> Godot parity: runs every golden vector in node (the JS core) and in Godot headless (GDScript), then requires the
// two sets of observations to be identical (numbers within 1e-7). Godot runs on a COPY of godot/ so the project's own
// .godot folder is never touched.
//   node extensions/backpack/tools/parity.mjs [--godot <path to Godot console exe>]
// Godot binary: --godot, $GODOT, or NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe.
import { readFile, cp, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApproach, runPull, runState, runProfile, runLedger, firstDiff } from './golden_runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const GODOT = arg('--godot') ?? process.env.GODOT ?? resolve(ROOT, '../NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe');

export async function jsObservations() {
  const golden = JSON.parse(await readFile(resolve(ROOT, 'extensions/backpack/data/backpack.golden.json'), 'utf8'));
  const files = { profiles: golden.profiles };
  const out = { approach: {}, pull: {}, state: {}, profileCases: {}, ledger: {} };
  for (const v of golden.approach) out.approach[v.name] = runApproach(v);
  for (const v of golden.pull) out.pull[v.name] = runPull(v);
  for (const v of golden.state) out.state[v.name] = runState(v, files);
  for (const v of golden.ledger) out.ledger[v.name] = runLedger(v, files);
  for (const v of golden.profileCases) out.profileCases[v.name] = runProfile(v);
  return { golden, out };
}

export async function godotObservations(exe = GODOT) {
  if (!existsSync(exe)) throw new Error(`Godot binary not found: ${exe}`);
  const work = await mkdtemp(join(tmpdir(), 'gs_backpack_parity_'));
  try {
    const project = join(work, 'godot'), dump = join(work, 'dump.json');
    await cp(resolve(ROOT, 'godot'), project, { recursive: true });
    const r = spawnSync(exe, ['--headless', '--path', project, '--script', 'res://addons/gs_backpack/tests/gs_backpack_parity_tests.gd', '--', `--dump=${dump}`], { encoding: 'utf8', timeout: 300000 });
    const summary = /GS_BACKPACK_PARITY .*/.exec(r.stdout ?? '')?.[0] ?? '(no summary)';
    return { status: r.status, summary, dump: existsSync(dump) ? JSON.parse(await readFile(dump, 'utf8')) : null, log: `${r.stdout}\n${r.stderr}` };
  } finally { await rm(work, { recursive: true, force: true }); }
}

export async function compareParity(exe = GODOT) {
  const js = await jsObservations(), gd = await godotObservations(exe);
  if (!gd.dump) throw new Error(`Godot produced no dump:\n${gd.log}`);
  let vectors = 0, ops = 0; const problems = [];
  for (const group of ['approach', 'pull', 'state', 'ledger', 'profileCases']) {
    for (const [name, expected] of Object.entries(js.out[group])) {
      vectors++; ops += Array.isArray(expected) ? expected.length : 1;
      const diff = firstDiff(gd.dump[group]?.[name], expected, `${group}/${name}`);
      if (diff) problems.push(diff);
    }
    for (const name of Object.keys(gd.dump[group] ?? {})) if (!(name in js.out[group])) problems.push(`${group}/${name}: only in Godot`);
  }
  return { vectors, ops, problems, godotStatus: gd.status, godotSummary: gd.summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await compareParity();
  console.log(`${r.godotSummary}\nparity: ${r.vectors} vectors, ${r.ops} ops, ${r.problems.length} differences (godot exit ${r.godotStatus})`);
  for (const p of r.problems.slice(0, 20)) console.error(p);
  process.exit(r.problems.length || r.godotStatus !== 0 ? 1 : 0);
}
