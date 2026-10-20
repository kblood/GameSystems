// Real browser check of the zombie lab (gore extension) on the built demo, headless with software WebGL: three
// CharacterCreator zombies load, a mouse click on a zombie's head goes through the desktop shooting path, an arm and a
// head are shot off (gib spawned, stump cap shown, zombie dies on losing its head), the jaw / chest / belly patches open
// onto the insides, and per-sever cost, draw calls and gib counts are measured. Screenshots go to test-results/gore/ for a
// human look. Not headset acceptance. Needs `npm run build`. Puppeteer is borrowed from the Contracts repo (read only).
import { closeSmokeResources } from './smoke-cleanup.mjs';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { preview } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url)), contracts = new URL('../../../NightfallContractsWebXR-interaction/package.json', import.meta.url), require = createRequire(contracts);
const puppeteer = require('puppeteer-core'), executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH');
if (!existsSync(resolve(root, 'dist/zombie.html'))) throw new Error('Run npm run build first');
const output = resolve(root, 'test-results/gore'); mkdirSync(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 5321, strictPort: true } });
let browser, page; const checks = [], errors = [], measured = {};
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => { if (++k >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = name => page.screenshot({ path: resolve(output, name), type: name.endsWith('.jpg') ? 'jpeg' : 'png', ...(name.endsWith('.jpg') ? { quality: 85 } : {}) });
/** Camera looks from `from` at `to` (world), desktop mode. */
const look = (from, to) => page.evaluate((from, to) => {
  const { camera, THREE } = window.__lab; const rig = camera.parent;
  rig.position.set(from[0], 0, from[2]); camera.position.set(0, from[1], 0); camera.lookAt(new THREE.Vector3(...to)); camera.updateMatrixWorld(true);
}, from, to);
/** Close-ups hide the held pistol (it fills the view); the panel goes after the first picture. */
const pistolVisible = v => page.evaluate(v => { const p = window.__lab.scene.getObjectByName('pistol'); if (p) p.visible = v; }, v);
try {
  browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 600000, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1100, height: 720 } });
  page = await browser.newPage(); page.setDefaultTimeout(300000);
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:5321/zombie.html?zombies=3&walk=0&seed=7', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lab?.zombies?.length === 3, { timeout: 300000, polling: 1000 });
  await page.evaluate(() => window.__lab.ready);
  measured.loadSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  // line them up close to the camera (walking is off: deterministic pictures)
  await page.evaluate(() => { window.__lab.zombies.forEach((z, i) => { z.position.set((i - 1) * 1.1, 0, -0.9 - (i % 2) * 0.35); }); });
  await look([0, 1.55, 1.9], [0, 1.1, -1]); await frames(6);
  const start = await page.evaluate(() => window.__lab.stats());
  measured.start = { drawCallsFrame: start.drawCallsFrame, zombieDrawCalls: start.zombies.map(z => z.drawCalls), attachMs: start.zombies.map(z => +z.attachMs.toFixed(1)), baked: start.zombies.map(z => z.baked) };
  assert.ok(start.zombies.every(z => z.baked), `every zombie matched the bake ${JSON.stringify(start.zombies)}`); checks.push('three CharacterCreator zombies load and match the baked topology');
  await shot('01-intact.png');
  await page.evaluate(() => { document.querySelector('aside').style.display = 'none'; });

  // Desktop path: a mouse click on zombie 1's chest (zombie 0 is behind the settings panel) fires the pistol through the camera ray.
  const screen = await page.evaluate(() => { const { zombies, camera } = window.__lab; const p = zombies[1].gore.regionCenter('chest').project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; });
  await page.mouse.click(screen[0], screen[1]); await frames(4);
  const clicked = await page.evaluate(() => ({ shots: window.__lab.stats().shots, hits: window.__lab.stats().hits, lost: window.__lab.zombies[1].gore.lostRegions(), damage: window.__lab.zombies[1].gore.model.damage }));
  measured.click = clicked;
  assert.ok(clicked.shots === 1 && clicked.hits === 1 && clicked.damage > 0, `click ${JSON.stringify(clicked)}`); checks.push('a mouse click fires through the desktop ray and wounds the zombie');

  // Arm off (zombie 1): one heavy shot at the upper arm.
  const arm = await page.evaluate(() => window.__lab.shootRegion(1, 'leftUpperArm', 120));
  measured.arm = arm;
  assert.ok(arm && arm.region === 'leftUpperArm' && arm.events.includes('sever:leftUpperArm'), `arm ${JSON.stringify(arm)}`);
  await frames(3); await shot('02-arm-off.png');
  await frames(30); await shot('03-arm-gib-falling.png');
  const afterArm = await page.evaluate(() => ({ lost: window.__lab.zombies[1].gore.lostRegions(), gibs: window.__lab.world.gibs, dead: window.__lab.zombies[1].gore.dead }));
  assert.deepEqual(afterArm.lost, ['leftUpperArm', 'leftLowerArm', 'leftHand']); assert.equal(afterArm.dead, false); assert.ok(afterArm.gibs >= 1);
  measured.gibsAfterArm = afterArm.gibs;
  checks.push('a shot severs the upper arm: forearm and hand go with it, a gib falls, the zombie lives');
  // close-up of the shoulder stump
  const shoulder = await page.evaluate(() => window.__lab.zombies[1].gore.regionCenter('chest').toArray());
  await pistolVisible(false);
  await look([shoulder[0] + 0.7, shoulder[1] + 0.25, shoulder[2] + 0.25], [shoulder[0] + 0.15, shoulder[1] + 0.12, shoulder[2]]); await frames(3);
  await shot('04-shoulder-stump.png');
  await pistolVisible(true);

  // Head off (zombie 0): kills.
  await look([0, 1.55, 1.9], [0, 1.1, -1]); await frames(2);
  const head = await page.evaluate(() => window.__lab.shootRegion(0, 'neck', 200));
  measured.head = head;
  assert.ok(head && head.events.some(e => e.startsWith('sever:')) && head.events.some(e => e.startsWith('death')), `head ${JSON.stringify(head)}`);
  await frames(3); await shot('05-head-off.png');
  await frames(40); await shot('06-head-gib-dead.png');
  checks.push('a shot at the neck takes the head off and the zombie dies');

  // Patches (zombie 2): chest and belly chunks open onto bones and organs, then the jaw, shot from below the chin.
  // Damage just over each patch's health so the zombie stays standing (totalHealth not reached).
  const patches = [];
  for (const r of ['chestLeft', 'belly']) patches.push(await page.evaluate(r => window.__lab.shootRegion(2, r, 40), r));
  const jawAt = await page.evaluate(() => window.__lab.zombies[2].gore.regionCenter('jaw').toArray());
  await look([jawAt[0], jawAt[1] - 0.45, jawAt[2] + 0.9], jawAt);
  patches.push(await page.evaluate(() => window.__lab.shootRegion(2, 'jaw', 20)));
  measured.patches = patches;
  measured.gibsAfterPatches = await page.evaluate(() => window.__lab.world.gibs);
  const z2 = await page.evaluate(() => ({ dead: window.__lab.zombies[2].gore.dead, lost: window.__lab.zombies[2].gore.lostRegions(), insides: window.__lab.scene.getObjectsByProperty('visible', true).filter(o => o.name.startsWith('gore-insides:')).map(o => o.name) }));
  measured.insides = z2;
  assert.ok(['jaw', 'chestLeft', 'belly'].every(r => z2.lost.includes(r)) && !z2.lost.includes('head') && !z2.dead, `patches ${JSON.stringify(z2)}`);
  assert.ok(z2.insides.some(n => n.includes('cavity:chest')) && z2.insides.some(n => n.includes('cavity:pelvis')), `insides ${JSON.stringify(z2.insides)}`);
  checks.push('jaw, chest and belly chunks come off and show the ribcage, organs and guts behind them');
  const chest = await page.evaluate(() => window.__lab.zombies[2].gore.regionCenter('chest').toArray());
  await pistolVisible(false);
  await look([chest[0] - 0.2, chest[1] + 0.05, chest[2] + 0.95], [chest[0], chest[1] - 0.1, chest[2]]); await frames(3);
  await shot('07-chest-belly-insides.png');
  const hole = await page.evaluate(() => window.__lab.zombies[2].gore.regionCenter('chestLeft').toArray());
  await look([hole[0] + 0.05, hole[1] + 0.05, hole[2] + 0.4], hole); await frames(3);
  await shot('07b-chest-hole-closeup.png');
  measured.holeView = await page.evaluate(() => { const { THREE, scene, camera } = window.__lab; const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    return rc.intersectObjects(scene.children, true).filter(h => h.object.visible && h.object.isMesh).slice(0, 6).map(h => `${h.object.name}@${h.distance.toFixed(3)}${h.face ? ':m' + h.face.materialIndex : ''}`); });
  await look([jawAt[0] - 0.15, jawAt[1] + 0.05, jawAt[2] + 0.55], jawAt); await frames(3);
  await shot('08-jaw.png');
  await pistolVisible(true);

  // Walk: the remaining zombies shamble at the player (the one-armed one too); then the overview.
  await look([0, 1.6, 2.4], [0, 1.0, -1]);
  await page.evaluate(() => { window.__lab.walking = true; window.__lab.zombies.forEach((z, i) => z.position.set((i - 1) * 1.2, 0, -3.2)); });
  const z1Before = await page.evaluate(() => window.__lab.zombies[1].position.z);
  await frames(40);
  const walked = await page.evaluate(() => ({ z1: window.__lab.zombies[1].position.z, z0: window.__lab.zombies[0].position.z }));
  measured.gibsBeforeOff = await page.evaluate(() => window.__lab.world.gibs);
  assert.ok(walked.z1 > z1Before + 0.02 && Math.abs(walked.z0 + 3.2) < 1e-6, `walk ${JSON.stringify(walked)}`); checks.push('a living zombie keeps walking with an arm missing; the dead one stays down');
  await shot('09-overview.png');

  // Gore level off: nothing comes off any more.
  await page.evaluate(() => window.__lab.setConfig({ ...window.__lab.settings(), goreLevel: 'off' }));
  const off = await page.evaluate(() => window.__lab.shootRegion(1, 'rightUpperArm', 200));
  measured.off = off;
  assert.ok(off && !off.events.some(e => e.startsWith('sever')), `gore off ${JSON.stringify(off)}`); checks.push('gore level off: shots wound and kill but sever nothing');

  const end = await page.evaluate(() => window.__lab.stats());
  measured.performance = { severMsMean: +end.severMs.toFixed(3), severMsLast: +end.lastSeverMs.toFixed(3), severs: end.severs, gibs: end.gibs, drawCallsFrame: end.drawCallsFrame,
    goreDrawCalls: end.drawCalls, zombieDrawCalls: end.zombies.map(z => z.drawCalls), effects: end.effects, fpsSoftware: +end.fps.toFixed(1) };
  assert.ok(end.severMs < 20, `sever ${end.severMs} ms`); checks.push(`severing costs ${end.severMs.toFixed(2)} ms on average (software WebGL, ${end.severs} severs)`);
  assert.deepEqual(errors, []); checks.push('no page errors');
  writeFileSync(resolve(output, 'gore-smoke.json'), JSON.stringify({ checks, measured }, null, 2));
  console.log(checks.map(c => `ok - ${c}`).join('\n'));
  console.log(JSON.stringify(measured, null, 1));
} catch (error) {
  try { if (page) await page.screenshot({ path: resolve(output, 'failure.png') }); } catch {}
  console.error(errors.join('\n'));
  throw error;
} finally { await closeSmokeResources({ browser, server }); }
