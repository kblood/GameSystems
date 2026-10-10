// GameSystems character-vrm extension, node only: copy the fetched test VRM model(s) (./assets/<id>/..., see
// fetch_model.mjs, gitignored) into an app's public folder (e.g. webxr-demo/public/vrm-assets). Only models whose
// sha256 matches models.js are copied (the download is untrusted data); the target folder is owned by this sync (other
// files are removed). Never fails when nothing was fetched: it warns, and only ?character=vrm is unavailable.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { MODELS } from './models.js';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(p)); else out.push(p);
  }
  return out;
}

/**
 * gameSystems: the GameSystems folder; to: target folder. Returns { models: [ids copied or up to date], missing: [ids],
 * changed }. A target file with the right size and hash is left alone (no dev-server reloads).
 */
export async function syncVRMAssets(gameSystems, to, { quiet = false } = {}) {
  const from = resolve(gameSystems, 'extensions/character-vrm/assets');
  const models = [], missing = [], keep = new Set();
  let changed = 0;
  for (const model of Object.values(MODELS)) {
    const buf = await readFile(resolve(from, model.file)).catch(() => null);
    if (!buf || buf.length !== model.size || sha256(buf) !== model.sha256) { missing.push(model.id); continue; }
    const target = resolve(to, model.file);
    keep.add(target);
    const old = await readFile(target).catch(() => null);
    if (!old || !old.equals(buf)) { await mkdir(dirname(target), { recursive: true }); await writeFile(target, buf); changed++; }
    models.push(model.id);
  }
  for (const stale of await listFiles(to)) if (!keep.has(stale)) { await rm(stale); changed++; }
  if ((await stat(to).catch(() => null)) && !(await listFiles(to)).length) await rm(to, { recursive: true });
  if (!quiet) {
    if (models.length) console.log(`Synced VRM test model(s) ${models.join(', ')} -> ${relative(process.cwd(), to) || to}${changed ? ` (${changed} changed)` : ''}`);
    if (missing.length) console.warn(`VRM test model(s) ${missing.join(', ')} not fetched (?character=vrm unavailable): node ${resolve(gameSystems, 'extensions/character-vrm/fetch_model.mjs')}`);
  }
  return { models, missing, changed };
}
