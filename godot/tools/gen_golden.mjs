// Golden files for the Godot gs_* addons, generated from the JS extensions (godot_port_plan.md, lag 2 a).
// The Godot tests compare their ports against these files, so a change on either side shows up as a test failure.
//   node godot/tools/gen_golden.mjs          (re)write the golden files
//   node godot/tools/gen_golden.mjs --check  exit 1 when a golden file is missing or out of date (writes nothing)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearestGraspCases } from './nearest_grasp_golden.mjs';
import { graspMergeCases } from './grasp_merge_golden.mjs';
import { tierFor, normalizeTier } from '../../extensions/host/quality.js';
import { JOINT_NAMES } from '../../extensions/humanoid/canonical.js';
import { MPFB_ROOT_BONE } from '../../extensions/humanoid/rig.js';
import { MPFB_GAME_ENGINE, VRM_HUMANOID, VRM0_HUMANOID, mixamoBoneMap } from '../../extensions/humanoid/bone_maps.js';
import { HARD, COMFORT, GATES } from '../../extensions/grasp/grasp_validator.js';
import { CLOSURE, PAD_RADIUS, REFERENCE_HAND, THUMB_TILT } from '../../extensions/grasp/closure.js';
import { STIFFNESS, DAMPING, MAX_ACCELERATION, MAX_TORQUE, MAX_HOLD_FORCE, HAND_MOTION_SAMPLES } from '../../extensions/grasp/held_drive.js';
import { DEFAULT_MASS, CATALOG } from '../../extensions/grasp/catalog.js';
import { referenceHand, RECORDED_SCHEMA, recordedPoses, isPose } from '../../extensions/grasp/record.js';
import { BAKED, RECORDED, GRASP_QUALITY, CLAMP_EXEMPT, graspQuality, setGraspQuality } from '../../extensions/grasp/baked_grasps.js';

// Captured before any generator probes change the singleton quality selection.
const INITIAL_GRASP_QUALITY = graspQuality();

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

async function humanoidBoneMapsGolden() {
  const source = resolve(ROOT, 'extensions/humanoid/bone_maps.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  // Exercise the public JS API, not a second read of the copied JSON. In
  // particular, canonical.js owns the ordered joint list independently, and
  // Mixamo's public API adds a configurable prefix to the stored bare names.
  const expected = {
    schema: 'gamesystems.humanoid-bone-maps.v1', rootMotionBone: MPFB_ROOT_BONE,
    jointNames: JOINT_NAMES,
    maps: { mpfb: MPFB_GAME_ENGINE, vrm1: VRM_HUMANOID, vrm0: VRM0_HUMANOID, mixamo: mixamoBoneMap('') },
  };
  deepStrictEqual(contract, expected, 'Humanoid data contract differs from the public JS API');
  const sources = ['bone_maps.data.json', 'bone_maps.js', 'rig.js', 'canonical.js', 'qmath.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(sources.map(async name => {
    const path = resolve(ROOT, 'extensions/humanoid', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_humanoid/data/bone_maps.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_humanoid/data/bone_maps.golden.json'), data: {
      schema: 'gamesystems.golden.humanoid-bone-maps.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract: expected,
    }, pretty: true },
  ];
}

async function graspValidatorGolden() {
  const source = resolve(ROOT, 'extensions/grasp/data/validator.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  const expected = { schema: 'gamesystems.grasp-validator-data.v1', HARD, COMFORT, GATES };
  deepStrictEqual(contract, expected, 'Grasp validator data differs from the public JS API');
  const sources = [source, resolve(ROOT, 'extensions/grasp/grasp_validator.js')];
  const sources_sha256 = Object.fromEntries(await Promise.all(sources.map(async path => [rel(path), await sha256(path)])));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/validator.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/validator.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-validator-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract: expected,
    }, pretty: true },
  ];
}

async function graspClosureGolden() {
  const source = resolve(ROOT, 'extensions/grasp/data/closure.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  const expected = { schema: 'gamesystems.grasp-closure-data.v1', CLOSURE, PAD_RADIUS, REFERENCE_HAND, THUMB_TILT };
  deepStrictEqual(contract, expected, 'Grasp closure data differs from the public JS API');
  // Include the closure module and its complete local import graph.
  const names = ['data/closure.data.json', 'closure.js', 'catalog.js', 'data/catalog.data.json', 'grasp_validator.js', 'data/validator.data.json'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/closure.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/closure.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-closure-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract: expected,
    }, pretty: true },
  ];
}

async function graspHeldDriveGolden() {
  const source = resolve(ROOT, 'extensions/grasp/data/held_drive.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  const expected = { schema: 'gamesystems.grasp-held-drive-data.v1', STIFFNESS, DAMPING, MAX_ACCELERATION,
    MAX_TORQUE, MAX_HOLD_FORCE, HAND_MOTION_SAMPLES };
  deepStrictEqual(contract, expected, 'Grasp held-drive data differs from the public JS API');
  const names = ['data/held_drive.data.json', 'held_drive.js', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/held_drive.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/held_drive.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-held-drive-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract: expected,
    }, pretty: true },
  ];
}

async function graspCatalogGolden() {
  const source = resolve(ROOT, 'extensions/grasp/data/catalog.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  const expected = { schema: 'gamesystems.grasp-catalog-data.v1', DEFAULT_MASS, CATALOG };
  deepStrictEqual(contract, expected, 'Grasp catalog data differs from the public JS API');
  const names = ['data/catalog.data.json', 'catalog.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/catalog.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/catalog.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-catalog-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract: expected,
    }, pretty: true },
  ];
}

async function graspReferenceHandGolden() {
  const source = resolve(ROOT, 'extensions/grasp/reference_hand.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  deepStrictEqual(contract.schema, 'gamesystems.reference-hand.v1');
  const cases = ['left', 'right'].flatMap(side => [null, 1, 2].map(scale => {
    const expected = referenceHand(side, scale === null ? {} : { scale });
    // These raw lengths pass through the public API unchanged. The remaining
    // output is derived geometry, captured for future algorithm conformance.
    for (const finger of Object.keys(contract.hands[side].fingers))
      deepStrictEqual(expected.fingers[finger].len, contract.hands[side].fingers[finger].len);
    return { side, scale, expected };
  }));
  const names = ['reference_hand.json', 'record.js', 'closure.js', 'data/closure.data.json',
    'catalog.js', 'data/catalog.data.json', 'contact.js', 'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/reference_hand.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/reference_hand.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-reference-hand.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract, cases,
    }, pretty: true },
  ];
}

async function graspRecordedGolden() {
  const source = resolve(ROOT, 'extensions/grasp/recorded_grasps.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  deepStrictEqual(contract.schema, RECORDED_SCHEMA);
  const recorded = recordedPoses(contract);
  deepStrictEqual(recorded, RECORDED, 'Recorded file filtering differs from the public RECORDED export');
  const accepted_indices = [], rejected_indices = [];
  contract.poses.forEach((pose, index) => (isPose(pose) ? accepted_indices : rejected_indices).push(index));
  const names = ['recorded_grasps.json', 'baked_grasps.js', 'data/quality.data.json', 'baked_grasps.data.json', 'record.js', 'reference_hand.json',
    'closure.js', 'data/closure.data.json', 'catalog.js', 'data/catalog.data.json', 'contact.js',
    'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/recorded_grasps.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/recorded_grasps.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-recorded-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256,
      contract, recorded, accepted_indices, rejected_indices,
    }, pretty: true },
  ];
}

async function graspBakedGolden() {
  const source = resolve(ROOT, 'extensions/grasp/baked_grasps.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  deepStrictEqual(contract, BAKED, 'Canonical bake differs from the public BAKED export');
  const kind_counts = {};
  for (const pose of BAKED.poses) kind_counts[pose.kind] = (kind_counts[pose.kind] ?? 0) + 1;
  const names = ['baked_grasps.data.json', 'baked_grasps.js', 'data/quality.data.json', 'recorded_grasps.json', 'record.js', 'reference_hand.json',
    'closure.js', 'data/closure.data.json', 'catalog.js', 'data/catalog.data.json', 'contact.js',
    'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/baked_grasps.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/baked_grasps.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-baked-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, baked: BAKED,
      pose_ids: BAKED.poses.map(pose => pose.id), kind_counts,
      kinds_without_catalog: Object.keys(kind_counts).filter(kind => !Object.hasOwn(CATALOG, kind)),
    }, pretty: true },
  ];
}

async function graspQualityGolden() {
  const source = resolve(ROOT, 'extensions/grasp/data/quality.data.json');
  const contract = JSON.parse(await readFile(source, 'utf8'));
  const previous = graspQuality(), aliases = {}, selections = [];
  try {
    for (const name of Object.keys(contract.aliases)) aliases[name] = setGraspQuality(name);
    for (const input of GRASP_QUALITY) selections.push({ input, expected: setGraspQuality(input) });
  } finally { setGraspQuality(previous); }
  const api = { GRASP_QUALITY, CLAMP_EXEMPT, defaultQuality: INITIAL_GRASP_QUALITY, aliases };
  for (const [key, value] of Object.entries(api)) deepStrictEqual(contract[key], value, `Quality data differs from JS API: ${key}`);
  // exemptKeep is private JS configuration read directly from the contract; it
  // is intentionally not described as an independently exported API result.
  const names = ['data/quality.data.json', 'baked_grasps.js', 'baked_grasps.data.json', 'recorded_grasps.json',
    'record.js', 'reference_hand.json', 'closure.js', 'data/closure.data.json', 'catalog.js', 'data/catalog.data.json',
    'contact.js', 'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  return [
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/quality.data.json'), data: contract, pretty: true },
    { path: resolve(ROOT, 'godot/addons/gs_grasp_data/data/quality.golden.json'), data: {
      schema: 'gamesystems.golden.grasp-quality-data.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), source_sha256: await sha256(source), sources_sha256, contract, api, selections,
    }, pretty: true },
  ];
}

async function nearestGraspGolden() {
  const names = ['baked_grasps.data.json', 'baked_grasps.js', 'data/quality.data.json', 'recorded_grasps.json',
    'record.js', 'reference_hand.json', 'closure.js', 'data/closure.data.json', 'catalog.js', 'data/catalog.data.json',
    'contact.js', 'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const probe = resolve(ROOT, 'godot/tools/nearest_grasp_golden.mjs');
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/nearest_grasp.golden.json'), pretty: true, data: {
    schema: 'gamesystems.golden.nearest-grasp.v1', generator: 'godot/tools/gen_golden.mjs',
    probe: rel(probe), probe_sha256: await sha256(probe), sources_sha256, ...nearestGraspCases(),
  } };
}

async function graspMergeGolden() {
  const names = ['record.js', 'recorded_grasps.json', 'baked_grasps.data.json', 'reference_hand.json',
    'closure.js', 'data/closure.data.json', 'catalog.js', 'data/catalog.data.json', 'contact.js',
    'grasp_validator.js', 'data/validator.data.json', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const probe = resolve(ROOT, 'godot/tools/grasp_merge_golden.mjs');
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/grasp_merge.golden.json'), pretty: true, data: {
    schema: 'gamesystems.golden.grasp-merge.v1', generator: 'godot/tools/gen_golden.mjs',
    probe: rel(probe), probe_sha256: await sha256(probe), sources_sha256, cases: graspMergeCases(),
  } };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const output of [await tierForGolden(), ...await humanoidBoneMapsGolden(), ...await graspValidatorGolden(), ...await graspClosureGolden(), ...await graspHeldDriveGolden(), ...await graspCatalogGolden(), ...await graspReferenceHandGolden(), ...await graspRecordedGolden(), ...await graspBakedGolden(), ...await graspQualityGolden(), await nearestGraspGolden(), await graspMergeGolden()]) {
  const { path, data } = output;
  // One case per line: small file, readable diffs.
  const text = output.pretty ? `${JSON.stringify(data, null, 2)}\n` : '{\n' + Object.entries(data).map(([key, value]) => `\t${JSON.stringify(key)}: ` + (Array.isArray(value)
    ? `[\n${value.map(row => `\t\t${JSON.stringify(row)}`).join(',\n')}\n\t]` : JSON.stringify(value))).join(',\n') + '\n}\n';
  const old = await readFile(path, 'utf8').catch(() => null);
  if (old === text) { console.log(`ok       ${rel(path)}`); continue; }
  if (check) { stale++; console.log(`STALE    ${rel(path)}`); continue; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  console.log(`written  ${rel(path)}${data.cases ? ` (${data.cases.length} cases)` : ''}`);
}
if (stale) { console.error(`${stale} golden file(s) out of date: run node godot/tools/gen_golden.mjs`); process.exit(1); }
