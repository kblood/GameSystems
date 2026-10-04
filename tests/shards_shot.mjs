// node shards_shot.mjs [bottle] [outdir]  -> assembled / colored / exploded views of shards + broken variant
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
const puppeteer = require('puppeteer-core');
const bottle = process.argv[2] || 'wine'; const out = process.argv[3] || 'C:/Tools/BlenderShared/tests/out';
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
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 560, height: 560 } });
const p = await b.newPage(); const log = [];
p.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(m.text()); }); p.on('pageerror', e => log.push('pageerror ' + e.message));
const views = bottle === 'soda' ? [['broken', 'glass', 0, 270], ['broken', 'glass', 0, 235]] :
  [['shards', 'glass', 0, 25], ['shards', 'color', 0, 25], ['shards', 'color', 0, 90], ['shards', 'color', 0, 200], ['shards', 'color', 0.6, 90], ['broken', 'glass', 1, 25], ['broken', 'glass', 1, 150]];
let i = 0;
for (const [file, mode, ex, yaw] of views) {
  await p.goto(`http://localhost:${port}/shards_test.html?bottle=${bottle}&file=${file}&mode=${mode}&explode=${ex}&yaw=${yaw}`);
  await p.waitForFunction('window.__ready===true', { timeout: 60000 });
  await p.screenshot({ path: `${out}/${bottle}_${file}_${mode}${ex ? '_exploded' : ''}_y${yaw}.png` }); i++;
}
console.log('SHOTS', i, 'LOG', JSON.stringify(log.slice(0, 8)));
await b.close(); srv.close();
