#!/usr/bin/env node
// Create an ignored transient fixture for native-vs-current-JS SDF parity.
// Usage: node godot/tools/write_fresh_grasp_sdf_fixture.mjs --output godot/.godot/grasp-sdf-fresh.json
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CATALOG, DEFAULT_MASS } from '../../extensions/grasp/catalog.js';
import { signedDistance, surfaceNormal } from '../../extensions/grasp/catalog.js';
import { graspSdfCases } from './grasp_sdf_golden.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length !== 2 || !['--output', '--verify'].includes(args[0]))
  throw new Error('required: --output <path> OR --verify <path>');
const mode = args[0], path = resolve(args[1]);
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const cases = graspSdfCases().map(row => ({ ...row, shape: row.shape ?? CATALOG[row.kind].shape }));
if (cases.length !== 115) throw new Error(`expected 115 fresh JS SDF cases, got ${cases.length}`);
const axisCases = [];
const offset = [0.13, -0.27, 0.41];
for (const axis of ['x', 'y', 'z']) {
  const axisIndex = { x: 0, y: 1, z: 2 }[axis];
  const radialIndex = { x: 1, y: 0, z: 0 }[axis];
  const shape = { type: 'cylinder', radius: 0.5, half: 1.0, at: offset, axis };
  const points = [
    offset,
    offset.map((v, i) => v + (i === radialIndex ? 0.5 : 0)),
    offset.map((v, i) => v + (i === axisIndex ? 1.0 : 0)),
    offset.map((v, i) => v + (i === radialIndex ? 0.7 : 0)),
    offset.map((v, i) => v + (i === axisIndex ? 1.2 : 0)),
    offset.map((v, i) => v + (i === radialIndex ? 0.7 : 0) + (i === axisIndex ? 1.2 : 0)),
  ];
  for (const [index, point] of points.entries()) axisCases.push({ name: `axis:${axis}:${index}`, shape, point,
    distance: signedDistance(shape, point), normal: surfaceNormal(shape, point) });
}
const parts = { type: 'parts', parts: [
  { type: 'cylinder', axis: 'z', radius: 0.5, half: 1.0, at: [0.2, 0.1, -0.3] },
  { type: 'box', size: [0.2, 0.2, 0.2], at: [2.0, 0.0, 0.0] },
] };
for (const [index, point] of [
  [0.4, 0.1, -0.3], [0.2, 0.1, 0.7], [0.9, 0.1, -0.1], [0.9, 0.1, 0.9],
].entries()) axisCases.push({ name: `axis:parts:${index}`, shape: parts, point,
  distance: signedDistance(parts, point), normal: surfaceNormal(parts, point) });
const contract = JSON.parse(await readFile(resolve(root, 'extensions/grasp/data/catalog.data.json'), 'utf8'));
deepStrictEqual(contract, JSON.parse(JSON.stringify({ schema: 'gamesystems.grasp-catalog-data.v1', DEFAULT_MASS, CATALOG })), 'catalog contract differs from public JS exports');
deepStrictEqual(Object.keys(CATALOG).sort(), ['barrel', 'bottle_beer', 'bottle_wine', 'can', 'carton', 'ladder', 'mug', 'pole'], 'reviewed eight-kind scope changed');
if (axisCases.length !== 22) throw new Error('reviewed axis-probe scope changed');
const fixture = {
  schema: 'gamesystems.transient.grasp-sdf.v1',
  source: 'extensions/grasp/catalog.js + godot/tools/grasp_sdf_golden.mjs',
  source_sha256: {
    catalog: await sha256(resolve(root, 'extensions/grasp/catalog.js')),
    catalog_data: await sha256(resolve(root, 'extensions/grasp/data/catalog.data.json')),
    generator: await sha256(fileURLToPath(import.meta.url)),
    case_generator: await sha256(resolve(dirname(fileURLToPath(import.meta.url)), 'grasp_sdf_golden.mjs')),
  },
  catalog_contract: contract, cases, axis_cases: axisCases,
};
if (mode === '--verify') {
  const saved = JSON.parse(await readFile(path, 'utf8'));
  deepStrictEqual(saved.source_sha256, fixture.source_sha256, 'stale fresh-fixture source hashes');
  deepStrictEqual(saved, JSON.parse(JSON.stringify(fixture)), 'fresh-fixture semantic payload differs from current JS');
  console.log(JSON.stringify({ verified: path, case_count: cases.length, axis_case_count: axisCases.length, source_sha256: fixture.source_sha256 }));
} else {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(fixture)}\n`);
  console.log(JSON.stringify({ output: path, case_count: cases.length, axis_case_count: axisCases.length, source_sha256: fixture.source_sha256 }));
}
