// GameSystems headset test lab: every pending Quest 3 test behind ONE HTTPS origin on the LAN (README.md).
//
//   https://<lan-ip>:8443/            hub page (hub/): the tests, checklists, feedback buttons, server status
//   https://<lan-ip>:8443/demo/       webxr-demo (Vite dev server in middleware mode, base /demo/, HMR at /demo/hmr)
//   https://<lan-ip>:8443/studio/     apps/grasp-studio (same, base /studio/; its /api/grasps and /api/hand save to disk)
//   https://<lan-ip>:8443/contracts/  NightfallContractsWebXR-interaction (static files, like its tools/serve.mjs)
//   /api/status, /api/results (GET, POST -> docs/headset_results.jsonl), /api/sync (POST: re-run the app syncs)
//
// One origin = one certificate exception in the headset. The apps' own `npm run dev` / tests / adb flow are untouched:
// the lab loads each app's vite.config.js through the app's own Vite and only overrides base, middleware mode, the HMR
// socket and the dependency cache folder (node_modules/.vite-headset-lab, so it never fights a running `npm run dev`).
//
//   node serve.mjs [--port 8443] [--no-sync] [--no-publish]      (or double-click "Start GameSystems testlab.cmd")
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureCert, ipv4Addresses, primaryIPv4 } from './cert.mjs';
import { publishLan, CLOUD } from './publish.mjs';
import { GROUPS, VERDICTS, testIndex } from './hub/tests.js';

export const LAB_ID = 'gamesystems-headset-lab';
export const DEFAULT_PORT = 8443;
const HERE = dirname(fileURLToPath(import.meta.url));
const GS = resolve(HERE, '../..');
const HUB = join(HERE, 'hub');
export const PATHS = Object.freeze({
  gameSystems: GS,
  demo: join(GS, 'webxr-demo'),
  studio: join(GS, 'apps/grasp-studio'),
  contracts: resolve(process.env.CONTRACTS_DIR || join(GS, '../NightfallContractsWebXR-interaction')),
  results: join(GS, 'docs/headset_results.jsonl'),
  cert: join(HERE, 'cert'),
});
// The Vite apps: mount path, root, the sync script `npm run sync` runs (predev), and request rewrites.
const VITE_APPS = {
  demo: { title: 'Flaskedemo', root: PATHS.demo, sync: 'scripts/sync-helpers.mjs' },
  studio: { title: 'Grasp Studio', root: PATHS.studio, sync: 'scripts/sync.mjs' },
};
const MAX_RESULT_BODY = 16 * 1024;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.map': 'application/json' };

const send = (res, status, body, headers = {}) => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store', ...headers });
  res.end(data);
};

/** Static file under root for a decoded path; dotfiles and node_modules are never served. */
async function serveStatic(req, res, root, path) {
  if (path.split('/').some(s => s.startsWith('.') || s === 'node_modules')) return send(res, 404, 'not found');
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, 'forbidden');
  let st = await stat(file).catch(() => null);
  if (st?.isDirectory()) { file = join(file, 'index.html'); st = await stat(file).catch(() => null); }
  if (!st?.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/** A same-origin request: no Origin header (curl, navigation) or an Origin whose host:port is this server's Host. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const parts = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { fail(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

/** Results log: one JSON object per line. */
export async function readResults(file) {
  const text = await readFile(file, 'utf8').catch(() => '');
  const out = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}

/** Validate a feedback POST body -> the line to append (throws { status, message }). */
export function resultEntry(body, { ua = '', index = testIndex() } = {}) {
  const bad = message => Object.assign(new Error(message), { status: 400 });
  if (!body || typeof body !== 'object') throw bad('body must be a JSON object');
  const hit = index.get(body.id);
  if (!hit) throw bad(`unknown test id ${body.id}`);
  if (!Object.hasOwn(VERDICTS, body.verdict)) throw bad(`verdict must be one of ${Object.keys(VERDICTS).join(', ')}`);
  const note = body.note == null ? '' : String(body.note).slice(0, 4000);
  const link = typeof body.link === 'string' && body.link.startsWith('/') ? body.link.slice(0, 300) : undefined;
  return { id: hit.test.id, title: hit.test.title, group: hit.group.title, verdict: body.verdict, note, link, at: new Date().toISOString(), ua: String(ua).slice(0, 400) };
}

/** Run an app's sync script (what `npm run sync` runs) -> { ok, output }. */
export function runSync(root, script, { timeout = 180000 } = {}) {
  return new Promise(ok => {
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, env: process.env });
    let output = '';
    const timer = setTimeout(() => { output += '\n(timeout)'; child.kill(); }, timeout);
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', e => { clearTimeout(timer); ok({ ok: false, output: output + e.message }); });
    child.on('close', code => { clearTimeout(timer); ok({ ok: code === 0, output: output.trim() }); });
  });
}

async function fileInfo(file, key) {
  const st = await stat(file).catch(() => null);
  if (!st) return { exists: false };
  let count = null;
  try { count = JSON.parse(await readFile(file, 'utf8'))[key]?.length ?? null; } catch {}
  return { exists: true, count, mtime: st.mtime.toISOString() };
}

const nonEmptyDir = dir => { try { return readdirSync(dir).length > 0; } catch { return false; } };

/** Probe an https URL (self-signed allowed) -> parsed JSON or null. */
export function probe(url, timeout = 3000) {
  return new Promise(ok => {
    const req = https.get(url, { rejectUnauthorized: false, timeout }, res => {
      let body = ''; res.on('data', d => { body += d; });
      res.on('end', () => { try { ok(JSON.parse(body)); } catch { ok(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

/**
 * Start the lab. Resolves to { server, port, url (localhost), lanUrl, status(), close() }.
 * Options: port (0 = any free), host, resultsFile, certDir, sync, publish, apps (subset of demo/studio/contracts), log.
 * Rejects with code 'LAB_RUNNING' when the lab already listens on the port, 'EADDRINUSE' for another program.
 */
export async function startLab({ port = DEFAULT_PORT, host = '0.0.0.0', resultsFile = PATHS.results, certDir = PATHS.cert,
  sync = true, publish = true, apps = ['demo', 'studio', 'contracts'], log = m => console.log(m) } = {}) {
  const startedAt = new Date().toISOString();
  const ip = await primaryIPv4();
  const tls = await ensureCert(certDir, { required: ip === '127.0.0.1' ? [] : [ip], include: ipv4Addresses().map(a => a.address), log: m => log(`[lab] ${m}`) });
  const appState = Object.fromEntries(apps.map(id => [id, { state: 'starting', path: `/${id}/`, error: null }]));
  const vites = {};
  const index = testIndex();
  let published = { state: publish ? 'pending' : 'disabled' };
  let syncState = { state: sync ? 'pending' : 'disabled', at: null, detail: {} };
  let lanUrl = null;

  async function status() {
    const recGrasps = process.env.GRASP_STUDIO_OUT || join(GS, 'extensions/grasp/recorded_grasps.json');
    const recHand = process.env.GRASP_STUDIO_HAND_OUT || join(GS, 'extensions/avatar/recorded_hand.json');
    return {
      lab: LAB_ID, startedAt, url: lanUrl, ip, port: actualPort, certFile: tls.file, certIps: tls.ips,
      apps: appState, sync: syncState, published, cloudPage: CLOUD.pageUrl, resultsFile,
      extras: {
        vrmModel: nonEmptyDir(join(PATHS.demo, 'public/vrm-assets')),
        vrmSource: nonEmptyDir(join(GS, 'extensions/character-vrm/assets')),
        ccAvatar: existsSync(join(PATHS.demo, 'src/vendor/extensions/character-cc/vendor/cc/character.js')),
        recordedGrasps: await fileInfo(recGrasps, 'poses'),
        recordedHand: await fileInfo(recHand, 'clips'),
      },
    };
  }

  async function api(req, res, path) {
    if (path === '/api/status' && (req.method === 'GET' || req.method === 'HEAD')) return send(res, 200, await status());
    if (path === '/api/tests' && req.method === 'GET') return send(res, 200, { groups: GROUPS, verdicts: VERDICTS });
    if (path === '/api/results' && req.method === 'GET') {
      const entries = await readResults(resultsFile);
      return send(res, 200, { file: resultsFile, entries: entries.slice(-500) });
    }
    if ((path === '/api/results' || path === '/api/sync') && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'cross-site request refused' });
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 400, { ok: false, error: 'Content-Type must be application/json' });
      try {
        const text = await readBody(req, MAX_RESULT_BODY);
        if (path === '/api/sync') return send(res, 200, { ok: true, sync: await syncAll() });
        const entry = resultEntry(JSON.parse(text || 'null'), { ua: req.headers['user-agent'], index });
        await mkdir(dirname(resultsFile), { recursive: true });
        await appendFile(resultsFile, JSON.stringify(entry) + '\n');
        log(`[lab] resultat: ${entry.id} = ${entry.verdict}${entry.note ? ` (${entry.note.slice(0, 60)})` : ''}`);
        return send(res, 200, { ok: true, entry });
      } catch (error) {
        return send(res, error.status || (error instanceof SyntaxError ? 400 : 500), { ok: false, error: error.message });
      }
    }
    return send(res, 404, { ok: false, error: 'unknown api' });
  }

  function viteApp(id, req, res) {
    const st = appState[id], vite = vites[id];
    if (!vite) return send(res, 503, `${VITE_APPS[id].title}: ${st.state === 'error' ? `fejl: ${st.error}` : 'starter …'}`);
    // Demo: GameSystems source assets are served by its vite.config.js plugin mounted at /assets (not under base).
    if (id === 'demo' && req.url.startsWith('/demo/assets/')) req.url = req.url.slice('/demo'.length);
    // Studio: the save endpoints are plugin middlewares at /api/grasps and /api/hand (the page calls ./api/...). They
    // accept only same-machine Origins; a same-origin POST from the headset carries the LAN origin, so after checking it
    // matches this server's Host it is presented as localhost. Cross-site Origins pass through unchanged (-> 403).
    if (id === 'studio' && req.url.startsWith('/studio/api/')) {
      req.url = req.url.slice('/studio'.length);
      if (req.headers.origin && sameOrigin(req)) req.headers.origin = 'https://localhost';
    }
    vite.middlewares(req, res, () => send(res, 404, 'not found'));
  }

  async function handle(req, res) {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'bad url'); }
    if (path === '/' || path === '/index.html') return serveStatic(req, res, HUB, '/index.html');
    if (path.startsWith('/hub/')) return serveStatic(req, res, HUB, path.slice(4));
    if (path === '/favicon.ico') return send(res, 204, '');
    if (path.startsWith('/api/')) return api(req, res, path);
    const id = path.split('/')[1];
    if (!appState[id]) return send(res, 404, 'not found');
    if (path === `/${id}`) return send(res, 301, '', { location: `/${id}/${req.url.slice(id.length + 1)}` });
    if (id === 'contracts') {
      if (appState.contracts.state !== 'ok') return send(res, 503, `Contracts: ${appState.contracts.error || 'ikke klar'}`);
      return serveStatic(req, res, PATHS.contracts, path.slice('/contracts'.length));
    }
    return viteApp(id, req, res);
  }

  // Every save / feedback request is logged with its answer (a refused Quest save used to leave no trace at all).
  const LOGGED = /^\/(studio\/api\/|api\/results|api\/sync)/;
  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    if (LOGGED.test(req.url || '') && req.method !== 'HEAD') {
      const t0 = Date.now(), ua = String(req.headers['user-agent'] || ''), url = (req.url || '').split('?')[0];   // before viteApp rewrites it
      const who = /OculusBrowser|Quest/.test(ua) ? 'Quest' : /Headless/.test(ua) ? 'headless' : ua ? 'browser' : '-';
      res.on('finish', () => {
        log(`[lab] ${req.method} ${url} -> ${res.statusCode} (${Date.now() - t0} ms, ${who}, ${req.socket.remoteAddress || '?'})`);
        // A stored recording lands in GameSystems/extensions; the apps read synced vendor copies, so re-sync them.
        if (url.startsWith('/studio/api/') && req.method !== 'GET' && res.statusCode < 300) scheduleSync();
      });
    }
    handle(req, res).catch(error => { log(`[lab] ${req.url}: ${error.stack || error}`); if (!res.headersSent) send(res, 500, String(error.message)); else res.end(); });
  });
  // Vite's HMR sockets (wss://host/<app>/hmr) attach their own upgrade listeners; anything else is closed.
  server.on('upgrade', (req, socket) => {
    const p = (req.url || '').split('?')[0];
    if (!apps.some(id => VITE_APPS[id] && p === `/${id}/hmr`)) socket.destroy();
  });

  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => { server.off('error', fail); ok(); });
  }).catch(async error => {
    if (error.code !== 'EADDRINUSE') throw error;
    const other = await probe(`https://127.0.0.1:${port}/api/status`);
    if (other?.lab === LAB_ID) throw Object.assign(new Error(`testlab kører allerede på port ${port}`), { code: 'LAB_RUNNING', running: other });
    throw Object.assign(new Error(`port ${port} bruges af et andet program`), { code: 'EADDRINUSE' });
  });
  const actualPort = server.address().port;
  lanUrl = `https://${ip}:${actualPort}/`;

  async function syncAll() {
    const detail = {};
    syncState = { state: 'running', at: null, detail };
    for (const id of apps.filter(a => VITE_APPS[a])) {
      const r = await runSync(VITE_APPS[id].root, VITE_APPS[id].sync);
      detail[id] = { ok: r.ok, output: r.output.split('\n').slice(-6).join('\n') };
      log(`[lab] sync ${id}: ${r.ok ? 'ok' : 'FEJL'}${r.ok ? '' : `\n${r.output}`}`);
    }
    syncState = { state: Object.values(detail).every(d => d.ok) ? 'ok' : 'error', at: new Date().toISOString(), detail };
    return syncState;
  }
  // Debounced re-sync after studio saves (several saves in a row -> one sync; a save during a sync -> one more after it).
  let syncTimer = null, syncRunning = null, syncAgain = false;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      if (syncRunning) { syncAgain = true; return; }
      syncRunning = syncAll().then(async () => {
        // Contracts is served from its own committed copies (src/extensions), refreshed by its sync:extensions.
        const r = await runSync(PATHS.contracts, 'tools/sync_extensions.mjs');
        log(`[lab] sync contracts: ${r.ok ? 'ok' : `FEJL\n${r.output}`}`);
      }).catch(error => log(`[lab] sync efter gem: ${error.message}`));
      await syncRunning; syncRunning = null;
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }, 1500);
  }
  if (sync) await syncAll();

  for (const id of apps.filter(a => VITE_APPS[a])) {
    try { vites[id] = await createViteApp(id, server); appState[id].state = 'ok'; }
    catch (error) { appState[id] = { ...appState[id], state: 'error', error: error.message }; log(`[lab] ${id} kunne ikke starte: ${error.stack || error}`); }
  }
  if (appState.contracts) {
    if (existsSync(join(PATHS.contracts, 'index.html'))) appState.contracts.state = 'ok';
    else appState.contracts = { ...appState.contracts, state: 'error', error: `index.html findes ikke i ${PATHS.contracts}` };
  }

  if (publish) {
    published = { state: 'running' };
    publishLan({ url: lanUrl, ip, port: actualPort, log: m => log(`[lab] ${m}`) }).then(r => {
      published = r;
      if (r.state === 'failed' || r.state === 'skipped') log(`[lab] kunne ikke lægge LAN-adressen op (${r.error}). Labbet kører videre.`);
    });
  }

  return {
    server, port: actualPort, ip, lanUrl, url: `https://localhost:${actualPort}/`, status, syncAll,
    get published() { return published; },
    async close() {
      await Promise.all(Object.values(vites).map(v => v.close().catch(() => {})));
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    },
  };
}

/** One app's Vite dev server in middleware mode on the lab's https server, from the app's own vite.config.js. */
async function createViteApp(id, httpsServer) {
  const root = VITE_APPS[id].root;
  const viteEntry = join(root, 'node_modules/vite/dist/node/index.js');
  if (!existsSync(viteEntry)) throw new Error(`${viteEntry} mangler (npm install i ${root})`);
  const { createServer, createLogger } = await import(pathToFileURL(viteEntry).href);
  const base = createLogger('info', { allowClearScreen: false });
  const tag = m => `[${id}] ${m}`;
  const logger = { ...base, info: (m, o) => base.info(tag(m), o), warn: (m, o) => base.warn(tag(m), o),
    warnOnce: (m, o) => base.warnOnce(tag(m), o), error: (m, o) => base.error(tag(m), o), clearScreen() {} };
  return createServer({
    configFile: join(root, 'vite.config.js'),
    root,
    base: `/${id}/`,
    appType: 'mpa',
    cacheDir: join(root, 'node_modules/.vite-headset-lab'),
    clearScreen: false,
    customLogger: logger,
    server: { middlewareMode: true, ws: { server: httpsServer, path: 'hmr' } },
  });
}

// ---- CLI ----
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const port = Number(arg('--port', process.env.HEADSET_LAB_PORT || DEFAULT_PORT));
  // Mirror the console into .state/lab.log (gitignored) so a lab started without a console can be inspected.
  await mkdir(join(HERE, '.state'), { recursive: true });
  const logFile = createWriteStream(join(HERE, '.state/lab.log'), { flags: 'a' });
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => { try { logFile.write(chunk); } catch {} return write(chunk, ...rest); };
  }
  console.log(`\n=== GameSystems testlab · ${new Date().toLocaleString('da-DK')} ===`);
  try {
    const lab = await startLab({ port, sync: !args.includes('--no-sync'), publish: !args.includes('--no-publish') });
    const s = await lab.status();
    const mark = st => (st.state === 'ok' ? 'OK' : `FEJL (${st.error})`);
    console.log([
      '',
      'GameSystems testlab kører (Quest 3, WebXR over HTTPS).',
      `  Åbn i Quest-browseren:  ${lab.lanUrl}`,
      `  Bogmærke (altid rigtig adresse):  ${CLOUD.pageUrl}`,
      `  På denne PC:            ${lab.url}`,
      `  Demo ${mark(s.apps.demo)} · Grasp Studio ${mark(s.apps.studio)} · Contracts ${mark(s.apps.contracts)}`,
      `  VRM-model (Jimmy): ${s.extras.vrmModel ? 'på plads' : 'mangler'} · CC-avatar: ${s.extras.ccAvatar ? 'på plads' : 'mangler'}`,
      `  Resultater skrives til ${s.resultsFile}`,
      `  Certifikat: ${s.certFile} (selvsigneret; accepter advarslen én gang i headsettet: Avanceret -> Fortsæt)`,
      '',
      'Luk vinduet eller tryk Ctrl+C for at stoppe.',
      '',
    ].join('\n'));
    // A crash must leave a trace in .state/lab.log; the lab keeps serving the other apps.
    process.on('uncaughtException', error => console.error(`[lab] uncaught: ${error?.stack || error}`));
    process.on('unhandledRejection', error => console.error(`[lab] unhandled rejection: ${error?.stack || error}`));
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; console.log('Stopper testlab …'); await lab.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGBREAK', stop);
  } catch (error) {
    if (error.code === 'LAB_RUNNING') {
      console.log(`\nTestlab kører allerede: ${error.running.url || `https://localhost:${port}/`}\nDu behøver ikke starte den igen. Åbn ${CLOUD.pageUrl} i headsettet.\n`);
      process.exit(0);
    }
    if (error.code === 'EADDRINUSE') console.error(`\nPort ${port} bruges af et andet program. Luk det, eller start med --port <andet nummer>.\n`);
    else console.error(`\nTestlab kunne ikke starte: ${error.stack || error}\n`);
    process.exit(1);
  }
}
