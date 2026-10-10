// Browser smoke test (npm run test:browser): system Chrome/Edge (puppeteer-core, SwiftShader) against the Vite dev server
// on a test port, saving into a temp file. No headset: the XR part runs on IWER's emulated Quest 3 with hand input, which
// is injected by the test in front of src/main.js (emulation code is never part of the app).
//  1. desktop page loads without console errors, the avatar twin loads when Contracts is synced;
//  2. the synthetic hand is captured, scored, saved through the endpoint (right + mirrored left) and undone;
//  3. an IWER XR session with tracked hands: the studio reads 25 joints per hand, scores live feedback, renders.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CANDIDATES = [
  process.env.CHROME, process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = CANDIDATES.find(c => existsSync(c));
if (!chrome) { console.error('No Chrome/Edge found: set CHROME=<path to chrome>'); process.exit(2); }

const results = [], errors = [], warnings = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const contractsSynced = existsSync(join(root, 'src/vendor/extensions/character-cc/vendor/cc/character.js'));

const dir = await mkdtemp(join(tmpdir(), 'grasp-studio-smoke-'));
const out = join(dir, 'recorded_grasps.json');
process.env.GRASP_STUDIO_PORT = process.env.GRASP_STUDIO_PORT || '5191';
process.env.GRASP_STUDIO_OUT = out;
const handOut = join(dir, 'recorded_hand.json');
process.env.GRASP_STUDIO_HAND_OUT = handOut;
const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'warn' });
await server.listen();
const base = `http://127.0.0.1:${process.env.GRASP_STUDIO_PORT}/`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', defaultViewport: { width: 1100, height: 760 },
  args: ['--no-first-run', '--no-default-browser-check', ...(process.env.BROWSER_GPU === '0' ? ['--use-angle=swiftshader'] : []), '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });

async function open(url, { iwer = false } = {}) {
  const page = await browser.newPage();
  const tag = iwer ? 'xr' : 'desktop';
  page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); else if (m.type() === 'warn' || m.type() === 'warning') warnings.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('requestfailed', r => errors.push(`${tag} requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  if (iwer) {
    // The transformed main.js from Vite, with the IWER runtime installed first (Quest 3 profile, hands as primary input).
    const main = await (await fetch(new URL('src/main.js', base))).text();
    const prelude = `const __emu = await import('/node_modules/iwer/build/iwer.module.js');
const __device = new __emu.XRDevice(__emu.metaQuest3, { stereoEnabled: true });
__device.installRuntime({ forceInstall: true });
__device.primaryInputMode = 'hand';
__device.position.set(0, 1.6, 0);
window.__iwer = __device;
`;
    await page.setRequestInterception(true);
    page.on('request', r => (new URL(r.url()).pathname === '/src/main.js' ? r.respond({ status: 200, contentType: 'text/javascript', body: prelude + main }) : r.continue()));
  }
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', { timeout: 120000, polling: 100 });
  return page;
}

try {
  // 1 + 2: desktop with the synthetic hand.
  const page = await open(`${base}?synthetic&quality=1`);
  if (contractsSynced) {
    await page.waitForFunction('!!window.__studio.twin', { timeout: 120000, polling: 250 }).catch(() => {});
    check('avatar twin (Contracts CharacterCreator player) loads', await page.evaluate(() => !!window.__studio.twin?.player));
  } else check('Contracts not synced: studio runs without the avatar twin', await page.evaluate(() => !window.__studio.twin));
  await page.waitForFunction('!!window.__studio.studio.review', { timeout: 60000, polling: 100 });
  const review = await page.evaluate(() => { const r = window.__studio.studio.review; return { id: r.pose.id, score: r.score.score, ok: r.score.ok, frames: r.frames, mirror: r.mirror?.id, mirrorScore: r.mirrorScore?.score }; });
  check('synthetic grasp auto-captured, scored and mirrored', review.ok && review.score >= 80 && review.frames >= 20 && review.mirror, review);
  const badge = await page.evaluate(() => window.__studio.scene.children.some(o => o.isSprite && o.visible));
  check('result badge shown', badge);
  await page.evaluate(() => window.__studio.actions['save-default']());
  await page.waitForFunction(() => /Gemt|Kunne ikke/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  const saved = JSON.parse(await readFile(out, 'utf8'));
  check('saved through /api/grasps into the library file (right + mirrored left, default)', saved.poses.length === 2 && saved.poses.every(p => p.default) && saved.poses.map(p => p.side).sort().join() === 'left,right', saved.poses.map(p => p.id));
  const listed = await page.evaluate(() => document.getElementById('library').textContent);
  check('library line on the page updated', /recorded_grasps\.json: 2 \(standard: right\/body, left\/body|left\/body, right\/body\)/.test(listed), listed);
  await page.evaluate(() => window.__studio.actions['undo-save']());
  await page.waitForFunction(() => /Slettet|Kunne ikke slette/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  check('undo removes the saved poses again', JSON.parse(await readFile(out, 'utf8')).poses.length === 0);
  await page.evaluate(() => window.__studio.actions.quality());
  check('quality switch cycles the tiers', await page.evaluate(() => document.getElementById('quality').value === '2'));
  // Gesture mode (step 7): the synthetic hand's still grip is captured as a hand pose and saved through /api/hand.
  await page.evaluate(() => { const a = window.__studio.actions; a.mode(); a.mode(); a['clip-name'](); a.synthetic(); a.synthetic(); });
  await page.waitForFunction('!!window.__studio.studio.review?.clip', { timeout: 60000, polling: 100 });
  const gesture = await page.evaluate(() => { const r = window.__studio.studio.review; return { mode: r.mode, id: r.clip.id, kind: r.clip.kind, frames: r.clip.frames.length, mirror: r.mirror?.side, hard: r.report.hard }; });
  check('gesture mode captures a hand pose clip (+ mirror)', gesture.mode === 'gesture' && gesture.kind === 'pose' && gesture.frames === 1 && gesture.id === 'thumbs_up' && gesture.mirror === 'left', gesture);
  await page.evaluate(() => window.__studio.actions.save());
  await page.waitForFunction(() => /Gemt|Kunne ikke/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  const hand = JSON.parse(await readFile(handOut, 'utf8'));
  check('saved through /api/hand into the hand library file (right + left)', hand.clips.length === 2 && hand.clips.map(c => c.side).sort().join() === 'left,right', hand.clips.map(c => `${c.id}/${c.side}`));
  await page.evaluate(() => window.__studio.actions['undo-save']());
  await page.waitForFunction(() => /Slettet|Kunne ikke slette/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  check('undo removes the saved hand clips again', JSON.parse(await readFile(handOut, 'utf8')).clips.length === 0);
  await page.close();

  // 3: IWER XR session with tracked hands.
  const xr = await open(`${base}?quality=0`, { iwer: true });
  await xr.waitForFunction(() => /VR/i.test([...document.querySelectorAll('button')].find(b => b.id === 'VRButton')?.textContent || ''), { timeout: 20000, polling: 100 }).catch(() => {});
  await xr.click('#enter-xr');
  await xr.waitForFunction('window.__studio.renderer.xr.isPresenting', { timeout: 30000, polling: 100 });
  // Right hand at the bottle (placed 0.38 m in front of the head, 0.5 m below it on session start).
  await xr.evaluate(() => { const d = window.__iwer; d.hands.right.position.set(0.07, 1.16, -0.36); d.hands.left.position.set(-0.25, 1.2, -0.25); });
  // A few frames after the jump the fingertip jitter is gone and confidence is high (static emulated hand).
  await xr.waitForFunction(() => window.__studio.studio.live?.valid && window.__studio.studio.live.confidence.right > 0.5, { timeout: 20000, polling: 100 }).catch(() => {});
  const live = await xr.evaluate(() => { const l = window.__studio.studio.live; return l && { valid: l.valid, side: l.side, confidence: l.confidence, tips: l.tips, onItem: l.onItem, item: window.__studio.studio.item.pos.map(v => +v.toFixed(3)) }; });
  check('IWER hand tracking: 25 joints read, live feedback computed', live?.valid && live.side === 'right' && live.tips && Object.keys(live.tips).length === 5 && live.confidence.right > 0, live);
  const panel = await xr.evaluate(() => window.__studio.scene.children.some(o => o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.visible));
  check('in-XR panel visible while presenting', panel);
  await xr.close();
} catch (error) {
  check(`smoke run: ${error.message}`, false);
} finally {
  await browser.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
check('no console errors', errors.length === 0, errors.slice(0, 10));
if (warnings.length) console.log(`warnings (${warnings.length}):\n  ${[...new Set(warnings)].slice(0, 12).join('\n  ')}`);
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed (Chrome + IWER emulation only; no headset).`);
process.exit(failed ? 1 : 0);
