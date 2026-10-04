// node designs_shot.mjs [outdir]  -> three.js renders of every design (front/back), tiers, and a runtime texture swap
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('C:/Devstuff/GameDev/NightfallContracts/package.json');
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || 'C:/Tools/BlenderShared/tests/out/three_designs';
fs.mkdirSync(out, { recursive: true });
const roots = { '/shared/': 'C:/Tools/BlenderShared/', '/three/': 'C:/Devstuff/GameDev/NightfallContracts/vendor/three/', '/': 'C:/Tools/BlenderShared/tests/' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png' };
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
await p.goto(`http://localhost:${port}/designs_test.html`); await p.waitForFunction('window.__ready===true', { timeout: 60000 });
const names = fs.readdirSync('C:/Tools/BlenderShared/export/designs').filter(f => f.endsWith('.glb') && !/_(medium|low|minimal)\.glb$/.test(f)).map(f => f.slice(0, -4));
for (const n of names) for (const [v, a] of [['front', 0], ['back', 180]]) { await p.evaluate((n, a) => window.shot(n, 'high', a), n, a); await p.screenshot({ path: `${out}/${n}_${v}.png` }); }
for (const t of ['medium', 'low', 'minimal']) for (const n of ['wine_classic', 'flask_lab']) { await p.evaluate((n, t) => window.shot(n, t, 0), n, t); await p.screenshot({ path: `${out}/tier_${t}_${n}.png` }); }
await p.evaluate(() => window.shot('beer_pale', 'high', 0)); await p.screenshot({ path: `${out}/swap_beer_pale_before.png` });
const ok = await p.evaluate(() => window.swap('front', '/shared/labels/user/my_homebrew.png')); await p.screenshot({ path: `${out}/swap_beer_pale_after.png` });
await p.evaluate(() => window.shot('beer_pale', 'low', 0)); const okLow = await p.evaluate(() => window.swap('front', '/shared/labels/user/my_homebrew.png'));
console.log('SHOTS', names.length * 2 + 8, 'swap', ok, 'swapLowTier(expect false)', okLow, 'LOG', JSON.stringify(log.slice(0, 8)));
await b.close(); srv.close();
