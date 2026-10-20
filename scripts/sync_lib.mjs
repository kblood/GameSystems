// Shared helpers for the web apps' sync scripts (webxr-demo/scripts/sync-helpers.mjs, apps/grasp-studio/scripts/sync.mjs):
// copy GameSystems extensions and the optional CharacterCreator files of the character-cc extension (generated in the
// Contracts game, an MIT snapshot) into an app. Files are
// written only when their content changed, so a sync during a dev server or a test run does not trigger reloads or expose
// half-written files; a mirrored folder is owned by the sync (files gone upstream are removed).
import { readFile, writeFile, mkdir, readdir, rm, access, stat } from 'node:fs/promises';
import { resolve, dirname, relative, join, sep } from 'node:path';

export const exists = path => access(path).then(() => true, () => false);

/** Write only when different; returns true when written. */
export async function writeIfChanged(to, data) {
  const old = await readFile(to).catch(() => null);
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  if (old && old.equals(buf)) return false;
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, buf);
  return true;
}
export async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(p)); else out.push(p);
  }
  return out;
}
/**
 * Mirror a directory (or an explicit file list relative to it) into `to`, which it owns: changed files written, all other
 * files removed, except below the subfolders `keepDirs` names (relative to `to`; filled by another sync).
 */
export async function mirror(from, to, only = null, { keepDirs = [] } = {}) {
  const files = only ? only.map(f => resolve(from, f)) : await listFiles(from);
  const keep = new Set();
  let changed = 0;
  for (const file of files) {
    const target = resolve(to, relative(from, file));
    keep.add(target);
    const [a, b] = await Promise.all([stat(file), stat(target).catch(() => null)]);
    // Large binaries (avatar GLBs): size + mtime is enough; small files are compared by content.
    if (b && a.size === b.size && a.size > 1 << 20 && b.mtimeMs >= a.mtimeMs) continue;
    if (await writeIfChanged(target, await readFile(file))) changed++;
  }
  const kept = keepDirs.map(d => resolve(to, d) + sep);
  for (const stale of await listFiles(to)) if (!keep.has(stale) && !kept.some(d => stale.startsWith(d))) { await rm(stale); changed++; }
  await pruneEmpty(to);
  return changed;
}
export async function pruneEmpty(dir, root = true) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const e of entries) if (e.isDirectory()) await pruneEmpty(join(dir, e.name), false);
  if (!root && !(await readdir(dir)).length) await rm(dir, { recursive: true });
}
export const topLevelFiles = async dir => (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name);

/** Extensions whose subfolders are generated per game (never copied from GameSystems, never removed by syncExtensions). */
export const GENERATED_DIRS = { 'character-cc': ['vendor', 'assets'] };
/** Source subfolders that are part of a shared extension's public data (offline tooling stays private). */
export const SYNC_SUBDIRS = { grasp: ['data'], gore: ['data'] };

/**
 * Mirror GameSystems extensions into `vendorDir/extensions/<name>`, top-level modules plus explicitly listed data
 * subfolders (grasp's tools/ folder is offline tooling). Subfolders in GENERATED_DIRS are left alone. Returns the number
 * of changed files.
 */
export async function syncExtensions(gameSystems, vendorDir, names) {
  let changed = 0;
  for (const name of names) {
    const from = resolve(gameSystems, 'extensions', name);
    const files = await topLevelFiles(from);
    for (const subdir of SYNC_SUBDIRS[name] ?? [])
      files.push(...(await listFiles(resolve(from, subdir))).map(file => relative(from, file)));
    changed += await mirror(from, resolve(vendorDir, 'extensions', name), files, { keepDirs: GENERATED_DIRS[name] ?? [] });
  }
  return changed;
}

/**
 * The generated CharacterCreator files of the character-cc extension, taken from the Contracts game (which generates them
 * from an MIT CharacterCreator commit with npm run sync; CharacterCreator itself is GPL since 2026-10-03, so apps never
 * sync from it directly): Contracts src/extensions/character-cc/vendor/cc -> `vendorDir/extensions/character-cc/vendor/cc`
 * and the asset files `assetFiles({ hair, clothing })` returns (null: all) -> `assetsDir`. Also removes the old
 * `vendorDir/contracts` copy (the whole Contracts character plugin, before extensions plan step 5).
 * Returns { found, changed, assets } or, without the Contracts files, { found: false, kept } (kept: a previous copy is there).
 */
export async function syncCharacterAssets(contracts, vendorDir, assetsDir, assetFiles = null) {
  const cc = resolve(contracts, 'src/extensions/character-cc'), out = resolve(vendorDir, 'extensions/character-cc/vendor/cc');
  if (await exists(resolve(vendorDir, 'contracts'))) await rm(resolve(vendorDir, 'contracts'), { recursive: true });
  if (!await exists(resolve(cc, 'vendor/cc/character.js'))) return { found: false, kept: await exists(resolve(out, 'character.js')) };
  let changed = await mirror(resolve(cc, 'vendor/cc'), out);
  const assetsFrom = resolve(cc, 'assets');
  const only = assetFiles ? assetFiles({
    hair: JSON.parse(await readFile(resolve(assetsFrom, 'hair.json'), 'utf8')),
    clothing: JSON.parse(await readFile(resolve(assetsFrom, 'clothing.json'), 'utf8')),
  }) : null;
  if (only) for (const f of only) if (!await exists(resolve(assetsFrom, f))) throw new Error(`Avatar asset missing in Contracts: ${f}`);
  changed += await mirror(assetsFrom, assetsDir, only);
  return { found: true, changed, assets: only ? only.length : 'all' };
}
