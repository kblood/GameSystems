// The GameSystems grasp extension as synced into the demo (src/vendor/extensions/grasp): runs without Contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as grasp from '../src/vendor/extensions/grasp/index.js';

const vendored = fileURLToPath(new URL('../src/vendor/extensions/grasp/', import.meta.url));
const source = fileURLToPath(new URL('../../extensions/grasp/', import.meta.url));
const contracts = resolve(process.env.CONTRACTS_DIR || fileURLToPath(new URL('../../../NightfallContractsWebXR-interaction', import.meta.url)), 'src/extensions/grasp');

function runtimeFiles(dir) {
  const files = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name !== 'SYNCED.json').map(e => e.name);
  const walk = (folder, prefix) => {
    for (const e of readdirSync(folder, { withFileTypes: true })) {
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(resolve(folder, e.name), rel); else if (rel.startsWith('data/')) files.push(rel);
    }
  };
  const data = resolve(dir, 'data');
  if (existsSync(data)) walk(data, 'data');
  return files.sort();
}

test('only the runtime files are synced (no tools), byte-identical to GameSystems/extensions/grasp', () => {
  const files = runtimeFiles(vendored);
  assert.ok(!existsSync(resolve(vendored, 'tools')), 'offline tooling is not copied into the runtime');
  assert.deepEqual(files, runtimeFiles(source));
  for (const f of files) assert.ok(readFileSync(resolve(vendored, f)).equals(readFileSync(resolve(source, f))), f);
});

test('the Contracts game uses the same grasp files (its src/extensions/grasp)', { skip: !existsSync(contracts) && 'Contracts not next to GameSystems' }, () => {
  const files = runtimeFiles(vendored);
  assert.deepEqual(runtimeFiles(contracts), files, 'same file set (run npm run sync:extensions in Contracts)');
  for (const f of files) assert.ok(readFileSync(resolve(vendored, f)).equals(readFileSync(resolve(contracts, f))), `${f} differs: run npm run sync:extensions in Contracts`);
});

test('every bottle/can body group has exactly one default grasp (grab_findings 1.3)', () => {
  for (const kind of ['bottle_beer', 'bottle_wine', 'can']) for (const side of ['left', 'right']) {
    const flagged = grasp.posesFor(kind, side).filter(p => p.grasp === 'body' && p.default);
    assert.equal(flagged.length, 1, `${kind}/${side}`);
    assert.equal(grasp.defaultPose(kind, side, 'body'), flagged[0]);
  }
});

test('runtime finger rows are clamped into the joint ranges, raw on request (grab_findings 1.4)', () => {
  const beer = grasp.defaultPose('bottle_beer', 'left', 'body');
  const over = { ...beer, angles: beer.angles.map((row, i) => i === 0 ? [row[0], 100, row[2], row[3]] : row) }; // thumb pitch > HARD
  assert.equal(grasp.graspQuality(), 'mid', "default: close-to-contact; without a character hand fingerState is 'low' (clamped)");
  for (const t of [0, 0.5, 1]) assert.ok(grasp.validateRows(grasp.rowsFromState(grasp.fingerState(over, t))).ok);
  assert.equal(grasp.runtimeRows(over), grasp.runtimeRows(over), 'memoised per pose');
  const mug = grasp.posesFor('mug', 'left')[0];
  assert.equal(grasp.runtimeRows(mug), mug, 'mug keeps its raw thumb (CLAMP_EXEMPT, grab_findings 3.1)');
  try {
    grasp.setGraspQuality('raw');
    assert.ok(!grasp.validateRows(grasp.rowsFromState(grasp.fingerState(over, 1))).ok);
    assert.equal(grasp.setGraspQuality('clamped'), 'low', "'clamped' is the step-2 name of 'low'");
  } finally { grasp.setGraspQuality('mid'); }
});

test('hold drive follows the hand: carried velocity v + w x r, mean of the last samples (grab_findings 1.5)', () => {
  const v = grasp.carriedVelocity([1, 0, 0], [0, 3, 0], [0, 0, 0], [0, 0, 0.1]);
  assert.ok(Math.abs(v[0] - 1.3) < 1e-12 && v[1] === 0 && Math.abs(v[2]) < 1e-12);
  const m = grasp.createHandMotion();
  grasp.pushHandMotion(m, [1, 0, 0], [0, 0, 0], 1 / 72); grasp.pushHandMotion(m, [3, 0, 0], [0, 0, 0], 1 / 72);
  assert.ok(Math.abs(m.linear[0] - 2) < 1e-12);
  for (let i = 0; i < grasp.HAND_MOTION_SAMPLES; i++) grasp.pushHandMotion(m, [0, 0, 0], [0, 0, 0], 1 / 72);
  assert.deepEqual(m.linear, [0, 0, 0], 'only the last HAND_MOTION_SAMPLES count');
});
test('hand motion ignores non-finite and nonpositive sample durations without changing its window', () => {
  const m = grasp.createHandMotion();
  grasp.pushHandMotion(m, [1, 2, 3], [4, 5, 6], 1 / 72);
  const before = structuredClone(m);
  for (const dt of [Infinity, -Infinity, NaN, 0, -1]) {
    assert.equal(grasp.pushHandMotion(m, [7, 8, 9], [10, 11, 12], dt), m);
    assert.deepEqual(m, before);
  }
});
