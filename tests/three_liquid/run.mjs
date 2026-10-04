// node tests/three_liquid/run.mjs  -> tests/three_liquid/out/shot_<i>.png + results.json (three.js bottle_liquid.js port)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
const puppeteer = require('puppeteer-core');
const out = 'C:/Tools/BlenderShared/tests/three_liquid/out'; fs.mkdirSync(out, { recursive: true });
const roots = { '/shared/': 'C:/Tools/BlenderShared/', '/three/': 'C:/Devstuff/GameDev/NightfallContracts/vendor/three/', '/': 'C:/Tools/BlenderShared/tests/three_liquid/' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const k = Object.keys(roots).find(p => u.startsWith(p) && p !== '/') || '/';
  const f = path.join(roots[k], u.slice(k.length) || 'index.html');
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end()) : (res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }), res.end(d)));
}).listen(0);
const port = srv.address().port;
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage(); const log = [];
p.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(m.text().slice(0, 400)); }); p.on('pageerror', e => log.push('pageerror ' + e.message));
await p.goto(`http://localhost:${port}/index.html`);
await p.waitForFunction('window.__ready===true', { timeout: 180000 });
const poses = [[0, 0.6, {}], [45, 0.6, {}], [90, 0.6, {}], [180, 0.6, {}], [70, 0.3, { spin: 40, pitch: 30 }], [0, 0.75, { shake: 1.2 }], [25, 0.85, { shake: 1.0, spin: 30 }], [0, 0.15, {}]];
const res = { poses: [] };
for (let i = 0; i < poses.length; i++) {
  const [t, f, o] = poses[i];
  res.poses.push({ tilt: t, fill: f, ...o, r: await p.evaluate((a, b, c) => window.pose(a, b, c), t, f, o) });
  await p.screenshot({ path: `${out}/shot_${i}.png` });
}
const close = [[2, {}], [7, { carb: 0.6, foamCap: 1 }], [6, { carb: 0.5, foamCap: 0.8, tilt: 50, fill: 0.5 }]];
res.closeups = [];
for (let i = 0; i < close.length; i++) {
  res.closeups.push(await p.evaluate((a, o) => window.closeup(a, o), close[i][0], close[i][1]));
  await p.screenshot({ path: `${out}/close_${i}.png` });
}
await p.evaluate(() => { for (const i of [6, 7]) window.closeup(i, { shake: 0 }); });   // restore baked carbonation / foam
res.idle = await p.evaluate(() => window.idleProbe());
// timing: cost of update() for all bottles, awake vs asleep
res.timing = await p.evaluate(() => { const t0 = performance.now(); window.idleProbe(); return (performance.now() - t0) / 600; });
fs.writeFileSync(`${out}/results.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ log: log.slice(0, 10), idle: res.idle, msPerFrameAllBottles: res.timing }));
await b.close(); srv.close();
