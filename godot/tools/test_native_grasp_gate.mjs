// Reusable guard tests for the narrowly scoped native-grasp promotion gate.
// Run: node godot/tools/test_native_grasp_gate.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_NAMES = [
  'grasp_sdf.golden.json', 'grasp_closure.golden.json', 'grasp_place_wrist.golden.json',
  'grasp_segment_gaps.golden.json', 'grasp_profile_geometry.golden.json', 'grasp_place_palm.golden.json',
  'grasp_close_finger.golden.json', 'grasp_close_all.golden.json', 'grasp_close_to_contact.golden.json',
];

function scratchRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'gamesystems-native-grasp-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of ['godot/tools', 'godot/addons/gs_grasp', 'godot/addons/gs_grasp_data',
    'extensions/host', 'extensions/humanoid', 'extensions/grasp']) {
    cpSync(join(ROOT, relative), join(root, relative), { recursive: true });
  }
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [join(root, 'godot/tools/gen_golden.mjs'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
}

function fixturePaths(root) {
  return FIXTURE_NAMES.map(name => join(root, 'godot/addons/gs_grasp/tests', name));
}

function incrementFirstNumber(value) {
  if (typeof value === 'number') return { changed: true, value: value + 0.001 };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const next = incrementFirstNumber(value[i]);
      if (next.changed) { value[i] = next.value; return { changed: true, value }; }
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const next = incrementFirstNumber(value[key]);
      if (next.changed) { value[key] = next.value; return { changed: true, value }; }
    }
  }
  return { changed: false, value };
}

test('persisted JSON semantic payloads preflight and refresh only the nine scoped fixtures', t => {
  const root = scratchRepo(t);
  // Seed stale provenance in the isolated copy so a successful refresh must
  // touch each target. The nine semantic payloads stay intact.
  for (const path of fixturePaths(root)) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.probe_sha256) data.probe_sha256 = 'stale';
    if (data.source_sha256) data.source_sha256 = 'stale';
    if (data.sources_sha256) for (const name of Object.keys(data.sources_sha256)) data.sources_sha256[name] = 'stale';
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  const goldenDir = join(root, 'godot/addons/gs_grasp/tests');
  const allGolden = readdirSync(goldenDir).filter(name => name.endsWith('.golden.json'));
  const targets = new Set(FIXTURE_NAMES);
  const unrelatedBefore = new Map(allGolden.filter(name => !targets.has(name))
    .map(name => [name, readFileSync(join(goldenDir, name))]));
  const result = run(root, '--native-grasp', '--refresh-metadata');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /70 supported cases; 45 excluded cases \(barrel, ladder, pole\)/);
  // JSON persistence maps generated -0 to 0; this fixture preflight must still pass.
  assert.equal((result.stdout.match(/^(?:written|ok) /gm) ?? []).length, 9, result.stdout);
  for (const [name, before] of unrelatedBefore)
    assert.deepEqual(readFileSync(join(goldenDir, name)), before, `${name} must not be touched`);
});

test('nonzero semantic change is refused before any fixture is written', t => {
  const root = scratchRepo(t);
  assert.equal(run(root, '--native-grasp', '--refresh-metadata').status, 0);
  const paths = fixturePaths(root);
  const changed = paths[1];
  const data = JSON.parse(readFileSync(changed, 'utf8'));
  assert.equal(incrementFirstNumber(data.cases[0].expected).changed, true);
  writeFileSync(changed, `${JSON.stringify(data, null, 2)}\n`);
  const before = paths.map(path => readFileSync(path));
  const result = run(root, '--native-grasp', '--refresh-metadata');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing metadata refresh: semantic payload changed/);
  assert.deepEqual(paths.map(path => readFileSync(path)), before);
});

test('native catalog provenance hash drift is visible in the focused check', t => {
  const root = scratchRepo(t);
  assert.equal(run(root, '--native-grasp', '--refresh-metadata').status, 0);
  const sdf = fixturePaths(root)[0];
  const data = JSON.parse(readFileSync(sdf, 'utf8'));
  data.sources_sha256['godot/addons/gs_grasp_data/data/catalog.data.json'] = 'stale';
  writeFileSync(sdf, `${JSON.stringify(data, null, 2)}\n`);
  const result = run(root, '--native-grasp', '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /STALE    godot\/addons\/gs_grasp\/tests\/grasp_sdf\.golden\.json/);
});

test('missing JS catalog kinds and exclusions fail closed', t => {
  const root = scratchRepo(t);
  const catalogPath = join(root, 'godot/addons/gs_grasp_data/data/catalog.data.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const supportedKind = Object.keys(catalog.CATALOG)[0];
  delete catalog.CATALOG[supportedKind];
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const missing = run(root, '--native-grasp', '--check');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /native SDF coverage changed|native shape differs/);

  // Add a generated case for an already-missing kind. The missing-kind set is
  // unchanged, so this independently exercises the explicit count guard.
  cpSync(join(ROOT, 'godot/addons/gs_grasp_data/data/catalog.data.json'), catalogPath);
  const probe = join(root, 'godot/tools/grasp_sdf_golden.mjs');
  let source = readFileSync(probe, 'utf8');
  assert.ok(source.includes('  return cases;\n}'));
  source = source.replace('  return cases;\n}', "  cases.push({ name: 'synthetic:extra-excluded', kind: 'barrel', point: [0, 0, 0], distance: 0, normal: [0, 1, 0] });\n  return cases;\n}");
  writeFileSync(probe, source);
  const exclusionDrift = run(root, '--native-grasp', '--check');
  assert.notEqual(exclusionDrift.status, 0);
  assert.match(exclusionDrift.stderr, /native SDF excluded case count changed/);
});

test('classifier normalizes persisted JSON and never writes drifted fixtures', t => {
  const root = scratchRepo(t);
  assert.equal(run(root, '--native-grasp', '--refresh-metadata').status, 0);
  const paths = fixturePaths(root);
  for (const path of paths)
    writeFileSync(path, `${JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))}\n`);
  const formatted = run(root, '--native-grasp', '--classify');
  assert.equal(formatted.status, 0, formatted.stderr || formatted.stdout);
  assert.match(formatted.stdout, /Summary: 9 stale \(0 provenance-only, 0 semantic-change, 9 format-only/);

  const provenance = JSON.parse(readFileSync(paths[1], 'utf8'));
  provenance.probe_sha256 = 'stale';
  writeFileSync(paths[1], JSON.stringify(provenance));
  const semantic = JSON.parse(readFileSync(paths[2], 'utf8'));
  assert.equal(incrementFirstNumber(semantic.cases[0].expected).changed, true);
  writeFileSync(paths[2], JSON.stringify(semantic));
  writeFileSync(paths[3], '{invalid');
  rmSync(paths[4]);
  const before = paths.map(path => {
    try { return readFileSync(path); } catch { return null; }
  });
  const classified = run(root, '--native-grasp', '--classify');
  assert.equal(classified.status, 0, classified.stderr || classified.stdout);
  assert.match(classified.stdout, /Summary: 9 stale \(1 provenance-only, 1 semantic-change, 5 format-only, 1 missing, 1 invalid-json\)/);
  assert.deepEqual(paths.map(path => {
    try { return readFileSync(path); } catch { return null; }
  }), before, 'read-only classification must leave every fixture unchanged');
});
