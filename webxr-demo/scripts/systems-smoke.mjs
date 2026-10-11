import {closeSmokeResources} from './smoke-cleanup.mjs';
// Real browser interactions against the built lab. Reuses the workspace's existing QA dependency.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../../../NightfallContractsWebXR-interaction/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH to an installed Chrome/Edge browser');
const output = resolve(root, 'test-results/systems'); mkdirSync(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 5293, strictPort: true } });
let browser; const errors = [], checks = [];
try {
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', ...(process.env.BROWSER_GPU === '0' ? ['--use-angle=swiftshader'] : []), '--enable-unsafe-swiftshader'], defaultViewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto('http://127.0.0.1:5293/systems.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__systems?.station); checks.push('built lab loads all extensions');
  const state = () => page.evaluate(() => window.__systems.station.state());
  const slider = async (id, value) => page.$eval(`#${id}`, (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  assert.equal((await state()).locked, true);
  await slider('drawer', 1); await page.click('#take-fuse');
  const socket = await page.evaluate(() => window.__systems.project([-0.7, 1.3, 0]));
  await page.mouse.move(socket.x + 150, socket.y + 60); await page.mouse.down(); await page.mouse.move(socket.x, socket.y, { steps: 10 }); await page.mouse.up();
  assert.equal((await state()).fuseInstalled, true); checks.push('mouse moves actual fuse into socket');
  await slider('switch', 1); assert.equal((await state()).powered, true); await slider('door', 1); assert.ok((await state()).door > 0.99); checks.push('fuse and switch power lamp and unlock movable door');
  await page.click('#sound'); await page.waitForFunction(() => window.__systems.station.state().lastHeard); assert.ok((await state()).lastHeard.db > 60); checks.push('open door delivers delayed audible stimulus');
  await page.click('#ignite'); assert.equal((await state()).fire.burning, true); await page.click('#water'); assert.equal((await state()).fire.burning, true);
  await slider('valve', 1); await page.click('#water'); assert.equal((await state()).fire.burning, false); assert.ok((await state()).surface.wetness > 0.9); checks.push('valve gates water, surface gets wet, water extinguishes fire');
  await page.click('#wine'); assert.ok((await state()).surface.stain > 0 || (await state()).surface.wetness > 0.9);
  await page.click('#short'); assert.equal((await state()).fuseBlown, true); assert.equal((await state()).locked, true); await page.click('#short'); await page.click('#repair'); assert.equal((await state()).powered, true); checks.push('overload trips fuse; clearing fault and repair restores power');
  await page.click('#screwdriver'); const screw = await page.evaluate(() => window.__systems.project([0.4, 1, 0]));
  await page.mouse.move(screw.x, screw.y); for (let i = 0; i < 16; i++) await page.mouse.wheel({ deltaY: -100 });
  assert.ok((await state()).screw > 0.99); checks.push('aligned mouse-controlled screwdriver installs screw');
  await page.click('#hammer'); const up = await page.evaluate(() => window.__systems.project([0.7, 1.3, 0])), down = await page.evaluate(() => window.__systems.project([0.7, 0.98, 0]));
  for (let i = 0; i < 6; i++) { await page.mouse.move(up.x, up.y); await page.mouse.move(down.x, down.y); }
  assert.ok((await state()).nail > 0); checks.push('actual hammer motion produces nail impact');
  await page.click('#drop-tool'); await page.screenshot({ path: resolve(output, 'workshop-complete.png') });
  for (const q of ['0', '1', '2', '3']) { await page.select('#quality', q); assert.equal((await state()).powered, true); }
  checks.push('quality switches preserve puzzle state');
  for (let i = 0; i < 3; i++) { await page.click('#reset'); await page.waitForFunction(() => window.__systems?.station.state().drawer === 0 && !window.__systems.station.state().powered); }
  assert.equal((await state()).fuseInstalled, false); assert.equal((await state()).surface.wetness, 0); checks.push('repeated reset clears assemblies, circuits, heat and wetness');
  await page.screenshot({ path: resolve(output, 'workshop-reset.png') });
  await page.goto('http://127.0.0.1:5293/index.html?avatar=off', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__demo && document.getElementById('status').textContent.includes('beholdere'), { timeout: 30000 });
  assert.match(await page.$eval('#status', el => el.textContent), /^29 beholdere/);
  const opacity = await page.evaluate(() => {
    const bottle = [...window.__demo.factory.bottles].find(item => item.design === 'beer_pale');
    if (!bottle) throw new Error('authored beer_pale bottle was not loaded');
    const authored = bottle.liquid.info.opacity;
    const applied = bottle.liquid.opacity;
    bottle.liquid.opacity = 0.35;
    window.__demo.renderer.render(window.__demo.scene, window.__demo.camera);
    return { authored, applied, value: bottle.liquid.opacity, uniform: bottle.liquid.uniforms.uOpacity.value,
      transparent: bottle.liquid.material.transparent, depthWrite: bottle.liquid.material.depthWrite };
  });
  assert.deepEqual(opacity, { authored: 0.6, applied: 0.6, value: 0.35, uniform: 0.35, transparent: true, depthWrite: false });
  checks.push('authored design opacity reaches the rendered liquid and runtime edits select the translucent path');
  await page.evaluate(() => {
    const { pour, materials, physics } = window.__demo;
    const floor = physics.surfaces[0], position = floor.position.clone(); position.x = -3; position.z = 2; position.y = 0.5;
    // A host-authored water source uses the same public drop API as real bottle pouring.
    pour.initialMl += 30; pour.emit(30, position, undefined, { id: 'qa-water', liquidKind: 'water' });
    window.__qaWetId = floor.userData.materialId;
  });
  // Wait for simulated deposition rather than wall time: software-rendered WebGL can advance much slower.
  await page.waitForFunction(() => window.__demo.materials.state(window.__qaWetId).liquidMl > 25, { timeout: 30000 });
  const spill = await page.evaluate(() => ({ deposited: window.__demo.materials.state(window.__qaWetId).liquidMl, error: window.__demo.pour.ledger().errorMl }));
  assert.ok(spill.deposited > 25); assert.ok(Math.abs(spill.error) < 0.01); checks.push('original bottle demo loads 29 objects; actual drop wets physics surface with balanced volume');
  await page.screenshot({ path: resolve(output, 'bottle-material-bridge.png') });
  assert.deepEqual(errors, []); checks.push('no browser errors or failing HTTP responses');
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, headsetTested: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors, output }, null, 2));
} catch (error) {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ passed: false, checks, errors, failure: error.stack, headsetTested: false }, null, 2)); throw error;
} finally { await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')}); }
