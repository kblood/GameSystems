// node serve.mjs [port]  -> static server for viewer.html (maps /three/ to the vendored three.js).
// Sends COOP/COEP so SharedArrayBuffer (WASM threads) would also work here later.
// node serve.mjs shot <liquid> <t1,t2,..> [outdir]  -> headless Chrome screenshots at those sim times (puppeteer-core).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const roots = { '/three/': 'C:/Devstuff/GameDev/NightfallContracts/vendor/three/', '/': here + '/' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const shot = process.argv[2] === 'shot';
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const k = Object.keys(roots).find(p => u.startsWith(p) && p !== '/') || '/';
  const f = path.join(roots[k], u.slice(k.length));
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end()) : (res.writeHead(200, {
    'content-type': mime[path.extname(f)] || 'application/octet-stream',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }), res.end(d)));
}).listen(shot ? 0 : (+process.argv[2] || 8087));
const port = srv.address().port;
if (!shot) console.log(`http://localhost:${port}/viewer.html?liquid=honey&dx=4`);
else {
  const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
  const puppeteer = require('puppeteer-core');
  const liquid = process.argv[3] || 'honey', times = (process.argv[4] || '1,3,6').split(',').map(Number);
  const out = process.argv[5] || path.join(here, 'out'); fs.mkdirSync(out, { recursive: true });
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 640, height: 480 } });
  const p = await b.newPage(); const log = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(m.text()); }); p.on('pageerror', e => log.push('pageerror ' + e.message));
  await p.goto(`http://localhost:${port}/viewer.html?headless&liquid=${liquid}&dx=${process.argv[6] || 4}`);
  await p.waitForFunction('window.__ready===true', { timeout: 60000 });
  for (const t of times) {
    const r = await p.evaluate(t => window.runTo(t), t);
    console.log(`t=${t}s n=${r.n} steps=${r.steps} wall ${r.ms.toFixed(0)} ms (${(r.ms / r.steps).toFixed(2)} ms/step in Chrome) ${JSON.stringify(r.stats)}`);
    await p.screenshot({ path: `${out}/${liquid}_t${t}.png` });
  }
  console.log('LOG', JSON.stringify(log.slice(0, 6)));
  await b.close(); srv.close();
}
