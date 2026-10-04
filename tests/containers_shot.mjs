// node containers_shot.mjs [name ...] [--lod]  -> renders each container at several orientations + builds tests/out/containers_sheet.png
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
const puppeteer = require('puppeteer-core');
const all = ['square', 'hipflask', 'jerrycan', 'tumbler', 'mug', 'tank'];
const names = process.argv.slice(2).filter(a => !a.startsWith('--')); const list = names.length ? names : all;
const lod = process.argv.includes('--lod');
const out = 'C:/Tools/BlenderShared/tests/out'; fs.mkdirSync(out, { recursive: true });
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
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'], defaultViewport: { width: 360, height: 400 } });
// [tilt, fill, spin, pitch]
const poses = [[0, 0.6, 0, 0], [45, 0.6, 0, 0], [90, 0.6, 0, 0], [135, 0.6, 0, 0], [180, 0.6, 0, 0], [60, 0.5, 50, 35], [90, 0.3, 90, 0], [120, 0.85, 200, -30]];
const opaque = new Set(['mug', 'jerrycan']); const log = []; const meta = {};
const tag = lod ? '_lod1' : '';
for (const n of list) {
  const p = await b.newPage(); p.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(n + ': ' + m.text()); }); p.on('pageerror', e => log.push(n + ' pageerror ' + e.message));
  await p.goto(`http://localhost:${port}/containers_test.html?c=${n}${lod ? '&lod=1' : ''}&xray=${opaque.has(n) ? 1 : 0}&elev=${['tumbler', 'mug', 'tank'].includes(n) ? 32 : 14}`);
  await p.waitForFunction('window.__ready===true', { timeout: 90000 });
  meta[n] = [];
  for (let i = 0; i < poses.length; i++) {
    const r = await p.evaluate((a) => window.pose(...a), poses[i]); meta[n].push(r);
    await p.screenshot({ path: `${out}/containers_${n}${tag}_${i}.png` });
  }
  await p.close();
}
fs.writeFileSync(`${out}/containers_meta${tag}.json`, JSON.stringify(meta, null, 1));
if (list.length === all.length) {
  const rows = all.map(n => `<tr><th>${n}${tag}</th>${poses.map((_, i) => `<td><img src="file:///C:/Tools/BlenderShared/tests/out/containers_${n}${tag}_${i}.png"></td>`).join('')}</tr>`).join('');
  const cap = `<tr><th></th>${poses.map(p => `<td class=c>tilt ${p[0]} fill ${p[1]} spin ${p[2]} pitch ${p[3]}</td>`).join('')}</tr>`;
  fs.writeFileSync(`${out}/containers_sheet${tag}.html`, `<style>body{margin:0;background:#111;color:#ccc;font:12px sans-serif}th{width:70px}td{padding:0}.c{text-align:center;padding:2px}img{width:240px;height:267px;object-fit:cover;object-position:center 45%;display:block}</style><table cellspacing=0>${cap}${rows}</table>`);
  const q = await b.newPage(); await q.setViewport({ width: 70 + 240 * poses.length, height: 40 + 267 * all.length });
  await q.goto(`file:///C:/Tools/BlenderShared/tests/out/containers_sheet${tag}.html`); await new Promise(r => setTimeout(r, 1500));
  await q.screenshot({ path: `${out}/containers_sheet${tag}.png` });
}
console.log('SHOTS', list.length * poses.length, 'LOG', JSON.stringify(log.slice(0, 8)));
await b.close(); srv.close();
