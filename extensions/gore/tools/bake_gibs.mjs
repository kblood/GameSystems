#!/usr/bin/env node
// Bakes the gore gib data for a MakeHuman / CharacterCreator topology: the base body and every garment / hair .glb found
// next to it are split along the authored seams (../seams.js) into region pieces with stump caps (bake_core.mjs), and
// written as <out>/<name>.gibs.json + .gibs.bin (../bake_format.js). One bake covers every slider setting: pieces keep
// their skin weights and morph targets, caps are recipes over the seam vertices.
//
//   node extensions/gore/tools/bake_gibs.mjs [--assets <dir>] [--out <dir>] [--name makehuman_cc] [--check]
//     --assets  folder with base_body.glb, base_body.joints.json, clothing_*.glb, hair_*.glb
//               (default: webxr-demo/public/avatar-assets, the synced CharacterCreator output)
//     --out     default: extensions/gore/data
//     --check   bake in memory and compare with the files in --out (exit 1 when they differ); writes nothing
// Re-run after changing seams.js / regions.js or when the CharacterCreator assets change topology (the runtime refuses a
// bake whose vertex counts / position hashes don't match the loaded meshes and falls back to unsplit severing).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGLB } from './glb.mjs';
import { bakeCharacter } from './bake_core.mjs';
import { encodeGibs } from '../bake_format.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');

/** Loads the meshes of a CharacterCreator asset folder: body ('base' = the skin mesh) first, then garments and hair. */
export function loadAssetMeshes(assets) {
  const body = readGLB(join(assets, 'base_body.glb'));
  const meshes = body.meshes;
  const extra = readdirSync(assets).filter(f => /^(clothing|hair)_.*\.glb$/.test(f)).sort();
  for (const f of extra) for (const m of readGLB(join(assets, f)).meshes) meshes.push({ ...m, name: m.name });
  const sidecar = JSON.parse(readFileSync(join(assets, 'base_body.joints.json'), 'utf8'));
  return { meshes, sidecar, files: ['base_body.glb', ...extra] };
}

export function bakeAssets(assets, name = 'makehuman_cc') {
  const { meshes, sidecar, files } = loadAssetMeshes(assets);
  const bake = bakeCharacter({ meshes, sidecar, topology: name });
  const { json, bin } = encodeGibs(bake);
  json.files = files;
  return { bake, json, bin, text: JSON.stringify(json) };
}

const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 16);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const assets = resolve(arg('--assets', join(ROOT, 'webxr-demo/public/avatar-assets')));
  const out = resolve(arg('--out', join(here, '../data')));
  const name = arg('--name', 'makehuman_cc');
  const t0 = performance.now();
  const { json, bin, text } = bakeAssets(assets, name);
  const ms = performance.now() - t0;
  const jsonPath = join(out, `${name}.gibs.json`), binPath = join(out, `${name}.gibs.bin`);
  for (const m of json.meshes) {
    const open = m.stats.loops.flatMap(l => l.loops.filter(x => !x.closed)).length;
    console.log(`${m.name.padEnd(16)} ${String(m.source.triangleCount).padStart(6)} tris -> ${String(m.buffers.tris.length / 3).padStart(6)}  +${m.newVertexCount} verts  caps ${m.caps.length}  conflicts ${m.stats.conflicts}${open ? `  open loop fragments ${open}` : ''}`);
  }
  console.log(`baked ${json.meshes.length} meshes in ${ms.toFixed(0)} ms: json ${(text.length / 1024).toFixed(0)} KB, bin ${(bin.length / 1024).toFixed(0)} KB, sha ${sha(text)}/${sha(bin)}`);
  if (process.argv.includes('--check')) {
    const same = existsSync(jsonPath) && existsSync(binPath) && readFileSync(jsonPath, 'utf8') === text && Buffer.compare(readFileSync(binPath), Buffer.from(bin)) === 0;
    console.log(same ? 'check: data is up to date' : `check: ${jsonPath} is stale, re-run without --check`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(jsonPath, text);
  writeFileSync(binPath, bin);
  console.log(`wrote ${jsonPath} and ${binPath}`);
}
