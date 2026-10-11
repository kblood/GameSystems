import {closeSmokeResources} from './smoke-cleanup.mjs';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../../../NightfallContractsWebXR-interaction/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH to an installed browser');
const output = resolve(root, 'test-results/vehicle'); mkdirSync(output, { recursive: true });
const dev = process.argv.includes('--dev'), port = 5398;
const server = dev ? await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true } }) : await preview({ root, preview: { host: '127.0.0.1', port, strictPort: true } });
if (dev) await server.listen();
let browser; const errors = [], checks = [], metrics = {};
try {
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/vehicle.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__vehicleLab?.ready, { timeout: 60000 });
  const state = () => page.evaluate(() => window.__vehicleLab.api.state('aster'));
  const slider = async (id, value) => page.$eval(`#${id}`, (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  metrics.high = await page.evaluate(() => ({ ...window.__vehicleLab.renderer.info.render }));
  await page.screenshot({ path: resolve(output, 'aster-closed-browser.png') }); checks.push('GLB and PBR model load without missing nodes');
  await page.click('#open-all'); await page.waitForFunction(() => Object.values(window.__vehicleLab.api.state('aster').parts).every(p => p.fraction === 1));
  const pivots = await page.evaluate(() => ['Door_FL', 'Door_FR', 'Hood', 'Trunk', 'FuelFlap'].map(name => { const o = window.__vehicleLab.root.getObjectByName(name); return { name, rotation: o.rotation.toArray().slice(0, 3), position: o.position.toArray() }; }));
  assert.ok(pivots.every(p => Math.hypot(...p.position) > .1 && Math.hypot(...p.rotation) > .9)); checks.push('all seven physical hinge controls open panels');
  await page.screenshot({ path: resolve(output, 'aster-open-browser.png') });
  const before = (await state()).fuel.amountL; await page.click('#refuel'); assert.ok((await state()).fuel.amountL > before + 4.99); checks.push('open fuel flap accepts petrol through shared supply adapter');
  await page.click('#close-all'); await page.waitForFunction(() => Object.values(window.__vehicleLab.api.state('aster').parts).every(p => p.fraction === 0));
  await page.click('#ignition'); assert.equal((await state()).running, true);
  await page.click('#lights'); await page.click('#drive'); await slider('throttle', .7);
  await page.waitForFunction(() => window.__vehicleLab.api.state('aster').speed > 1); assert.ok((await state()).consumedL > 0); checks.push('engine starter, fuel consumption, lights and wheel motion operate');
  await page.click('#brake'); await page.waitForFunction(() => window.__vehicleLab.api.state('aster').speed === 0);
  await page.click('#ignition'); await page.select('#adapters', 'standalone'); assert.equal((await state()).fuel.amountL, 28); checks.push('adapter swap preserves independent standalone reserves');
  await page.select('#adapters', 'disabled'); await page.click('#ignition'); const disabled = await state(); await page.evaluate(() => window.__vehicleLab.api.step(100));
  const after = await state(); assert.equal(after.fuel.amountL, disabled.fuel.amountL); assert.equal(after.power.energyWh, disabled.power.energyWh); checks.push('disabled resource mode runs without consumption');
  await page.select('#quality', 'low'); await page.waitForFunction(() => window.__vehicleLab.ready && window.__vehicleLab.quality === 'low');
  metrics.low = await page.evaluate(() => ({ ...window.__vehicleLab.renderer.info.render })); assert.ok(metrics.low.triangles < metrics.high.triangles); assert.ok(metrics.low.calls < metrics.high.calls);
  assert.equal((await state()).running, true); await page.screenshot({ path: resolve(output, 'aster-low-browser.png') }); checks.push('low geometry and simpler glass lower GPU work without resetting simulation');
  assert.deepEqual(errors, []); checks.push('no browser exceptions or failed requests');
  const report = { passed: true, checks, metrics, errors, headsetTested: false }; writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ passed: false, checks, metrics, errors, failure: error.stack }, null, 2)); throw error;
} finally { await closeSmokeResources({browser,server,dev,onForced:()=>console.warn('Closed stalled owned test browser')}); }
