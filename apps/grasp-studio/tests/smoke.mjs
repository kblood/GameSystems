// Browser smoke test (npm run test:browser): system Chrome/Edge (puppeteer-core, SwiftShader) against the Vite dev server
// on a test port, saving into a temp file. No headset: the XR part runs on IWER's emulated Quest 3 with hand input, which
// is injected by the test in front of src/main.js (emulation code is never part of the app).
//  1. desktop page loads without console errors, the avatar twin loads when Contracts is synced;
//  2. the synthetic hand is captured, scored; a refused save stays in the queue (localStorage) with a red toast, the
//     retry saves it through the endpoint as a new variant (right + mirrored left), the variant preview shows it, undone;
//     the optional avatar views (mirror: reflected live record, self: first person) and the character switch;
//  3. an IWER XR session with tracked hands: the studio reads 25 joints per hand, scores live feedback, renders; the
//     recording hand's index presses the panel; leaving VR restores the page and VR can be entered again.
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
  // A refused save (the stale-validator 400 of the Quest session) is kept in the queue, announced red, retried later.
  await page.evaluate(() => {
    window.__realFetch = window.fetch;
    window.fetch = (url, init) => (init?.method === 'POST' && String(url).includes('api/grasps')
      ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'save: invalid pose test', kept: 'test.rejected.jsonl' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      : window.__realFetch(url, init));
  });
  await page.evaluate(() => window.__studio.actions['save-default']());
  await page.waitForFunction(() => /Gemt|IKKE GEMT/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  const refused = await page.evaluate(() => ({ message: window.__studio.message, toast: { text: window.__studio.toast.text, ok: window.__studio.toast.ok }, dom: document.getElementById('toast').className,
    queued: window.__studio.api.pending().length, stored: JSON.parse(localStorage.getItem(window.__studio.api.PENDING_KEY) || '[]').length }));
  check('a refused save is queued (localStorage), announced red in VR and on the page', refused.queued === 1 && refused.stored === 1 && !refused.toast.ok && /IKKE GEMT/.test(refused.toast.text) && refused.dom === 'fail' && /test.rejected/.test(refused.message), refused);
  check('nothing written by the refused save', !existsSync(out) || JSON.parse(await readFile(out, 'utf8')).poses.length === 0);
  await page.evaluate(() => { window.fetch = window.__realFetch; return window.__studio.actions['retry-queue'](); });
  await page.waitForFunction(() => /fra køen/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  const retried = await page.evaluate(() => ({ message: window.__studio.message, ok: window.__studio.toast.ok, queued: window.__studio.api.pending().length, stored: JSON.parse(localStorage.getItem(window.__studio.api.PENDING_KEY) || '[]').length }));
  check('"Gem kø" saves the queued recording and empties the queue', retried.ok && retried.queued === 0 && retried.stored === 0, retried);
  const saved = JSON.parse(await readFile(out, 'utf8'));
  check('saved through /api/grasps into the library file (right + mirrored left, default)', saved.poses.length === 2 && saved.poses.every(p => p.default) && saved.poses.map(p => p.side).sort().join() === 'left,right', saved.poses.map(p => p.id));
  const listed = await page.evaluate(() => document.getElementById('library').textContent);
  check('library line on the page updated', /recorded_grasps\.json: 2 \(foretrukne: (right\/body, left\/body|left\/body, right\/body)\)/.test(listed), listed);
  const variant = await page.evaluate(() => { const a = window.__studio.actions; a.variant(); const first = window.__studio.currentVariant(); a.variant(); const second = window.__studio.currentVariant(); a.variant(); return { first: first && [first.index, first.count, first.label], second: second && [second.index, second.count], after: window.__studio.currentVariant() }; });
  check('variant preview: the original, then the new recording, then off', variant.first?.[1] === 2 && variant.first[2] === 'original' && variant.second?.[0] === 1 && variant.after === null, variant);
  await page.evaluate(() => window.__studio.actions['undo-save']());
  await page.waitForFunction(() => /Slettet|Kunne ikke slette/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  check('undo removes the saved poses again', JSON.parse(await readFile(out, 'utf8')).poses.length === 0);
  await page.evaluate(() => window.__studio.actions.quality());
  check('quality switch cycles the tiers', await page.evaluate(() => document.getElementById('quality').value === '2'));
  // Two-hand kinds (step B): cycling the item rebuilds the meshes, the secondary role shows the partner hand; back to the bottle.
  const kinds = await page.evaluate(() => {
    const S = window.__studio, a = S.actions, seen = [];
    for (let i = 0; i < S.KINDS.length; i++) { a.kind(); seen.push(S.studio.settings.kind); }
    a.kind(); a.kind(); a.kind(); // pole -> barrel -> bottle_beer wraps; land on a known kind below
    while (S.studio.settings.kind !== 'pole') a.kind();
    a.role();
    const out = { seen, role: S.studio.settings.role, grasp: S.studio.settings.grasp, partner: !!S.studio.partner, children: S.scene.children.length };
    a.role(); a.weightlag(); out.lag = S.studio.settings.weightLag; a.weightlag();
    while (S.studio.settings.kind !== 'bottle_beer') a.kind();
    out.back = S.studio.settings.kind;
    return out;
  });
  check('item kinds cycle, the secondary role shows the partner hand, the weight lag switches', kinds.seen.length === 6 && kinds.seen.includes('ladder') && kinds.role === 'secondary' && kinds.partner && kinds.lag === false && kinds.back === 'bottle_beer', kinds);
  // Gesture mode (step 7): the synthetic hand's still grip is captured as a hand pose and saved through /api/hand.
  await page.evaluate(() => { const a = window.__studio.actions; a.mode(); a.mode(); a['clip-name'](); a.synthetic(); a.synthetic(); });
  await page.waitForFunction('!!window.__studio.studio.review?.clip', { timeout: 60000, polling: 100 });
  const gesture = await page.evaluate(() => { const r = window.__studio.studio.review; return { mode: r.mode, id: r.clip.id, kind: r.clip.kind, frames: r.clip.frames.length, mirror: r.mirror?.side, hard: r.report.hard }; });
  check('gesture mode captures a hand pose clip (+ mirror)', gesture.mode === 'gesture' && gesture.kind === 'pose' && gesture.frames === 1 && /^thumbs_up@rec-\d{8}T\d{6}$/.test(gesture.id) && gesture.mirror === 'left', gesture);
  await page.evaluate(() => window.__studio.actions.save());
  await page.waitForFunction(() => /Gemt|IKKE GEMT/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  const hand = JSON.parse(await readFile(handOut, 'utf8'));
  check('saved through /api/hand into the hand library file as a variant of thumbs_up (right + left)', hand.clips.length === 2 && hand.clips.every(c => c.id === gesture.id && c.variantOf === 'thumbs_up') && hand.clips.map(c => c.side).sort().join() === 'left,right', hand.clips.map(c => `${c.id}/${c.side}`));
  await page.evaluate(() => window.__studio.actions['undo-save']());
  await page.waitForFunction(() => /Slettet|Kunne ikke slette/.test(window.__studio.message), { timeout: 20000, polling: 100 });
  check('undo removes the saved hand clips again', JSON.parse(await readFile(handOut, 'utf8')).clips.length === 0);
  // Avatar views (optional; the default stays the twin): mirror = the live record reflected ~1.5 m ahead, self = first person.
  if (await page.evaluate(() => !!window.__studio.twin?.player)) {
    check('default avatar view is the twin', await page.evaluate(() => window.__studio.avatarView === 'twin' && window.__studio.viewRecord === null));
    await page.evaluate(() => window.__studio.actions['avatar-view']());
    await page.waitForFunction(() => window.__studio.viewRecord && window.__studio.twin.view === 'mirror', { timeout: 10000, polling: 100 }).catch(() => {});
    const m = await page.evaluate(() => {
      const r = window.__studio.viewRecord, l = window.__studio.liveRecord;
      if (!r || !l) return null;
      // The mirror plane: through the midpoint of the head and its image, normal along their difference. The live right
      // wrist's image must be the mirror avatar's left wrist (same plane), and the snaps swap handedness.
      const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
      const d = sub(r.head.pos, l.head.pos), dist = Math.hypot(...d), n = d.map(v => v / dist), plane = dot(mid(r.head.pos, l.head.pos), n);
      const hand = l.hands.right.valid && r.hands.left.valid ? { off: +(dot(mid(r.hands.left.pos, l.hands.right.pos), n) - plane).toFixed(4),
        along: +Math.hypot(...sub(sub(r.hands.left.pos, l.hands.right.pos), n.map(v => v * dot(sub(r.hands.left.pos, l.hands.right.pos), n)))).toFixed(4) } : null;
      return { dist: +dist.toFixed(3), hand, live: [l.hands.left.valid, l.hands.right.valid], view: [r.hands.left.valid, r.hands.right.valid],
        snaps: [l.snaps.map(x => x.handedness).sort().join(), r.snaps.map(x => x.handedness).join()], liveSnaps: l.snaps.map(x => x.handedness).join(), mode: window.__studio.twin.view };
    });
    const swappedSnaps = m && m.snaps[1] === m.liveSnaps.split(',').map(s => (s === 'left' ? 'right' : 'left')).join();
    check('mirror view: the live record is reflected (avatar ~1.5 m ahead, the right wrist drives the mirrored left, snaps swapped)',
      m && m.mode === 'mirror' && Math.abs(m.dist - 1.5) < 0.01 && m.hand && Math.abs(m.hand.off) < 1e-3 && m.hand.along < 1e-3 && m.view.join() === [...m.live].reverse().join() && swappedSnaps, m);
    await page.evaluate(() => window.__studio.actions['avatar-view']());
    await page.waitForFunction(() => window.__studio.twin.view === 'self', { timeout: 10000, polling: 100 }).catch(() => {});
    const self = await page.evaluate(() => { const r = window.__studio.viewRecord; return r && { view: window.__studio.twin.view, right: r.hands.right.valid, z: +r.head.pos[2].toFixed(3) }; });
    check('first-person view: the unreflected live record drives the avatar', self && self.view === 'self' && self.right && self.z > 0, self);
    const thumb = await page.evaluate(() => { const T = window.__studio.THUMB_AXIS, a = window.__studio.actions; const was = [T.roll, T.twist]; a['avatar-thumb'](); const now = [T.roll, T.twist]; a['avatar-thumb'](); a['avatar-thumb'](); return { was, now, back: [T.roll, T.twist] }; });
    check('thumb roll/twist switch cycles and returns', thumb.now.join() !== thumb.was.join() && thumb.back.join() === thumb.was.join(), thumb);
    await page.evaluate(() => window.__studio.actions['avatar-view']());
    await page.waitForFunction(() => window.__studio.twin.view === 'twin', { timeout: 10000, polling: 100 }).catch(() => {});
    check('back to the twin view', await page.evaluate(() => window.__studio.avatarView === 'twin' && window.__studio.twin.view === 'twin' && window.__studio.viewRecord === null));
    if (existsSync(join(root, 'public/vrm-assets'))) {
      const swapped = await page.evaluate(async () => { const a = window.__studio.actions, t = window.__studio.twin, from = t.character; await a['avatar-character'](); const to = t.character, err = t.loadError; await a['avatar-character'](); return { from, to, back: t.character, error: err || t.loadError }; });
      check('character switch CC <-> VRM (Jimmy) and back', swapped.to !== swapped.from && swapped.back === swapped.from && !swapped.error, swapped);
    }
  }
  await page.close();

  // 3: IWER XR session with tracked hands.
  const xr = await open(`${base}?quality=0`, { iwer: true });
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
  // The recording (right) hand's index tip pokes the panel's mode button: it used to count only the other hand.
  const poked = await xr.evaluate(async () => {
    const S = window.__studio, d = window.__iwer, session = S.renderer.xr.getSession(), ref = S.renderer.xr.getReferenceSpace();
    const tipNow = () => new Promise(res => session.requestAnimationFrame((_, f) => {
      const src = [...session.inputSources].find(s => s.hand && s.handedness === 'right'), p = src && f.getJointPose(src.hand.get('index-finger-tip'), ref);
      res(p && [p.transform.position.x, p.transform.position.y, p.transform.position.z]);
    }));
    const b = S.panel.buttons.find(x => x.id === 'mode'), [x, y, w, h] = S.panel.rect(b), c = S.panel.tex.canvas, [pw, ph] = S.panel.size;
    const target = S.panel.mesh.localToWorld(S.panel.mesh.position.clone().set(((x + w / 2) / c.width - 0.5) * pw, (0.5 - (y + h / 2) / c.height) * ph, 0.03));
    const before = S.studio.settings.mode;
    for (const z of [0.03, 0.0]) {   // approach from in front, then touch
      const at = S.panel.mesh.localToWorld(S.panel.mesh.worldToLocal(target.clone()).setZ(z));
      for (let i = 0; i < 3; i++) {   // the emulated hand pose settles over a few frames
        const tip = await tipNow(); if (!tip) return { error: 'no tip' };
        d.hands.right.position.set(d.hands.right.position.x + at.x - tip[0], d.hands.right.position.y + at.y - tip[1], d.hands.right.position.z + at.z - tip[2]);
        await new Promise(r => setTimeout(r, 120));
      }
    }
    await new Promise(r => setTimeout(r, 300));
    return { before, after: S.studio.settings.mode };
  });
  check('the recording hand presses the in-XR panel', poked.after && poked.after !== poked.before, poked);
  // Leaving VR restores the page; VR can be entered again.
  await xr.evaluate(() => window.__studio.renderer.xr.getSession().end());
  await xr.waitForFunction('!window.__studio.renderer.xr.isPresenting', { timeout: 20000, polling: 100 });
  await xr.waitForFunction(() => document.getElementById('enter-xr').textContent === 'Gå i VR' && !document.getElementById('enter-xr').disabled, { timeout: 5000, polling: 100 }).catch(() => {});
  const page2d = await xr.evaluate(() => { const m = window.__studio.studio.settings.mode; document.getElementById('a-mode')?.click(); return { label: document.getElementById('enter-xr').textContent, changed: window.__studio.studio.settings.mode !== m }; });
  check('after leaving VR the page buttons work', page2d.label === 'Gå i VR' && page2d.changed, page2d);
  await xr.click('#enter-xr');
  const again = await xr.waitForFunction('window.__studio.renderer.xr.isPresenting', { timeout: 30000, polling: 100 }).then(() => true, () => false);
  check('VR can be entered again after leaving', again);
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
