// Copies shared code into the demo. Files are written only when their content changed, so a sync during a dev
// server or a test run does not trigger reloads or expose half-written files (helpers: ../../scripts/sync_lib.mjs,
// shared with apps/grasp-studio).
//   - GameSystems extensions (host, adapters, bottles, grasp, humanoid, avatar, character-cc, ... gore, ai, hitreact) -> src/vendor/extensions
//     (top-level modules plus grasp/data; grasp's tools/ folder is offline tooling). The three.js liquid/design helpers that used to be
//     copied from shaders/three and designs/three live in the bottles extension since extensions plan step 8.
//   - optional: the character-cc extension's generated CharacterCreator files from the Contracts game (an MIT snapshot it
//     generates with its own npm run sync): vendor/cc -> src/vendor/extensions/character-cc/vendor/cc, and the avatar's
//     assets -> public/avatar-assets. The demo never syncs from CharacterCreator itself (GPL since 2026-10-03).
// Never fails when the Contracts repo is missing (the demo then runs without the avatar), unless REQUIRE_CONTRACTS=1.
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avatarAssetFiles } from '../src/avatar-config.js';
import { syncExtensions, syncCharacterAssets } from '../../scripts/sync_lib.mjs';
import { syncVRMAssets } from '../../extensions/character-vrm/sync_vrm.mjs';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = resolve(projectRoot, '..');
const vendor = resolve(projectRoot, 'src/vendor');

// Old generated copies of the liquid/design helpers (now in the bottles extension).
for (const old of ['bottle_liquid.js', 'liquid_lut_v2.js', 'bottle_design.js']) await rm(resolve(vendor, old), { force: true });

// Extensions: source of truth is GameSystems/extensions. Generated copies, do not edit them in src/vendor/extensions.
// mirror() owns each target folder, so every extension gets its own.
const EXTENSIONS = ['host', 'adapters', 'bottles', 'grasp', 'humanoid', 'avatar', 'character-cc', 'character-vrm',
  'mechanics', 'electricity', 'materials', 'thermal', 'tools', 'acoustics', 'audio', 'workshop', 'pools', 'smoke', 'checkpoint', 'supply', 'sprinklers', 'vehicle', 'cameras', 'pool-interest', 'flow', 'coatings', 'alarms', 'missions', 'gore', 'ai', 'hitreact', 'backpack', 'furniture', 'flamethrower', 'fire-fx'];
const ext = await syncExtensions(src, vendor, EXTENSIONS);
console.log(`Synced GameSystems extensions (${EXTENSIONS.join(', ')})${ext ? `: ${ext} file(s) changed` : ''}`);

// CharacterCreator files of character-cc, generated in the sibling Contracts repo (src/extensions/character-cc/{vendor/cc,
// assets}). Source: CONTRACTS_DIR or ../../NightfallContractsWebXR-interaction. Generated files, never edit the copies.
// Avatar assets: only what the demo's avatar loads (grab_findings 1.8); AVATAR_ASSETS=all copies everything.
const contracts = resolve(process.env.CONTRACTS_DIR || resolve(src, '../NightfallContractsWebXR-interaction'));
const synced = await syncCharacterAssets(contracts, vendor, resolve(projectRoot, 'public/avatar-assets'),
  process.env.AVATAR_ASSETS === 'all' ? null : avatarAssetFiles);
if (!synced.found) {
  const message = `CharacterCreator files not found in ${contracts}/src/extensions/character-cc (set CONTRACTS_DIR; run npm run sync there). `
    + (synced.kept ? 'Using the previously synced copy.' : 'The demo runs without the avatar.');
  if (process.env.REQUIRE_CONTRACTS === '1') { console.error(message); process.exit(1); }
  console.warn(message);
} else {
  console.log(`Synced CharacterCreator files (character-cc) and ${synced.assets} avatar asset files${synced.changed ? ` (${synced.changed} changed)` : ''}`);
}

// character-vrm's CC0 test model(s) for ?character=vrm (src/character-select.js): GameSystems/extensions/character-vrm/assets
// (gitignored; fetched with a sha256 check by its fetch_model.mjs) -> public/vrm-assets (gitignored). Optional.
await syncVRMAssets(src, resolve(projectRoot, 'public/vrm-assets'));
