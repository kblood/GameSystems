// Grasp Studio hand modes (extensions plan step 7): the animation capture (still -> record -> still), the studio's
// animation and gesture modes through the avatar's recording pipeline, and the /api/hand store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnimationCapture, ANIM } from '../src/capture.js';
import { createStudio, syntheticHands } from '../src/studio.js';
import { applyHandAction, emptyHandLibrary, serializeHandLibrary, readHandLibrary } from '../server/hand_store.mjs';
import { isClip, buildLibrary, handPose } from '../src/vendor/extensions/avatar/handposes.js';

const FPS = 72;
const sample = (t, x) => ({ t, valid: true, confidence: 1, onItem: true, wrist: [x, 0, 0], quat: [0, 0, 0, 1],
  tips: Array.from({ length: 5 }, (_, f) => [x, f * 0.01, 0.1]), frame: { x } });

test('animation capture: hold still starts, motion records, hold still stops; the still tail is trimmed', () => {
  const cap = createAnimationCapture();
  let st, started = null, recorded = null;
  // still 1.4 s at x = 0, then 1 s moving to x = 0.3, then still at 0.3
  for (let i = 0; i < FPS * 5 && !recorded; i++) {
    const t = i / FPS, x = t < 1.4 ? 0 : t < 2.4 ? 0.3 * (t - 1.4) : 0.3;
    st = cap.update(sample(t, x));
    if (st.started) started = t;
    if (st.recorded) recorded = st.recorded;
  }
  assert.ok(started > ANIM.hold && started < ANIM.hold + 0.4, `started at ${started}`);
  assert.ok(recorded, 'stopped');
  assert.equal(recorded.reason, 'still');
  assert.equal(cap.state, 'review');
  const last = recorded.frames.at(-1);
  assert.ok(last.t >= 2.3 && last.t <= 2.45, `the clip ends where the hand came to rest (${last.t})`);
  assert.ok(Math.abs(last.x - 0.3) < 0.03 && recorded.frames[0].x === 0);
  cap.accept();
  assert.equal(cap.state, 'rearm');
});

test('animation capture: a hand that never moves after the start is cut at maxSeconds; a lost hand ends the take', () => {
  const cap = createAnimationCapture({ maxSeconds: 2 });
  let rec = null;
  for (let i = 0; i < FPS * 6 && !rec; i++) rec = cap.update(sample(i / FPS, 0)).recorded;
  assert.equal(rec?.reason, 'max');
  const cap2 = createAnimationCapture();
  let r2 = null;
  for (let i = 0; i < FPS * 4 && !r2; i++) { const t = i / FPS; r2 = cap2.update(t > 2.5 ? { t, valid: false } : sample(t, t < 1.3 ? 0 : 0.2 * (t - 1.3))).recorded; }
  assert.equal(r2?.reason, 'lost');
});

/** The synthetic hand still (open, lifted) for `wait` s, then approaching and closing on the bottle over 1 s, then still. */
const delayed = (studio, wait) => t => syntheticHands(Math.max(0, t - wait), studio.item, { side: studio.settings.side });

test('studio animation mode: a recorded grab becomes a valid, keyframe-reduced clip from open to the grip (+ mirror)', () => {
  const studio = createStudio({ mode: 'animation', clipName: 'grab' });
  studio.setItem([0, 1, -0.4]);
  const hands = delayed(studio, 1.5);
  for (let i = 0; i < FPS * 8 && !studio.review; i++) studio.update(i / FPS, hands(i / FPS));
  const r = studio.review;
  assert.ok(r?.clip, 'recorded');
  assert.ok(isClip(r.clip) && isClip(r.mirror), 'one frame format');
  assert.equal(r.clip.kind, 'animation');
  assert.equal(r.clip.id, 'grab');
  assert.ok(r.report.keyframes >= 2 && r.report.keyframes < r.report.used / 3, `keyframe reduction ${r.report.keyframes}/${r.report.used}`);
  assert.equal(r.report.hard, 0, 'validator: inside the joint ranges');
  assert.ok(r.clip.duration > 0.6 && r.clip.duration < 1.6, `duration ${r.clip.duration}`);
  const first = r.clip.frames[0].rows.Index, last = r.clip.frames.at(-1).rows.Index;
  assert.ok(last[1] + last[2] > first[1] + first[2] + 40, `the index closes (${first} -> ${last})`);
  assert.equal(r.mirror.side, 'left');
  const saved = studio.accept();
  assert.equal(saved.length, 2);
  assert.equal(studio.review, null);
});

test('studio gesture mode: a still hand anywhere becomes a one-frame hand pose; a saved recording replaces the library pose', () => {
  const studio = createStudio({ mode: 'gesture', clipName: 'fist', autoMirror: false });
  studio.setItem([0, 1, -0.4]);
  for (let i = 0; i < FPS * 4 && !studio.review; i++) studio.update(i / FPS, syntheticHands(i / FPS, studio.item));
  const r = studio.review;
  assert.ok(r?.clip && r.clip.kind === 'pose' && r.clip.space === 'hand' && r.clip.frames.length === 1 && !r.mirror);
  const lib = buildLibrary(undefined, { clips: studio.accept() });
  assert.deepEqual(handPose('fist', lib), r.clip.frames[0].rows);
});

test('hand store: save replaces by id + side, delete removes by id, invalid clips are refused, one clip per line', async () => {
  const studio = createStudio({ mode: 'gesture', clipName: 'point' });
  studio.setItem([0, 1, -0.4]);
  for (let i = 0; i < FPS * 4 && !studio.review; i++) studio.update(i / FPS, syntheticHands(i / FPS, studio.item));
  const clips = studio.accept();
  let { doc, changed } = applyHandAction(emptyHandLibrary(), { action: 'save', clips });
  assert.equal(doc.clips.length, 2);
  assert.deepEqual(changed, ['point']);
  ({ doc } = applyHandAction(doc, { action: 'save', clips: [clips[0]] }));
  assert.equal(doc.clips.length, 2, 'same id + side replaced');
  assert.throws(() => applyHandAction(doc, { action: 'save', clips: [{ id: 'x', kind: 'pose', space: 'hand', frames: [] }] }), /invalid clip/);
  assert.throws(() => applyHandAction(doc, { action: 'delete', ids: ['nope'] }), /no recorded clip/);
  const text = serializeHandLibrary(doc);
  assert.equal(text.split('\n').filter(l => l.startsWith('    {')).length, 2);
  const dir = await mkdtemp(join(tmpdir(), 'hand-store-'));
  try {
    assert.deepEqual((await readHandLibrary(join(dir, 'none.json'))).clips, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
  ({ doc } = applyHandAction(doc, { action: 'delete', ids: ['point'] }));
  assert.equal(doc.clips.length, 0);
});
