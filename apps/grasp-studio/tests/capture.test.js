// Capture logic without a headset: synthetic XR joints (grasp record.js poseJoints on the reference hand) through the
// stillness detector, frame averaging, the auto-capture state machine, the studio model, mirroring and serialisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingConfidence, createStillness, averageCaptures, createAutoCapture, STILL } from '../src/capture.js';
import { createStudio, syntheticHands, tipState, FEEDBACK } from '../src/studio.js';
import {
  defaultPose, referenceHand, poseJoints, captureFromJoints, recordedPose, mirrorPose, isPose, mergePoses, scoreGrasp,
  RECORDED_SCHEMA, XR_CHAINS, quatAngle, placeWrist, REFERENCE_HAND,
} from '../src/vendor/extensions/grasp/index.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const item = { pos: [0.12, 0.95, -0.38], quat: [0, Math.sin(0.35), 0, Math.cos(0.35)] };
const tipsOf = j => FINGERS.map(f => j[XR_CHAINS[f][3]]);
// (a recorded thumb row has a 5th value, its twist: a baked row without one compares as twist 0)
const maxDiff = (a, b) => Math.max(...a.flatMap((r, i) => (Array.isArray(r) ? r.map((v, j) => Math.abs(v - (b[i][j] ?? 0))) : [Math.abs(r - b[i])])));
/** Run the studio at 72 Hz over [t0, t1) with a joints function; returns the last live state. */
function run(studio, t0, t1, hands) {
  let live = null;
  for (let i = Math.round(t0 * 72); i < Math.round(t1 * 72); i++) live = studio.update(i / 72, hands(i / 72));
  return live;
}

test('tracking confidence: missing joints 0, a smooth hand 1, a shaking hand low, emulated poses halved', () => {
  const pose = defaultPose('bottle_beer', 'right', 'body'), hand = referenceHand('right');
  const at = (dx, emulated = false) => ({ tips: tipsOf(poseJoints({ ...pose, wrist: [pose.wrist[0] + dx, pose.wrist[1], pose.wrist[2]] }, hand)), emulated });
  assert.equal(trackingConfidence([]), 0);
  assert.equal(trackingConfidence([{ tips: null }]), 0);
  const smooth = Array.from({ length: 6 }, (_, k) => at(k * 0.004)); // 4 mm per frame, no acceleration
  assert.equal(trackingConfidence(smooth), 1);
  const shaking = Array.from({ length: 6 }, (_, k) => at(k % 2 ? 0.004 : 0));
  assert.ok(trackingConfidence(shaking) < 0.2, `shaking ${trackingConfidence(shaking)}`);
  assert.equal(trackingConfidence(smooth.map(h => ({ ...h, emulated: true }))), 0.5);
});

test('stillness: a still hand is still after `settle`, a moving or turning hand is not', () => {
  const s = createStillness(), tips = Array.from({ length: 5 }, () => [0, 0, 0]);
  let r;
  for (let i = 0; i < 20; i++) r = s.push({ t: i / 72, wrist: [0, 0, i * 1e-5], quat: [0, 0, 0, 1], tips });
  assert.ok(r.still && r.span >= STILL.settle, JSON.stringify(r));
  for (let i = 20; i < 30; i++) r = s.push({ t: i / 72, wrist: [0, 0, (i - 20) * 0.002], quat: [0, 0, 0, 1], tips });
  assert.ok(!r.still && r.wristMm > STILL.wristMm, 'wrist travel');
  s.reset();
  for (let i = 0; i < 30; i++) r = s.push({ t: i / 72, wrist: [0, 0, 0], quat: [Math.sin(i * 0.004), 0, 0, Math.cos(i * 0.004)], tips });
  assert.ok(!r.still && r.angleDeg > STILL.angleDeg, 'rotation');
});

test('averaging: mean wrist, rows and hand length; quaternion sign aligned; spread reported', () => {
  const base = { side: 'right', wrist: [0.06, 0.1, 0.07], quat: [0, 0, Math.sin(0.2), Math.cos(0.2)], angles: FINGERS.map(() => [0, 40, 50, 30]), handLength: 0.19 };
  const list = [-1, 1].map(d => ({ ...base, wrist: base.wrist.map((v, i) => v + (i === 0 ? d * 0.002 : 0)), angles: base.angles.map(r => r.map(v => v + d)), handLength: 0.19 + d * 0.001 }));
  list.push({ ...base, quat: base.quat.map(v => -v) }); // same rotation, other sign
  const avg = averageCaptures(list);
  assert.ok(maxDiff(avg.wrist, base.wrist) < 1e-12 && maxDiff(avg.angles, base.angles) < 1e-12);
  assert.ok(Math.abs(avg.handLength - 0.19) < 1e-12);
  assert.ok(quatAngle(avg.quat, base.quat) < 1e-9, 'sign-aligned quaternion mean');
  assert.equal(avg.frames, 3);
  assert.ok(Math.abs(avg.spread.wristMm - 2) < 1e-9 && Math.abs(avg.spread.rowsDeg - 1) < 1e-9, JSON.stringify(avg.spread));
  assert.throws(() => averageCaptures([]));
});

test('auto-capture: counts down while still on the item, restarts on motion, needs confidence, re-arms after moving away', () => {
  const pose = defaultPose('bottle_beer', 'right', 'body'), hand = referenceHand('right');
  const sample = (t, dx = 0, extra = {}) => {
    const j = poseJoints({ ...pose, wrist: [pose.wrist[0] + dx, pose.wrist[1], pose.wrist[2]] }, hand, item);
    const c = captureFromJoints('right', j, item, hand);
    return { t, valid: true, confidence: 1, onItem: true, capture: c, wrist: c.wrist, quat: c.quat, tips: tipsOf(j), ...extra };
  };
  const auto = createAutoCapture();
  let s;
  for (let i = 0; i < 72; i++) s = auto.update(sample(i / 72));
  assert.equal(s.state, 'holding');
  assert.ok(s.progress > 0.6 && s.progress < 1, `progress ${s.progress}`);
  s = auto.update(sample(73 / 72, 0.02)); // a 2 cm jump: motion
  assert.equal(s.state, 'searching');
  for (let i = 74; i < 74 + 72 * 2; i++) { s = auto.update(sample(i / 72, 0.02, { confidence: 0.3 })); }
  assert.equal(s.state, 'searching', 'low confidence never counts down');
  let captured = null;
  for (let i = 300; i < 300 + 72 * 2 && !captured; i++) captured = auto.update(sample(i / 72, 0.02)).captured;
  assert.ok(captured && captured.frames >= STILL.minFrames, 'captured after the countdown');
  assert.equal(auto.state, 'review');
  assert.ok(Math.abs(captured.wrist[0] - (sample(0, 0.02).capture.wrist[0])) < 1e-9);
  auto.accept();
  for (let i = 500; i < 500 + 72 * 3; i++) s = auto.update(sample(i / 72, 0.02));
  assert.equal(s.state, 'rearm', 'a hand that keeps holding is not captured twice');
  s = auto.update(sample(800 / 72, 0.08));
  assert.equal(s.state, 'searching', 'moving 6 cm away re-arms');
});

test('studio: live feedback colours fingertips (touch / inside / free) and closes the avatar hand to contact', () => {
  assert.equal(tipState(0.001), 'touch'); assert.equal(tipState(-0.004), 'inside'); assert.equal(tipState(0.02), 'free');
  assert.equal(tipState(-FEEDBACK.penetrationMm / 1000 + 1e-6), 'touch');
  const studio = createStudio(); studio.setItem(item.pos, item.quat);
  let live = run(studio, 1.2, 1.4, t => syntheticHands(t, studio.item));
  assert.ok(live.valid && live.onItem, 'hand on the item');
  assert.ok(FINGERS.filter(f => live.tips[f] === 'touch').length >= 4, JSON.stringify(live.tips));
  assert.ok(live.closed && live.closed.angles.length === 5, 'avatar hand closed to contact');
  assert.ok(live.confidence.right > 0.9 && live.confidence.left > 0.9, JSON.stringify(live.confidence));
  // Push the hand 12 mm into the bottle: fingertips read as inside.
  const pose = defaultPose('bottle_beer', 'right', 'body'), radial = [pose.wrist[0], 0, pose.wrist[2]], r = Math.hypot(...radial);
  const deep = { ...pose, wrist: pose.wrist.map((v, i) => v - radial[i] / r * 0.012) };
  live = studio.update(2, { right: { joints: poseJoints(deep, referenceHand('right'), studio.item) } });
  assert.ok(FINGERS.some(f => live.tips[f] === 'inside'), JSON.stringify(live.tips));
  live = studio.update(2.1, { right: { joints: poseJoints({ ...pose, wrist: [pose.wrist[0], pose.wrist[1] + 0.3, pose.wrist[2]] }, referenceHand('right'), studio.item) } });
  assert.ok(!live.onItem && FINGERS.every(f => live.tips[f] === 'free'));
});

test('studio: a synthetic grasp is captured, scored and mirrored; the capture reproduces the held pose', () => {
  const studio = createStudio(); studio.setItem(item.pos, item.quat);
  const live = run(studio, 0, 3, t => syntheticHands(t, studio.item, { noiseMm: 0.3 }));
  const r = studio.review, pose = defaultPose('bottle_beer', 'right', 'body');
  assert.ok(r, `captured (state ${live.auto.state})`);
  assert.ok(r.frames >= 60 && r.frames <= 80, `about 1 s of frames: ${r.frames}`);
  assert.ok(Math.hypot(...r.pose.wrist.map((v, i) => v - pose.wrist[i])) < 5e-4, 'wrist within 0.5 mm');
  assert.ok(quatAngle(r.pose.quat, pose.quat) < 0.5 * Math.PI / 180, 'hand frame within 0.5 deg');
  assert.ok(maxDiff(r.pose.angles, pose.angles) < 1.5, `rows within 1.5 deg: ${maxDiff(r.pose.angles, pose.angles)}`);
  assert.ok(Math.abs(r.pose.handLength - REFERENCE_HAND.length) < 1e-3, `reference hand length ${r.pose.handLength}`);
  assert.ok(isPose(r.pose) && r.pose.id.startsWith('bottle_beer/right/body/rec-'));
  assert.ok(r.score.ok && r.score.score >= 80, `score ${r.score.score} ${r.score.failures}`);
  assert.equal(r.pose.recorded.score, r.score.score);
  assert.equal(r.mirror.side, 'left'); assert.equal(r.mirror.id, r.pose.id.replace('/right/', '/left/') + '-m');
  assert.ok(r.mirrorScore.score >= 70, `mirrored score ${r.mirrorScore.score}`);
  // The mirrored grasp on the left reference hand is the reflection (item z -> -z) of the right one.
  const a = poseJoints(r.pose, referenceHand('right')), b = poseJoints(r.mirror, referenceHand('left'));
  for (const name of Object.keys(a)) assert.ok(Math.hypot(a[name][0] - b[name][0], a[name][1] - b[name][1], a[name][2] + b[name][2]) < 2e-5, name);
  const saved = studio.accept({ markDefault: true });
  assert.equal(saved.length, 2); assert.ok(saved.every(p => p.default));
  assert.equal(studio.review, null);
  studio.setAutoMirror(false);
});

test('a bigger recording hand: the stored hand length moves the wrist about the palm for other hands', () => {
  const pose = defaultPose('bottle_beer', 'right', 'body'), big = referenceHand('right', { scale: referenceHand('right').scale * 1.1 });
  const capture = captureFromJoints('right', poseJoints(pose, big, item), item, referenceHand('right'));
  assert.ok(Math.abs(capture.handLength - REFERENCE_HAND.length * 1.1) < 1e-4, `${capture.handLength}`);
  const rec = recordedPose(capture, { kind: 'bottle_beer', grasp: 'body' });
  const onRecorder = placeWrist(rec, big), onReference = placeWrist(rec, referenceHand('right'));
  assert.ok(Math.hypot(...onRecorder.wrist.map((v, i) => v - rec.wrist[i])) < 2e-5, 'the recording hand keeps its wrist');
  const shift = Math.hypot(...onReference.wrist.map((v, i) => v - rec.wrist[i])), want = Math.hypot(...REFERENCE_HAND.palm) * 0.1;
  assert.ok(Math.abs(shift - want) < 2e-4, `reference hand moves ${shift} (want ${want})`);
});

test('serialisation: a recorded pose survives JSON, merges into the library and takes the default', () => {
  const studio = createStudio(); studio.setItem(item.pos, item.quat);
  run(studio, 0, 3, t => syntheticHands(t, studio.item));
  const [pose, mirror] = studio.accept({ markDefault: true });
  const doc = JSON.parse(JSON.stringify({ schema: RECORDED_SCHEMA, poses: [pose, mirror] }));
  assert.ok(doc.poses.every(isPose));
  assert.deepEqual(doc.poses[0], pose);
  const baked = [defaultPose('bottle_beer', 'right', 'body'), defaultPose('bottle_beer', 'left', 'body'), defaultPose('can', 'right')];
  const merged = mergePoses(baked, doc.poses);
  assert.equal(merged.length, 5);
  assert.ok(!merged[0].default && !merged[1].default, 'recorded defaults replace the baked ones');
  assert.equal(merged[2], baked[2], 'other kinds untouched (same object)');
  assert.ok(merged[3].default && merged[4].default);
  assert.equal(mergePoses(baked, []), baked);
  assert.ok(!isPose({ ...pose, quat: [0, 0, 0, 2] }) && !isPose({ ...pose, angles: pose.angles.slice(1) }) && !isPose({ ...pose, side: 'middle' }));
  assert.ok(scoreGrasp(mirrorPose(mirror)).score >= 0, 'mirroring twice gives a valid right pose');
  assert.ok(maxDiff(mirrorPose(mirror).quat, pose.quat) < 1e-12, 'mirroring is an involution'); // (quatAngle is acos-limited on rounded, not quite unit, quaternions)
});
