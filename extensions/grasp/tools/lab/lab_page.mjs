// Node helper: open the grasp lab page headless (SwiftShader), return { page, errors, close }.
// The lab needs the avatar (Contracts character plugin + its synced assets and Three.js) next to the grasp extension,
// so a tiny static server mounts both: /grasp/ = GameSystems/extensions/grasp, /contracts/ = the Contracts repo
// (CONTRACTS_DIR, default ../NightfallContractsWebXR-interaction next to GameSystems). Chrome is launched through
// the Contracts tools/browser.mjs (puppeteer-core lives in its node_modules). Test tooling only.
// CHARACTER=vrm (env, or openLab({ character: 'vrm' })): the hand is the character-vrm test model instead of the
// CharacterCreator one, posed by the GameSystems avatar extension (/extensions/ = GameSystems/extensions); three-vrm comes
// from an app's node_modules (THREE_VRM_DIR, default GameSystems/webxr-demo/node_modules/@pixiv/three-vrm) and the model from
// character-vrm/assets (fetch it with extensions/character-vrm/fetch_model.mjs).
import { createServer } from 'node:http';
import { readFile, stat, access } from 'node:fs/promises';
import { join, dirname, resolve, normalize, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const grasp = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const extensions = resolve(grasp, '..');
export const threeVRM = resolve(process.env.THREE_VRM_DIR || join(extensions, '..', 'webxr-demo', 'node_modules', '@pixiv', 'three-vrm'));
export const contracts = resolve(process.env.CONTRACTS_DIR || join(grasp, '..', '..', '..', 'NightfallContractsWebXR-interaction'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2' };

/** Static server over named mounts { '/prefix/': dir }; resolves to { url, close() }. */
export function serveMounts(mounts) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), prefix = Object.keys(mounts).find(m => path.startsWith(m));
      if (!prefix) { res.writeHead(404).end(); return; }
      const root = resolve(mounts[prefix]), file = normalize(join(root, path.slice(prefix.length)));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if (!(await stat(file).catch(() => null))?.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, () => ok({ url: `http://localhost:${server.address().port}/`, close: () => new Promise(r => server.close(r)) }));
  });
}

export async function openLab({ errors = [], width = 960, height = 720, character = process.env.CHARACTER || 'cc' } = {}) {
  for (const f of ['packages/character-plugin/src/index.js', 'src/extensions/character-cc/assets/base_body.glb', 'vendor/three/build/three.module.js', 'tools/browser.mjs']) {
    await access(join(contracts, f)).catch(() => { throw new Error(`grasp lab needs the Contracts repo with synced assets: ${join(contracts, f)} missing (set CONTRACTS_DIR, run npm run sync there)`); });
  }
  const { launch } = await import(pathToFileURL(join(contracts, 'tools/browser.mjs')).href);
  if (character === 'vrm') for (const f of [join(threeVRM, 'lib/three-vrm.module.js'), join(extensions, 'character-vrm/assets')]) {
    await access(f).catch(() => { throw new Error(`grasp lab CHARACTER=vrm needs ${f} (npm install in webxr-demo; node extensions/character-vrm/fetch_model.mjs)`); });
  }
  const server = await serveMounts({ '/grasp/': grasp, '/contracts/': contracts, '/extensions/': extensions, '/three-vrm/': threeVRM });
  const browser = await launch({ width, height, gpu: true });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${server.url}grasp/tools/lab/index.html?character=${encodeURIComponent(character)}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', { timeout: 240000, polling: 250 });
  return { page, errors, close: async () => { await context.close().catch(() => {}); await browser.close(); await server.close(); } };
}
