// Copies shared code into Grasp Studio (helpers shared with the bottle demo: ../../../scripts/sync_lib.mjs):
//   - GameSystems extensions host, grasp, humanoid, avatar, character-cc -> src/vendor/extensions (top-level files only;
//     generated, gitignored)
//   - optional: character-cc's generated CharacterCreator files from the Contracts game (vendor/cc, an MIT snapshot) and
//     the twin's assets -> public/avatar-assets, for the avatar twin (src/avatar.js). Without them the studio runs with
//     the reference hand only, unless REQUIRE_CONTRACTS=1.
//   - the character-vrm test model (hash-verified, GameSystems/extensions/character-vrm/fetch_model.mjs) -> public/vrm-assets
//     for ?character=vrm (src/character-select.js).
// The studio's copy of extensions/grasp is what the page runs; recordings are written to the SOURCE
// (GameSystems/extensions/grasp/recorded_grasps.json) by the dev-server endpoint, so a save never reloads the page.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncExtensions, syncCharacterAssets } from '../../../scripts/sync_lib.mjs';
import { avatarAssetFiles } from '../src/avatar-config.js';
import { syncVRMAssets } from '../../../extensions/character-vrm/sync_vrm.mjs';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const gameSystems = resolve(projectRoot, '../..');
const vendor = resolve(projectRoot, 'src/vendor');

const EXTENSIONS = ['host', 'grasp', 'humanoid', 'avatar', 'character-cc', 'character-vrm'];
const ext = await syncExtensions(gameSystems, vendor, EXTENSIONS);
console.log(`Synced GameSystems extensions (${EXTENSIONS.join(', ')})${ext ? `: ${ext} file(s) changed` : ''}`);

const contracts = resolve(process.env.CONTRACTS_DIR || resolve(gameSystems, '../NightfallContractsWebXR-interaction'));
const synced = await syncCharacterAssets(contracts, vendor, resolve(projectRoot, 'public/avatar-assets'), avatarAssetFiles);
if (!synced.found) {
  const message = `CharacterCreator files not found in ${contracts}/src/extensions/character-cc (set CONTRACTS_DIR; run npm run sync there); `
    + (synced.kept ? 'using the previously synced avatar.' : 'the studio runs without the avatar twin.');
  if (process.env.REQUIRE_CONTRACTS === '1') { console.error(message); process.exit(1); }
  console.warn(message);
} else console.log(`Synced CharacterCreator files (character-cc) and ${synced.assets} avatar asset files${synced.changed ? ` (${synced.changed} changed)` : ''}`);
await syncVRMAssets(gameSystems, resolve(projectRoot, 'public/vrm-assets'));
