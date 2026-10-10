// The character extensions (humanoid, avatar, character-cc) as synced into the demo: identical to GameSystems and to the
// Contracts game's copies (extensions plan step 5); the generated CharacterCreator modules identical to Contracts' copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const contracts = resolve(process.env.CONTRACTS_DIR || fileURLToPath(new URL('../../../NightfallContractsWebXR-interaction', import.meta.url)));
const files = dir => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name !== 'SYNCED.json').map(e => e.name).sort();
const same = (a, b, label) => {
  assert.deepEqual(files(a), files(b), `${label}: same file set`);
  for (const f of files(a)) assert.ok(readFileSync(resolve(a, f)).equals(readFileSync(resolve(b, f))), `${label}: ${f} differs`);
};

for (const name of ['humanoid', 'avatar', 'character-cc']) {
  const vendored = fileURLToPath(new URL(`../src/vendor/extensions/${name}/`, import.meta.url));
  test(`${name}: the demo copy is GameSystems/extensions/${name}`, () => same(vendored, fileURLToPath(new URL(`../../extensions/${name}/`, import.meta.url)), name));
  const theirs = resolve(contracts, 'src/extensions', name);
  test(`${name}: the Contracts game uses the same files`, { skip: !existsSync(theirs) && 'Contracts not next to GameSystems' }, () => same(vendored, theirs, `${name} (run npm run sync:extensions in Contracts)`));
}

const cc = fileURLToPath(new URL('../src/vendor/extensions/character-cc/vendor/cc/', import.meta.url));
test('generated CharacterCreator modules match Contracts\' copy (an MIT commit)', { skip: !existsSync(resolve(contracts, 'src/extensions/character-cc/vendor/cc/SYNCED.json')) && 'Contracts CharacterCreator files not generated' }, () => {
  const manifest = JSON.parse(readFileSync(resolve(cc, 'SYNCED.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, JSON.parse(readFileSync(resolve(contracts, 'src/extensions/character-cc/vendor/cc/SYNCED.json'), 'utf8')).sourceCommit);
  for (const f of ['character.js', 'humanoid.js', 'animation/canonical.js']) assert.ok(readFileSync(resolve(cc, f)).equals(readFileSync(resolve(contracts, 'src/extensions/character-cc/vendor/cc', f))), f);
});
