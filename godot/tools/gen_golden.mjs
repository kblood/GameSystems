// Golden files for the Godot gs_* addons, generated from the JS extensions (godot_port_plan.md, lag 2 a).
// The Godot tests compare their ports against these files, so a change on either side shows up as a test failure.
//   node godot/tools/gen_golden.mjs          (re)write the golden files
//   node godot/tools/gen_golden.mjs --check  exit 1 when a golden file is missing or out of date (writes nothing)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tierFor, normalizeTier } from '../../extensions/host/quality.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const rel = path => relative(ROOT, path).split('\\').join('/');

async function tierForGolden() {
  const source = resolve(ROOT, 'extensions/host/quality.js');
  const tierSets = [[], ['on'], ['off', 'on'], ['off', 'low', 'high'], ['minimal', 'low', 'mid', 'high'],
    ['off', 'low', 'mid', 'high', 'ultra'], ['t0', 't1', 't2', 't3', 't4', 't5', 't6']];
  const levels = [-1, 0, 0.25, 0.5, 1, 1.5, 2, 2.5, 2.999, 3, 3.5, 4, 7];
  const maxLevels = [3, 1, 2, 4, 5, 6, 0, -1];
  const cases = [];
  for (const tiers of tierSets) for (const maxLevel of maxLevels) for (const level of levels)
    cases.push({ tiers, level, max_level: maxLevel, expected: tierFor(tiers, level, maxLevel) ?? null });
  const normalize = [];
  for (const tiers of [['off', 'low', 'high'], ['minimal', 'low', 'mid', 'high']])
    for (const tier of ['off', 'low', 'mid', 'nope', '', 0, 1, 2, 3, -1])
      normalize.push({ tiers, tier, expected: normalizeTier(tiers, tier) ?? null });
  return {
    path: resolve(ROOT, 'godot/addons/gs_host/data/tier_for.golden.json'),
    data: { schema: 'gamesystems.golden.tier-for.v1', generator: 'godot/tools/gen_golden.mjs', source: rel(source),
      source_sha256: await sha256(source), cases, normalize },
  };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const { path, data } of [await tierForGolden()]) {
  // One case per line: small file, readable diffs.
  const text = '{\n' + Object.entries(data).map(([key, value]) => `\t${JSON.stringify(key)}: ` + (Array.isArray(value)
    ? `[\n${value.map(row => `\t\t${JSON.stringify(row)}`).join(',\n')}\n\t]` : JSON.stringify(value))).join(',\n') + '\n}\n';
  const old = await readFile(path, 'utf8').catch(() => null);
  if (old === text) { console.log(`ok       ${rel(path)}`); continue; }
  if (check) { stale++; console.log(`STALE    ${rel(path)}`); continue; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  console.log(`written  ${rel(path)} (${data.cases.length} cases)`);
}
if (stale) { console.error(`${stale} golden file(s) out of date: run node godot/tools/gen_golden.mjs`); process.exit(1); }
