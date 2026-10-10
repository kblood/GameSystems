#!/usr/bin/env node
// GameSystems character-vrm extension, node only: fetch the CC0 test VRM model(s) (models.js) from their official source
// into ./assets/<id>/ next to this file (gitignored: no binaries in git) and verify size + sha256. The file is data only
// (never executed). Usage:
//   node extensions/character-vrm/fetch_model.mjs [id ...]      default: every model in MODELS
//   node extensions/character-vrm/fetch_model.mjs --check        verify what is there, download nothing (exit 1 if missing/bad)
// Env ASSETS_DIR overrides the target folder. Downloads go to a .part file and are renamed only after the hash matches.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './models.js';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(process.env.ASSETS_DIR || resolve(here, 'assets'));
const args = process.argv.slice(2), check = args.includes('--check');
const ids = args.filter(a => !a.startsWith('--'));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** 'ok' | 'missing' | 'bad' for a model already on disk. */
export async function verifyModel(model, dir = assets) {
  const buf = await readFile(resolve(dir, model.file)).catch(() => null);
  if (!buf) return 'missing';
  return buf.length === model.size && sha256(buf) === model.sha256 ? 'ok' : 'bad';
}

async function fetchModel(model) {
  const target = resolve(assets, model.file);
  if (await verifyModel(model) === 'ok') { console.log(`${model.id}: ok (${target})`); return true; }
  if (check) { console.error(`${model.id}: ${await verifyModel(model)} (${target}); run node ${fileURLToPath(import.meta.url)} ${model.id}`); return false; }
  console.log(`${model.id}: downloading ${model.url}`);
  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${model.id}: HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  const hash = sha256(buf);
  if (buf.length !== model.size || hash !== model.sha256) throw new Error(`${model.id}: size ${buf.length} / sha256 ${hash} do not match models.js (${model.size} / ${model.sha256}); not saved`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(`${target}.part`, buf);
  await rm(target, { force: true });
  await rename(`${target}.part`, target);
  console.log(`${model.id}: saved ${target} (${buf.length} bytes, sha256 ${hash}; licence ${model.licence}, ${model.licencePage})`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = ids.length ? ids.map(id => MODELS[id] ?? (() => { throw new Error(`unknown model ${id}`); })()) : Object.values(MODELS);
  let ok = true;
  for (const model of list) ok = await fetchModel(model) && ok;
  process.exit(ok ? 0 : 1);
}
