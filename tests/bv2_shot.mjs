// node shot.mjs [bottle] [outdir]   -> renders the bottle at several tilts/fills with headless Chrome
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
const puppeteer = require('puppeteer-core');
const names = (process.argv[2] || 'bordeaux').split(','); const out = process.argv[3] || 'C:/Tools/BlenderShared/tests/out/bv2_three';
fs.mkdirSync(out, { recursive: true });
const roots = { '/shared/': 'C:/Tools/BlenderShared/', '/three/': 'C:/Devstuff/GameDev/NightfallContracts/vendor/three/', '/': 'C:/Tools/BlenderShared/tests/' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const k = Object.keys(roots).find(p => u.startsWith(p) && p !== '/') || '/';
  const f = path.join(roots[k], u.slice(k.length));
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end()) : (res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }), res.end(d)));
}).listen(0);
const port = srv.address().port;
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 420, height: 560 } });
const p = await b.newPage(); const log = [];
p.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(m.text()); }); p.on('pageerror', e => log.push('pageerror ' + e.message));
const poses = [[0, 0.6], [90, 0.6], [180, 0.6]];
for (const bottle of names) {
await p.goto(`http://localhost:${port}/bv2_bottle_test.html?bottle=${bottle}`); await p.waitForFunction('window.__ready===true', { timeout: 60000 });
for (const [t, f] of poses) { await p.evaluate((t, f) => window.pose(t, f), t, f); await p.screenshot({ path: `${out}/${bottle}_t${t}_f${Math.round(f * 100)}.png` }); }
}
console.log('SHOTS', names.length * poses.length, 'LOG', JSON.stringify(log.slice(0, 8)));
await b.close(); srv.close();
