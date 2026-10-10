// The sync script and the avatar asset allowlist (grab_findings 1.7, 1.8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avatarAssetFiles, DEMO_AVATAR } from '../src/avatar-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const missing = fileURLToPath(new URL('./no-such-contracts-repo', import.meta.url));
const sync = env => spawnSync(process.execPath, ['scripts/sync-helpers.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

test('sync succeeds without the Contracts repo, and fails only when REQUIRE_CONTRACTS=1', () => {
  // Without Contracts the script only touches files whose content changed, so this run is a no-op for other tests.
  const ok = sync({ CONTRACTS_DIR: missing, REQUIRE_CONTRACTS: '' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /CharacterCreator files not found/);
  assert.ok(existsSync(new URL('../src/vendor/extensions/host/index.js', import.meta.url)), 'extensions are always synced');
  const strict = sync({ CONTRACTS_DIR: missing, REQUIRE_CONTRACTS: '1' });
  assert.equal(strict.status, 1);
});

test('the build never imports the Contracts modules statically', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /from '\.\/avatar\.js'|vendor\/contracts|character-cc/);
  assert.match(main, /import\('\.\/avatar\.js'\)/);
  assert.ok(!existsSync(new URL('../src/vendor/contracts', import.meta.url)), 'the old Contracts plugin copy is removed by the sync');
  for (const f of readdirSync(new URL('../src', import.meta.url)).filter(f => f.endsWith('.js') && f !== 'contracts.js')) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /from '\.\/vendor\/(contracts|extensions\/character-cc)\//, `${f} must go through contracts.js`);
  }
});

const manifests = {
  hair: { default: 'short02', styles: [{ id: 'short02', file: 'hair_short02.glb' }, { id: 'bob02', file: 'hair_bob02.glb' }] },
  clothing: { underwearSlots: ['underwear', 'bra'], defaultUnderwear: { male: ['briefs'], female: ['panties', 'bra'] },
    items: ['briefs:underwear', 'panties:underwear', 'bra:bra', 'shirt:top', 'jeans:bottom', 'shoes:shoes', 'jacket:outerwear']
      .map(s => { const [id, slot] = s.split(':'); return { id, slot, file: `clothing_${id}.glb` }; }) },
};

test('avatar asset allowlist: body, manifests, the chosen hair, the outfit and the default underwear only', () => {
  const files = avatarAssetFiles(manifests);
  assert.deepEqual(files.sort(), ['SYNCED.txt', 'asset_licenses.json', 'base_body.glb', 'base_body.joints.json', 'clothing.json',
    'clothing_briefs.glb', 'clothing_jeans.glb', 'clothing_shirt.glb', 'clothing_shoes.glb', 'hair.json', 'hair_short02.glb'].sort());
  assert.ok(avatarAssetFiles(manifests, DEMO_AVATAR, { cloth: true }).includes('body_colliders.json'));
  const female = avatarAssetFiles(manifests, { ...DEMO_AVATAR, sex: 'female', hair: 'bob02' });
  assert.ok(female.includes('clothing_panties.glb') && female.includes('clothing_bra.glb') && female.includes('hair_bob02.glb'));
  assert.ok(!avatarAssetFiles(manifests, { ...DEMO_AVATAR, outfit: ['briefs', 'shirt'] }).includes('clothing_panties.glb'));
  assert.throws(() => avatarAssetFiles(manifests, { ...DEMO_AVATAR, outfit: ['cape'] }), /cape/);
});

const assets = new URL('../public/avatar-assets/', import.meta.url);
test('synced avatar assets are exactly the allowlist', { skip: !existsSync(new URL('hair.json', assets)) && 'avatar assets not synced' }, () => {
  const real = { hair: JSON.parse(readFileSync(new URL('hair.json', assets))), clothing: JSON.parse(readFileSync(new URL('clothing.json', assets))) };
  const expected = avatarAssetFiles(real).sort();
  if (process.env.AVATAR_ASSETS !== 'all') assert.deepEqual(readdirSync(assets).sort(), expected);
  for (const f of expected) assert.ok(existsSync(new URL(f, assets)), f);
});
