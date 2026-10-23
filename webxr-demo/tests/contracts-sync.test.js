// Extensions plan step 9: the Contracts game runs the shared host + bottles extensions. Its synced copies
// (Contracts/src/extensions/<name>, tools/sync_extensions.mjs there) must be the GameSystems source files, and the
// bottle assets it ships (Contracts/assets/gamesystems) must be the GameSystems ones (catalog paths, same bytes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const contracts = resolve(process.env.CONTRACTS_DIR || fileURLToPath(new URL('../../../NightfallContractsWebXR-interaction', import.meta.url)));
const gameSystems = fileURLToPath(new URL('../../', import.meta.url));
const files = dir => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name !== 'SYNCED.json').map(e => e.name).sort();
const skip = name => !existsSync(resolve(contracts, 'src/extensions', name)) && 'Contracts (with this extension) not next to GameSystems';

for (const name of ['host', 'bottles', 'audio']) {
  test(`${name}: the Contracts game uses the GameSystems files`, { skip: skip(name) }, () => {
    const ours = resolve(gameSystems, 'extensions', name), theirs = resolve(contracts, 'src/extensions', name);
    assert.deepEqual(files(theirs), files(ours), `${name}: same file set (run npm run sync:extensions in Contracts)`);
    for (const f of files(ours)) assert.ok(readFileSync(resolve(ours, f)).equals(readFileSync(resolve(theirs, f))), `${name}/${f} differs (run npm run sync:extensions in Contracts)`);
  });
}

test('the bottle assets Contracts ships are the GameSystems assets', { skip: !existsSync(resolve(contracts, 'assets/gamesystems/SYNCED.json')) && 'Contracts bottle assets not synced' }, () => {
  const dir = resolve(contracts, 'assets/gamesystems'), synced = JSON.parse(readFileSync(resolve(dir, 'SYNCED.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(resolve(gameSystems, 'catalog.json'), 'utf8'));
  const theirs = JSON.parse(readFileSync(resolve(dir, 'catalog.json'), 'utf8'));
  for (const a of theirs.assets) assert.deepEqual(a, catalog.assets.find(x => x.id === a.id), `${a.id}: catalog entry as in GameSystems`);
  for (const f of Object.keys(synced.files)) {
    if (f === 'catalog.json') continue;
    assert.ok(readFileSync(resolve(dir, f)).equals(readFileSync(resolve(gameSystems, f))), `${f} differs (run npm run sync:extensions in Contracts)`);
  }
});

test('the audio extension and its sounds (?audio in Contracts) are synced: every variant of the shipped groups is there and identical', { skip: !existsSync(resolve(contracts, 'assets/gamesystems/SYNCED.json')) && 'Contracts assets not synced' }, () => {
  const dir = resolve(contracts, 'assets/gamesystems'), synced = JSON.parse(readFileSync(resolve(dir, 'SYNCED.json'), 'utf8'));
  const data = JSON.parse(readFileSync(resolve(gameSystems, 'extensions/audio/sound_materials.json'), 'utf8'));
  const groups = ['contacts', 'hand', 'footsteps', 'creaks', 'bottles']; // AUDIO_GROUPS in Contracts' tools/sync_extensions.mjs
  let count = 0;
  for (const g of groups) for (const name of data.groups[g]) for (let i = 1; i <= data.sounds[name].variants; i++) {
    const f = `audio/ogg/${name}_${String(i).padStart(2, '0')}.ogg`; count++;
    assert.ok(synced.files[f], `${f} is synced to Contracts (npm run sync:extensions)`);
    assert.ok(readFileSync(resolve(dir, f)).equals(readFileSync(resolve(gameSystems, f))), `${f} differs`);
  }
  assert.ok(count >= 100, `${count} sounds`);
  const audioDir = resolve(contracts, 'src/extensions/audio');
  assert.ok(existsSync(resolve(audioDir, 'footsteps.js')) && existsSync(resolve(audioDir, 'creaks.js')) && existsSync(resolve(audioDir, 'sound_materials.json')));
  const gameAudio = readFileSync(resolve(contracts, 'src/game/audio.js'), 'utf8');
  assert.match(gameAudio, /sharedContext: getContext/, 'Contracts borrows the game AudioContext');
  assert.match(readFileSync(resolve(contracts, 'src/main.js'), 'utf8'), /params\.has\('audio'\)/, 'opt-in via ?audio');
});
