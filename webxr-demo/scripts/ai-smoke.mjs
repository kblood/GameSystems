// Real browser check of the zombie AI in the zombie lab (ai + gore + avatar extensions) on the built demo, headless with
// software WebGL. Two zombies roam behind the barricade until a pistol shot (a miss) pulls them; they path around the
// barricade's open end to the player, telegraph (windup) and attack; a legless zombie falls (downed), recovers into the
// crawl and still attacks low; damage reaches the HUD and the death screen restarts the lab. Screenshots (with the AI
// debug overlay: paths, states, surround slots, sight cones) go to test-results/ai/ for a human look. Not headset
// acceptance. Needs `npm run build`. Puppeteer is borrowed from the Contracts repo (read only).
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
const output = resolve(root, 'test-results/ai'); mkdirSync(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 5322, strictPort: true } });
let browser, page; const checks = [], errors = [], measured = {};
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => { if (++k >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
const shot = name => page.screenshot({ path: resolve(output, name), type: 'png' });
const ai = () => page.evaluate(() => window.__lab.aiStats());
/** Waits (in page frames) until fn(aiStats) is true; returns the stats. Slow software rendering: generous timeouts. */
async function until(label, fn, timeout = 400000) {
  const t0 = Date.now();
  for (;;) {
    const s = await ai();
    if (fn(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`timed out: ${label} ${JSON.stringify(s.zombies.map(z => [z.id, z.state, z.physical, z.position.map(v => +v.toFixed(2))]))}`);
    await frames(5);
  }
}
/**
 * A picture from another viewpoint. The camera is the AI's player, so the AI is stopped (walk off) while the camera is
 * away and the player view is restored before it runs again.
 */
async function viewShot(name, from, to) {
  await page.evaluate((from, to) => {
    const lab = window.__lab, cam = lab.camera, rig = cam.parent;
    lab.walking = false;
    const pistol = lab.scene.getObjectByName('pistol'); if (pistol) pistol.visible = false;   // the held pistol fills other views
    lab.saved = { rig: rig.position.toArray(), cam: cam.position.toArray(), quat: cam.quaternion.toArray() };
    rig.position.set(from[0], 0, from[2]); cam.position.set(0, from[1], 0); cam.lookAt(new lab.THREE.Vector3(...to)); cam.updateMatrixWorld(true);
  }, from, to);
  await frames(3); await shot(name);
  await page.evaluate(() => {
    const lab = window.__lab, cam = lab.camera, s = lab.saved;
    cam.parent.position.fromArray(s.rig); cam.position.fromArray(s.cam); cam.quaternion.fromArray(s.quat); cam.updateMatrixWorld(true);
    const pistol = lab.scene.getObjectByName('pistol'); if (pistol) pistol.visible = true;
    lab.walking = true;
  });
  await frames(2);
}
/** Player view: standing at (0, 2.6) looking down the room toward the barricade. */
const playerView = () => page.evaluate(() => { const { camera, THREE } = window.__lab; camera.parent.position.set(0, 0, 2.6); camera.position.set(0, 1.62, 0); camera.lookAt(new THREE.Vector3(0, 1.0, -2)); camera.updateMatrixWorld(true); });

try {
  browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 900000, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1100, height: 720 } });
  page = await browser.newPage(); page.setDefaultTimeout(600000);
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const t0 = Date.now();
  // alert=0: the zombies do not know where the player is; walk=0 until the stage is set
  await page.goto('http://127.0.0.1:5322/zombie.html?zombies=2&walk=0&alert=0&seed=7&aidebug=1', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lab?.zombies?.length === 2, { timeout: 300000, polling: 1000 });
  await page.evaluate(() => window.__lab.ready);
  measured.loadSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  await page.evaluate(() => { document.querySelector('aside').style.display = 'none'; });
  await playerView();

  // 1. Roaming, deaf to nothing: no zombie knows where the player is (10+ m away, behind the barricade).
  await page.evaluate(() => { window.__lab.walking = true; });
  await frames(60);
  let s = await ai();
  measured.roam = s.zombies.map(z => ({ state: z.state, at: z.position.map(v => +v.toFixed(2)) }));
  assert.ok(s.zombies.every(z => z.state === 'roam' && z.position[2] < -5.6), `roaming behind the barricade ${JSON.stringify(measured.roam)}`);
  checks.push('with no stimulus the zombies roam behind the barricade');
  await viewShot('01-roam-overview.png', [3.8, 6.5, 1.5], [0, 0, -5]);

  // 2. A gunshot (a miss into the floor) pulls both distant zombies.
  await page.evaluate(() => window.__lab.fire([0.3, -0.4, -1]));
  s = await until('investigate', s => s.zombies.every(z => z.state === 'investigate' || z.state === 'chase'), 120000);
  measured.gunshot = s.zombies.map(z => ({ state: z.state, memory: +z.memory.toFixed(1), path: z.path.map(p => p.map(v => +v.toFixed(2))) }));
  checks.push('a pistol shot is heard ~10 m away: both zombies investigate');
  await frames(20);
  await viewShot('02-gunshot-paths.png', [3.8, 6.5, 1.5], [0, 0, -5]);

  // 3. They path around the barricade's open (right) end to the player: tracked positions never cross the barricade.
  const track = { maxX: [-9, -9], crossed: [false, false], blocked: 0 };
  s = await until('past the barricade', s => {
    s.zombies.forEach((z, i) => { if (z.position[2] < -5.2) track.maxX[i] = Math.max(track.maxX[i], z.position[0]); if (z.position[2] > -5.0) track.crossed[i] = true; });
    return track.crossed.every(Boolean);
  });
  measured.pathAround = { maxXBehind: track.maxX.map(v => +v.toFixed(2)) };
  const barricadeEnd = 1.0;
  const startX = measured.roam.map(z => z.at[0]);
  measured.pathAround.startX = startX;
  for (let i = 0; i < 2; i++) if (startX[i] < barricadeEnd - 0.2) assert.ok(track.maxX[i] > barricadeEnd + 0.1, `zombie ${i} went around the end (${track.maxX[i]})`);
  checks.push(`the zombies path around the barricade end (x up to ${measured.pathAround.maxXBehind.join(', ')} behind it; the end is at x ${barricadeEnd})`);
  await viewShot('03-around-barricade.png', [3.8, 6.5, 1.5], [0, 0, -4]);

  // 4. At the player: surround, telegraph (windup with the arms reaching), then the attack lands as damage on the HUD.
  s = await until('telegraph', s => s.zombies.some(z => z.state === 'windup'));
  const winder = s.zombies.findIndex(z => z.state === 'windup');
  measured.windup = { zombie: winder, telegraph: s.zombies[winder].telegraph, attack: s.zombies[winder].attack, target: s.zombies[winder].target, slots: s.zombies.map(z => z.slot) };
  await frames(4); await shot('04-telegraph-player-view.png');
  await viewShot('05-telegraph-side.png', [2.6, 1.7, 1.0], [0, 1.0, 2.2]);
  s = await until('attack', s => s.attacks.length > 0);
  measured.firstAttack = s.attacks[0]; measured.healthAfterFirst = s.health;
  assert.ok(s.attacks[0].damage > 0 && s.health < 100, `attack ${JSON.stringify(s.attacks[0])}`);
  await frames(2); await shot('06-hit-vignette.png');
  checks.push(`a zombie telegraphs (${measured.windup.attack} at ${measured.windup.target}) and then attacks: ${s.attacks[0].kind} for ${s.attacks[0].damage}, health ${s.health}`);

  // 5. Legless: zombie 1 is killed (head off), zombie 0 loses a leg: downed for the fall, recovers into the crawl, then
  // crawls in and attacks low (ankle / leg bite). The player is healed so the test is not cut short by dying.
  await page.evaluate(() => { window.__lab.player.health = 100; window.__lab.player.attacks.length = 0; });
  const crawlerIndex = 0, otherIndex = 1;
  // kill zombie 1: heavy shots until gore reports it dead (a shot from the camera may take the jaw first)
  const kills = [];
  for (const region of ['neck', 'head', 'chest', 'chest', 'belly']) {
    if (await page.evaluate(i => window.__lab.zombies[i].gore.dead, otherIndex)) break;
    kills.push(await page.evaluate((i, r) => window.__lab.shootRegion(i, r, 200), otherIndex, region));
  }
  measured.kill = kills;
  assert.ok(await page.evaluate(i => window.__lab.zombies[i].gore.dead, otherIndex), `kill ${JSON.stringify(kills)}`);
  await frames(2);
  assert.equal((await ai()).zombies[otherIndex].state, 'dead');
  // push the crawler back a little so the crawl to the player is visible
  // the dead zombie stands in the crawler's line of fire, so it is moved out of the way first
  await page.evaluate((c, o) => { window.__lab.zombies[o].position.set(-3.5, 0, -8.5); window.__lab.zombies[c].position.set(0.6, 0, 0.4); }, crawlerIndex, otherIndex);
  await frames(2);
  const leg = await page.evaluate(i => window.__lab.shootRegion(i, 'leftUpperLeg', 65), crawlerIndex);
  measured.leg = leg;
  assert.ok(leg && leg.events.includes('sever:leftUpperLeg') && !leg.events.some(e => e.startsWith('death')), `leg ${JSON.stringify(leg)}`);
  s = await ai();
  measured.afterLeg = { physical: s.zombies[crawlerIndex].physical, state: s.zombies[crawlerIndex].state };
  assert.equal(s.zombies[crawlerIndex].physical, 'downed');
  checks.push('a severed leg sets the physical state to downed (placeholder for the ragdoll layer): the brain pauses');
  await frames(3); await shot('07-legless-downed.png');
  s = await until('recovered into the crawl', s => s.zombies[crawlerIndex].physical === 'standing' && s.zombies[crawlerIndex].gait === 'crawl', 200000);
  const crawlStart = s.zombies[crawlerIndex].position;
  s = await until('low attack', s => s.attacks.length > 0);
  const crawlEnd = s.zombies[crawlerIndex].position;
  measured.crawl = { from: crawlStart.map(v => +v.toFixed(2)), to: crawlEnd.map(v => +v.toFixed(2)), attack: s.attacks[0] };
  assert.ok(['ankle', 'legBite'].includes(s.attacks[0].kind) && s.attacks[0].target === 'legs', `low attack ${JSON.stringify(s.attacks[0])}`);
  checks.push(`the legless zombie crawls in and attacks low (${s.attacks[0].kind} at the legs, ${s.attacks[0].damage} damage)`);
  await viewShot('08-crawler-attack-side.png', [2.4, 1.2, 2.0], [0, 0.3, 2.3]);
  await frames(2); await shot('09-crawler-player-view.png');

  // 6. Death and restart: low health, the next attack kills; the death screen's Genstart button restarts the lab.
  await page.evaluate(() => { window.__lab.player.health = 3; });
  await until('dead', s => s.dead);
  await frames(3); await shot('10-you-died.png');
  const shown = await page.evaluate(() => getComputedStyle(document.getElementById('death')).display);
  assert.equal(shown, 'flex');
  await page.click('#restart');
  await frames(5);
  s = await ai();
  measured.restart = { health: s.health, dead: s.dead, states: s.zombies.map(z => z.state), z: s.zombies.map(z => +z.position[2].toFixed(2)) };
  assert.ok(s.health === 100 && !s.dead && s.zombies.every(z => z.position[2] < -6), `restart ${JSON.stringify(measured.restart)}`);
  checks.push('the death screen appears at 0 health and Genstart restarts with full health and zombies back behind the barricade');

  measured.world = (await ai()).world;
  assert.ok(measured.world.maxRaysInTick <= 12, `rays per tick ${measured.world.maxRaysInTick}`);
  checks.push(`sight rays stay within the per-tick budget (max ${measured.world.maxRaysInTick} of 12)`);
  assert.deepEqual(errors, []); checks.push('no page errors');
  writeFileSync(resolve(output, 'ai-smoke.json'), JSON.stringify({ checks, measured }, null, 2));
  console.log(checks.map(c => `ok - ${c}`).join('\n'));
  console.log(JSON.stringify(measured, null, 1));
} catch (error) {
  try { if (page) await page.screenshot({ path: resolve(output, 'failure.png') }); } catch {}
  console.error(errors.join('\n'));
  throw error;
} finally { await closeSmokeResources({ browser, server }); }
