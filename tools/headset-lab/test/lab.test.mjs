// Headset lab server test: starts the lab on a free port (127.0.0.1, own temp certificate, temp results file, temp
// Grasp Studio save files, no sync, no cloud publish) and checks the hub, the three app mounts, the studio endpoint's
// same-origin shim, the HMR socket paths and POST /api/results.
//   node --test tools/headset-lab/test/        (from GameSystems; needs the apps' node_modules and a prior sync)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GROUPS, testIndex } from '../hub/tests.js';

let lab, dir, resultsFile;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gs-headset-lab-test-'));
  resultsFile = join(dir, 'results.jsonl');
  process.env.GRASP_STUDIO_OUT = join(dir, 'recorded_grasps.json');
  process.env.GRASP_STUDIO_HAND_OUT = join(dir, 'recorded_hand.json');
  const { startLab } = await import('../serve.mjs');
  lab = await startLab({ port: 0, host: '127.0.0.1', resultsFile, certDir: join(dir, 'cert'), sync: false, publish: false, log: () => {} });
});
after(async () => { await lab?.close(); await rm(dir, { recursive: true, force: true }); });

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = https.request({ host: '127.0.0.1', port: lab.port, path, method, headers, rejectUnauthorized: false }, res => {
      const parts = []; res.on('data', c => parts.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', fail);
    req.end(body);
  });
}
const json = (path, body, headers = {}) => request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const origin = () => `https://127.0.0.1:${lab.port}`;

test('hub page, its scripts and the status api', async () => {
  const hub = await request('/');
  assert.equal(hub.status, 200);
  assert.match(hub.text, /GameSystems testlab/);
  for (const f of ['/hub/hub.js', '/hub/tests.js', '/hub/hub.css']) assert.equal((await request(f)).status, 200, f);
  const status = JSON.parse((await request('/api/status')).text);
  assert.equal(status.lab, 'gamesystems-headset-lab');
  for (const id of ['demo', 'studio', 'contracts']) assert.equal(status.apps[id].state, 'ok', `${id}: ${status.apps[id].error}`);
  assert.ok(status.certIps.includes('127.0.0.1'));
});

test('demo is served by Vite under /demo/ (pages, modules, GameSystems assets)', async () => {
  const redirect = await request('/demo?x=1');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/demo/?x=1');
  const page = await request('/demo/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Flaskedemo/);
  assert.match(page.text, /\/demo\/@vite\/client/);
  for (const p of ['/demo/systems.html', '/demo/src/main.js', '/demo/src/testpanel.js']) assert.equal((await request(p)).status, 200, p);
  const catalog = await request('/demo/assets/catalog.json');
  assert.equal(catalog.status, 200);
  assert.ok(JSON.parse(catalog.text));
});

test('studio under /studio/ with its save endpoints; same-origin POSTs pass the Origin check, cross-site ones do not', async () => {
  const page = await request('/studio/');
  assert.equal(page.status, 200);
  assert.match(page.text, /\/studio\/@vite\/client/);
  const lib = await request('/studio/api/grasps');
  assert.equal(lib.status, 200);
  assert.ok(Array.isArray(JSON.parse(lib.text).poses));
  // An unknown action reaches the store (400), so the lab's Origin was accepted; a foreign Origin is refused (403).
  assert.equal((await json('/studio/api/grasps', { action: 'nope' }, { origin: origin() })).status, 400);
  assert.equal((await json('/studio/api/grasps', { action: 'nope' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await json('/studio/api/hand', { action: 'nope' }, { origin: origin() })).status, 400);
});

test('contracts static files under /contracts/', async () => {
  const page = await request('/contracts/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Nightfall Contracts/);
  assert.equal((await request('/contracts/src/main.js')).status, 200);
  assert.match((await request('/contracts/src/main.js')).headers['content-type'], /javascript/);
  assert.equal((await request('/contracts/node_modules/three/package.json')).status, 404);
  assert.notEqual((await request('/contracts/..%2f..%2fGameSystems/README.md')).status, 200);
  assert.equal((await request('/contracts/.git/HEAD')).status, 404);
});

test('HMR sockets: each app has its own path on the lab server', async () => {
  const upgrade = path => new Promise(ok => {
    const req = https.request({ host: '127.0.0.1', port: lab.port, path, rejectUnauthorized: false, headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': 'vite-hmr' } });
    req.on('upgrade', (res, socket) => { socket.destroy(); ok(res.statusCode); });
    req.on('response', res => ok(res.statusCode));
    req.on('error', () => ok('closed'));
    req.end();
  });
  assert.equal(await upgrade('/demo/hmr'), 101);
  assert.equal(await upgrade('/studio/hmr'), 101);
  assert.equal(await upgrade('/elsewhere'), 'closed');
});

test('POST /api/results appends a line per verdict; bad input and cross-site posts are refused', async () => {
  const a = await json('/api/results', { id: 'studio-greb', verdict: 'virker', note: 'gemt fint', link: '/studio/' }, { origin: origin(), 'user-agent': 'OculusBrowser test' });
  assert.equal(a.status, 200, a.text);
  const b = await json('/api/results', { id: 'perf-mid', verdict: 'delvist' }, { origin: origin() });
  assert.equal(b.status, 200, b.text);
  const lines = (await readFile(resultsFile, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 'studio-greb');
  assert.equal(lines[0].verdict, 'virker');
  assert.equal(lines[0].note, 'gemt fint');
  assert.equal(lines[0].ua, 'OculusBrowser test');
  assert.ok(!Number.isNaN(Date.parse(lines[0].at)));
  assert.equal(lines[1].note, '');
  assert.equal((await json('/api/results', { id: 'studio-greb', verdict: 'maybe' })).status, 400);
  assert.equal((await json('/api/results', { id: 'no-such-test', verdict: 'fejl' })).status, 400);
  assert.equal((await json('/api/results', { id: 'studio-greb', verdict: 'fejl' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/results', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 400);
  const listed = JSON.parse((await request('/api/results')).text);
  assert.equal(listed.entries.length, 2);
});

test('test catalogue: unique ids, links on the lab mounts', () => {
  const ids = GROUPS.flatMap(g => g.tests.map(t => t.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(testIndex().size, ids.length);
  for (const g of GROUPS) for (const t of g.tests) {
    assert.ok(t.check.length && t.links.length, t.id);
    for (const [, href] of t.links) assert.match(href, /^\/(demo|studio|contracts)\//, `${t.id}: ${href}`);
  }
});
