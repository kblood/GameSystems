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
import { graspClampCases } from './grasp_clamp_golden.mjs';
import { graspSdfCases } from './grasp_sdf_golden.mjs';
import { graspVariantsCases } from './grasp_variants_golden.mjs';
import { tierFor, normalizeTier } from '../../extensions/host/quality.js';
import { JOINT_NAMES } from '../../extensions/humanoid/canonical.js';
import { MPFB_ROOT_BONE } from '../../extensions/humanoid/rig.js';
import { MPFB_GAME_ENGINE, VRM_HUMANOID, VRM0_HUMANOID, mixamoBoneMap } from '../../extensions/humanoid/bone_maps.js';
import { HARD, COMFORT, GATES } from '../../extensions/grasp/grasp_validator.js';
import { CLOSURE, PAD_RADIUS, REFERENCE_HAND, THUMB_TILT } from '../../extensions/grasp/closure.js';
import { STIFFNESS, DAMPING, MAX_ACCELERATION, MAX_TORQUE, MAX_HOLD_FORCE, HAND_MOTION_SAMPLES,
  accelerationLimit, driveAcceleration, driveAngular, createHandMotion, pushHandMotion, carriedVelocity } from '../../extensions/grasp/held_drive.js';
import { GLASS_BREAK_CONTACT_SPEED, RELEASE_SPEED_CAP, RELEASE_SPIN_CAP, RELEASE_WINDOW, RELEASE_SMOOTHING,
  SAMPLE_SPEED_CAP, SAMPLE_SPIN_CAP, HISTORY_SPAN, createThrowHistory, pushSample as pushThrowSample,
  releaseVelocity as throwReleaseVelocity, sampleFromPoses } from '../../extensions/grasp/throw_release.js';
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

async function graspHeldDriveMathGolden() {
  const source = resolve(ROOT, 'extensions/grasp/held_drive.js');
  const names = ['data/held_drive.data.json', 'held_drive.js', 'math.js'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const vec = value => value.map(Number);
  const linear = [
    { name: 'stationary-gravity-compensation', input: { position: [0, 0, 0], velocity: [0, 0, 0], targetPosition: [0, 0, 0], mass: 1, dt: 1 / 90 } },
    { name: 'moving-hand-feed-forward', input: { position: [0.02, -0.01, 0.03], velocity: [0.1, -0.2, 0], targetPosition: [0.12, 0.03, -0.04], targetVelocity: [0.3, 0.1, -0.2], mass: 0.75, dt: 1 / 72 } },
    { name: 'heavy-force-cap', input: { position: [-0.3, 0.1, 0.2], velocity: [0, 0, 0], targetPosition: [1.7, 1.1, -0.8], mass: 12, dt: 1 / 60 } },
    { name: 'custom-gravity', input: { position: [0, 0, 0], velocity: [0, 0, 0], targetPosition: [0.01, 0.02, 0.03], mass: 2, dt: 1 / 120, gravity: [1, -3, 0.5] } },
  ].map(row => ({ ...row, expected: vec(driveAcceleration(row.input)) }));
  const angular = [
    { name: 'angular-error', input: { angularError: [0.1, -0.2, 0.05], angularVelocity: [0.3, 0, -0.1], dt: 1 / 90 } },
    { name: 'spin-target', input: { angularError: [-0.03, 0.12, 0.08], angularVelocity: [1, -0.5, 0.2], targetSpin: [-0.2, 0.3, 0.1], dt: 1 / 72 } },
  ].map(row => ({ ...row, expected: vec(driveAngular(row.input)) }));
  const motion = createHandMotion();
  const pushes = [
    { linear: [1, 2, 3], angular: [0, 0.5, 0], dt: 0.01 },
    { linear: [-1, 0, 2], angular: [0.2, 0, 0], dt: 0.03 },
    { linear: [4, -2, 0], angular: [0, 0, -1], dt: 0.02 },
  ];
  const motion_steps = pushes.map(row => {
    pushHandMotion(motion, row.linear, row.angular, row.dt);
    return { samples: motion.samples.length, linear: vec(motion.linear), angular: vec(motion.angular) };
  });
  const carried = { linear: [1, 2, 3], angular: [0, 0, 2], pivot: [0.1, -0.2, 0.3], point: [0.6, 0.4, -0.1] };
  return {
    path: resolve(ROOT, 'godot/addons/gs_grasp/tests/held_drive.golden.json'), pretty: true,
    data: { schema: 'gamesystems.golden.grasp-held-drive-math.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), sources_sha256,
      limits: [0, 0.001, 1, 6, 100].map(mass => ({ mass, expected: accelerationLimit(mass) })),
      linear, angular, pushes, motion_steps,
      carried: { ...carried, expected: vec(carriedVelocity(carried.linear, carried.angular, carried.pivot, carried.point)) } },
  };
}

async function graspThrowReleaseGolden() {
  const source = resolve(ROOT, 'extensions/grasp/throw_release.js');
  const sources_sha256 = Object.fromEntries(await Promise.all([source, resolve(ROOT, 'extensions/grasp/math.js')]
    .map(async path => [rel(path), await sha256(path)])));
  const cases = [
    { name: 'recent-peak-decelerating', samples: [
      { dt: 0.02, linear: [0.5, 0, 0], angular: [0, 0, 0] },
      { dt: 0.02, linear: [2, 0, 0], angular: [0, 1, 0] },
      { dt: 0.02, linear: [4, 0, 0], angular: [0, 2, 0] },
      { dt: 0.02, linear: [2, 0, 0], angular: [0, 0.5, 0] },
      { dt: 0.02, linear: [0.5, 0, 0], angular: [0, 0, 0] },
    ] },
    { name: 'speed-and-spin-caps', samples: [
      { dt: 0.04, linear: [30, 0, 0], angular: [0, 0, 50] },
    ] },
    { name: 'stale-peak-outside-window', samples: [
      { dt: 0.04, linear: [7, 0, 0], angular: [0, 1, 0] },
      { dt: 0.04, linear: [0.5, 0, 0], angular: [0, 0, 0] },
      { dt: 0.04, linear: [0.25, 0, 0], angular: [0, 0, 0] },
    ] },
    { name: 'partial-smoothing-window', samples: [
      { dt: 0.015, linear: [0, 2, 0], angular: [1, 0, 0] },
      { dt: 0.03, linear: [0, 4, 0], angular: [2, 0, 0] },
    ] },
  ].map(row => ({ ...row, expected: throwReleaseVelocity(row.samples) }));
  const pushes = [
    { linear: [0, 0, -2], angular: [0, 1, 0], dt: 1 / 72 },
    { linear: [0, 0, -4], angular: [0, 2, 0], dt: 1 / 72 },
    { linear: [0, 0, -6], angular: [0, 3, 0], dt: 1 / 72 },
    { linear: [0, 0, -3], angular: [0, 1.5, 0], dt: 1 / 72 },
    { linear: [0, 0, -1], angular: [0, 0.5, 0], dt: 1 / 72 },
    { linear: [0, 0, -12], angular: [0, 40, 0], dt: 0.08 },
  ];
  const history = createThrowHistory();
  const push_steps = pushes.map(row => {
    pushThrowSample(history, row.linear, row.angular, row.dt);
    return { samples: history.samples.map(s => ({ dt: s.dt, linear: s.linear, angular: s.angular })),
      linear: history.linear, angular: history.angular };
  });
  const pose_cases = [
    { name: 'identity-to-y-quarter-turn', previous: { pos: [0.1, 1.2, -0.4], quat: [0, 0, 0, 1] },
      current: { pos: [0.2, 1.4, -0.1], quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }, dt: 0.1 },
    { name: 'noncommuting-nonidentity-rotations', previous: { pos: [-0.3, 0.5, 1.1], quat: [Math.sin(0.3), 0, 0, Math.cos(0.3)] },
      current: { pos: [-0.2, 0.45, 1.3], quat: [0, Math.sin(0.45), 0, Math.cos(0.45)] }, dt: 1 / 72 },
    { name: 'negative-w-equivalent-current', previous: { pos: [0, 0.2, 0], quat: [Math.sin(0.3), 0, 0, Math.cos(0.3)] },
      current: { pos: [0.05, 0.25, -0.1], quat: [0, -Math.sin(0.45), 0, -Math.cos(0.45)] }, dt: 0.02 },
  ].map(row => ({ ...row, expected: sampleFromPoses(row.previous, row.current, row.dt) }));
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/throw_release.golden.json'), pretty: true,
    data: { schema: 'gamesystems.golden.grasp-throw-release.v1', generator: 'godot/tools/gen_golden.mjs',
      source: rel(source), sources_sha256,
      constants: { GLASS_BREAK_CONTACT_SPEED, RELEASE_SPEED_CAP, RELEASE_SPIN_CAP, RELEASE_WINDOW,
        RELEASE_SMOOTHING, SAMPLE_SPEED_CAP, SAMPLE_SPIN_CAP, HISTORY_SPAN },
      cases, pushes, push_steps, pose_cases } };
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

async function graspClampGolden() {
  const names = ['grasp_validator.js', 'data/validator.data.json', 'baked_grasps.data.json'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const probe = resolve(ROOT, 'godot/tools/grasp_clamp_golden.mjs');
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/grasp_clamp.golden.json'), pretty: true, data: {
    schema: 'gamesystems.golden.grasp-clamp.v1', generator: 'godot/tools/gen_golden.mjs',
    probe: rel(probe), probe_sha256: await sha256(probe), sources_sha256, cases: graspClampCases(),
  } };
}

async function graspSdfGolden() {
  const names = ['catalog.js', 'data/catalog.data.json'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const probe = resolve(ROOT, 'godot/tools/grasp_sdf_golden.mjs');
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/grasp_sdf.golden.json'), pretty: true, data: {
    schema: 'gamesystems.golden.grasp-sdf.v1', generator: 'godot/tools/gen_golden.mjs',
    probe: rel(probe), probe_sha256: await sha256(probe), sources_sha256, cases: graspSdfCases(),
  } };
}

async function graspVariantsGolden() {
  const names = ['baked_grasps.js', 'record.js', 'baked_grasps.data.json', 'recorded_grasps.json'];
  const sources_sha256 = Object.fromEntries(await Promise.all(names.map(async name => {
    const path = resolve(ROOT, 'extensions/grasp', name);
    return [rel(path), await sha256(path)];
  })));
  const probe = resolve(ROOT, 'godot/tools/grasp_variants_golden.mjs');
  return { path: resolve(ROOT, 'godot/addons/gs_grasp/tests/grasp_variants.golden.json'), pretty: true, data: {
    schema: 'gamesystems.golden.grasp-variants.v1', generator: 'godot/tools/gen_golden.mjs',
    probe: rel(probe), probe_sha256: await sha256(probe), sources_sha256, cases: graspVariantsCases(),
  } };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const output of [await tierForGolden(), ...await humanoidBoneMapsGolden(), ...await graspValidatorGolden(), ...await graspClosureGolden(), ...await graspHeldDriveGolden(), await graspHeldDriveMathGolden(), await graspThrowReleaseGolden(), ...await graspCatalogGolden(), ...await graspReferenceHandGolden(), ...await graspRecordedGolden(), ...await graspBakedGolden(), ...await graspQualityGolden(), await nearestGraspGolden(), await graspMergeGolden(), await graspClampGolden(), await graspSdfGolden(), await graspVariantsGolden()]) {
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
