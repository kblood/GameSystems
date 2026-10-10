// GameSystems character-cc extension: generates the CharacterCreator files this extension loads (node only; never imported
// by the browser modules). Forked from the Contracts asset sync (tools/sync_assets.mjs), originally from CharacterCreatorXR
// (MIT, Copyright (c) 2026 Kasper Olesen). Reads the CharacterCreator repo, never writes to it (no git commands either:
// the commit is read from .git/HEAD as a plain file). Writes only:
//   <assetsDir>  CharacterCreator output GLBs, manifests, sidecars and animation JSON      (default <extension>/assets)
//   <vendorDir>  CharacterCreator web modules, original relative layout + SYNCED.json      (default <extension>/vendor/cc)
// Both are GENERATED: never edit them, re-run the sync. Each game runs it into its own copy of the extension:
//   Contracts: npm run sync (tools/sync_assets.mjs) -> src/extensions/character-cc/{assets,vendor/cc}
//   standalone: node sync_cc.mjs [--source <CharacterCreator>] [--commit <sha>] [--out <character-cc dir>] [--dry] [--no-anim]
// Licence: CharacterCreator is GPL-3.0-or-later since 2026-10-03 (commits up to 0d78054 were MIT). The generated
// vendor/cc modules carry the licence of the synced commit; the assets are CC0 (see the source's LICENSE-NOTES.md).
import { readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Required files fail the sync when missing; optional ones are copied when present.
export const ASSET_RULES = [
  { re: /^base_body\.glb$/, required: true },
  { re: /^base_body\.joints\.json$/, required: true },
  { re: /^hair\.json$/ },
  { re: /^hair_[\w-]+\.glb$/ },
  { re: /^clothing\.json$/ },
  { re: /^clothing_[\w-]+\.glb$/ },
  { re: /^body_colliders\.json$/ },
  { re: /^asset_licenses\.json$/ },
];
export const WEB_FILES = ['character.js', 'clothing.js', 'clothing_rules.js', 'materials.js', 'humanoid.js', 'eyelife.js', 'breastphysics.js'];
export const WEB_DIRS = ['animation', 'cloth'];

/** True when `dir` looks like the CharacterCreator repo (web/character.js and output/). */
export const isCharacterCreator = dir => existsSync(join(dir, 'web', 'character.js')) && existsSync(join(dir, 'output'));

/** Source commit from .git/HEAD (plain file reads), or null. */
export function sourceCommit(src) {
  try {
    const head = readFileSync(join(src, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5), loose = join(src, '.git', ...ref.split('/'));
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    const packed = readFileSync(join(src, '.git', 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(` ${ref}`));
    return packed ? packed.split(' ')[0] : `${ref} (unresolved)`;
  } catch { return null; }   // not a git checkout: fine
}

/**
 * Copies CharacterCreator output/ and web/ modules. manifestRoot: paths in SYNCED.json are relative to it (the game root).
 * Returns { files: [{ file, bytes, sha256 }], commit, bytes }. Throws when the source is not CharacterCreator or a required
 * asset is missing.
 */
export function syncCharacterCreator({ source, assetsDir, vendorDir, manifestRoot = dirname(assetsDir), commit = null, dry = false,
  withAnim = true, manifestNote = 'SYNCED COPIES from the CharacterCreator repo (character-cc sync_cc.mjs). Do not edit; re-run the sync instead.', log = console } = {}) {
  const src = resolve(source);
  if (!isCharacterCreator(src)) throw new Error(`sync: ${src} does not look like the CharacterCreator repo (web/character.js, output/ missing).`);
  const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
  const copied = [];
  function copy(from, to) {
    const st = statSync(from);
    copied.push({ file: relative(manifestRoot, to).replace(/\\/g, '/'), bytes: st.size, sha256: sha(from) });
    if (dry) return;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  // ---- assets ----
  const outFiles = readdirSync(join(src, 'output')).filter(f => statSync(join(src, 'output', f)).isFile());
  for (const rule of ASSET_RULES) {
    const hits = outFiles.filter(f => rule.re.test(f));
    if (!hits.length && rule.required) throw new Error(`sync: required asset missing: output/${rule.re.source}`);
    for (const f of hits) copy(join(src, 'output', f), join(assetsDir, f));
  }
  if (withAnim && existsSync(join(src, 'output', 'animations'))) {
    for (const f of readdirSync(join(src, 'output', 'animations')).filter(f => f.endsWith('.json'))) {
      copy(join(src, 'output', 'animations', f), join(assetsDir, 'animations', f));
    }
  }
  // ---- shared web modules (keep their relative layout: humanoid.js imports ./animation/...) ----
  if (!dry && existsSync(vendorDir)) rmSync(vendorDir, { recursive: true, force: true });   // drop files deleted upstream
  for (const f of WEB_FILES) {
    const p = join(src, 'web', f);
    if (existsSync(p)) copy(p, join(vendorDir, f));
    else log.warn(`sync: web/${f} not found upstream (skipped)`);
  }
  for (const d of WEB_DIRS) {
    const dir = join(src, 'web', d);
    if (!existsSync(dir)) { log.warn(`sync: web/${d}/ not found upstream (skipped)`); continue; }
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'))) copy(join(dir, f), join(vendorDir, d, f));
  }
  // Any other plain module in web/ that the synced files import (future splits, e.g. a sex/breast helper).
  const importsOf = file => [...readFileSync(file, 'utf8').matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)].map(m => m[1]);
  const queue = copied.filter(c => resolve(manifestRoot, c.file).startsWith(resolve(vendorDir))).map(c => resolve(manifestRoot, c.file));
  const seen = new Set(queue);
  while (!dry && queue.length) {
    const f = queue.pop();
    for (const spec of importsOf(f)) {
      const target = resolve(dirname(f), spec);
      if (seen.has(target) || existsSync(target)) { seen.add(target); continue; }
      const upstream = join(src, 'web', relative(vendorDir, target));
      if (existsSync(upstream)) { copy(upstream, target); seen.add(target); queue.push(target); }
      else log.warn(`sync: ${relative(manifestRoot, f)} imports ${spec}, not found upstream`);
    }
  }
  // ---- manifest ----
  commit = commit || sourceCommit(src);
  const manifest = {
    note: `${manifestNote} sourceCommit is the checked-out commit (or --commit for an exported tree); a checkout may contain uncommitted changes on top of it.`,
    sourceKind: existsSync(join(src, '.git')) ? 'checkout' : 'export',
    syncedAt: new Date().toISOString(), sourceCommit: commit,
    files: copied,
  };
  if (!dry) {
    mkdirSync(vendorDir, { recursive: true }); mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(vendorDir, 'SYNCED.json'), JSON.stringify(manifest, null, 1));
    writeFileSync(join(assetsDir, 'SYNCED.txt'), 'Synced copies of CharacterCreator/output (character-cc sync_cc.mjs). Do not edit.\n');
  }
  return { files: copied, commit, bytes: copied.reduce((s, c) => s + c.bytes, 0) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const here = dirname(fileURLToPath(import.meta.url)), out = resolve(arg('--out') || here);
  const source = resolve(arg('--source') || arg('--src') || process.env.CC_SRC || join(here, '..', '..', '..', 'CharacterCreator'));
  try {
    const r = syncCharacterCreator({ source, assetsDir: join(out, 'assets'), vendorDir: join(out, 'vendor', 'cc'), manifestRoot: out,
      commit: arg('--commit'), dry: argv.includes('--dry'), withAnim: !argv.includes('--no-anim') });
    console.log(`sync_cc: ${r.files.length} files, ${(r.bytes / 1e6).toFixed(2)} MB ${argv.includes('--dry') ? '(dry run)' : 'copied'}; source commit ${r.commit ?? 'n/a'}`);
  } catch (error) { console.error(error.message); console.error('Pass --source <path> or set CC_SRC.'); process.exit(2); }
}
