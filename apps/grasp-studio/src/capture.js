// Grasp Studio capture logic (pure, no three.js, no WebXR): tracking confidence, the stillness detector, frame averaging
// and the auto-capture state machine. main.js feeds it one sample per XR frame; tests feed synthetic joints.
//
// A sample (item space, metres): { t (s), valid, confidence 0..1, onItem, wrist [3], quat [4], tips [5][3], capture }
// where capture is grasp record.js captureFromJoints() of that frame.
//
// Auto-capture: when the hand is on the item, tracked with confidence >= minConfidence and has been still for `settle`
// seconds, a countdown of `hold` seconds starts; every frame of the countdown is collected and, when it completes, the
// frames are averaged into one capture. Any movement, a tracking drop or leaving the item restarts it. After a capture
// the machine waits in 'review' until the app accepts or discards, then in 'rearm' until the hand has moved `rearmMm`
// away from the captured wrist (or left the item), so a hand that keeps holding is not captured twice.

export const STILL = Object.freeze({
  window: 0.3,        // s of history the stillness test looks at
  settle: 0.15,       // s still before the countdown starts
  hold: 1.0,          // s countdown (frames averaged)
  wristMm: 6,         // max wrist travel inside the window
  angleDeg: 4,        // max hand rotation inside the window
  tipMm: 9,           // max fingertip travel inside the window (item space)
  minConfidence: 0.6, // tracking confidence needed to count down
  rearmMm: 40,        // wrist travel that re-arms after a capture
  minFrames: 20,      // fewer frames in the countdown (a stalled browser) -> no capture
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const quatAngleDeg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI;

/**
 * Tracking confidence 0..1 of a hand from its recent joint positions (WebXR gives no confidence): 0 when joints are
 * missing; otherwise the fingertip jitter, the mean second difference of the tip positions over the last frames (mm per
 * frame^2: real motion is smooth, a hand the headset guesses at shakes), mapped 1 (<= 1.5 mm) .. 0 (>= 6 mm), halved when
 * the runtime marks the poses as emulated. history: [{ tips: [5][3] | null, emulated }], newest last.
 */
export function trackingConfidence(history, { goodMm = 1.5, badMm = 6 } = {}) {
  const last = history.at(-1);
  if (!last?.tips) return 0;
  const recent = history.slice(-6);
  if (recent.length < 3 || recent.some(h => !h.tips)) return 0.5 * (last.emulated ? 0.5 : 1);
  let sum = 0, n = 0;
  for (let k = 2; k < recent.length; k++) for (let f = 0; f < 5; f++) {
    const a = recent[k - 2].tips[f], b = recent[k - 1].tips[f], c = recent[k].tips[f];
    sum += Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]); n++;
  }
  const jitterMm = (sum / n) * 1000, c = Math.max(0, Math.min(1, (badMm - jitterMm) / (badMm - goodMm)));
  return c * (last.emulated ? 0.5 : 1);
}

/** Stillness over a sliding window: push(sample) -> { still, wristMm, angleDeg, tipMm, span }. */
export function createStillness(opts = STILL) {
  const o = { ...STILL, ...opts };
  let samples = [];
  return {
    reset() { samples = []; },
    push(s) {
      samples.push(s);
      while (samples.length > 1 && s.t - samples[0].t > o.window) samples.shift();
      let wristMm = 0, angleDeg = 0, tipMm = 0;
      for (const p of samples) {
        wristMm = Math.max(wristMm, len(sub(p.wrist, s.wrist)) * 1000);
        angleDeg = Math.max(angleDeg, quatAngleDeg(p.quat, s.quat));
        for (let f = 0; f < 5; f++) tipMm = Math.max(tipMm, len(sub(p.tips[f], s.tips[f])) * 1000);
      }
      const span = s.t - samples[0].t;
      return { still: span >= o.settle && wristMm <= o.wristMm && angleDeg <= o.angleDeg && tipMm <= o.tipMm, wristMm, angleDeg, tipMm, span };
    },
  };
}

/**
 * Average of captures (record.js captureFromJoints) of one hand: mean wrist, mean rows and hand length, and the quaternion
 * mean (sign-aligned to the first, normalised sum: exact enough for the few degrees a still hand moves). Also the spread
 * the frames had: largest wrist distance from the mean (mm) and largest row deviation (deg).
 */
export function averageCaptures(list) {
  if (!list.length) throw new Error('averageCaptures: no frames');
  const n = list.length, first = list[0];
  const wrist = [0, 1, 2].map(k => list.reduce((s, c) => s + c.wrist[k], 0) / n);
  const q = [0, 0, 0, 0];
  for (const c of list) {
    const sign = c.quat[0] * first.quat[0] + c.quat[1] * first.quat[1] + c.quat[2] * first.quat[2] + c.quat[3] * first.quat[3] < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) q[k] += sign * c.quat[k];
  }
  const ql = Math.hypot(...q), quat = q.map(v => v / ql);
  const angles = first.angles.map((row, f) => row.map((_, j) => list.reduce((s, c) => s + c.angles[f][j], 0) / n));
  const handLength = list.reduce((s, c) => s + c.handLength, 0) / n;
  let wristMm = 0, rowsDeg = 0;
  for (const c of list) {
    wristMm = Math.max(wristMm, len(sub(c.wrist, wrist)) * 1000);
    c.angles.forEach((row, f) => row.forEach((v, j) => { rowsDeg = Math.max(rowsDeg, Math.abs(v - angles[f][j])); }));
  }
  return { side: first.side, wrist, quat, angles, handLength, frames: n, spread: { wristMm, rowsDeg } };
}

/**
 * Auto-capture state machine. update(sample) -> { state, progress (0..1 of the countdown), remaining (s), captured? }
 * states: 'searching' (no usable, still hand on the item), 'holding' (counting down), 'review' (captured; waiting for
 * accept/discard), 'rearm' (waiting for the hand to move away). accept()/discard() leave 'review'; reset() starts over.
 */
export function createAutoCapture(opts = STILL) {
  const o = { ...STILL, ...opts };
  const stillness = createStillness(o);
  let state = 'searching', start = 0, frames = [], capturedWrist = null, last = null;
  const status = (extra = {}) => ({ state, progress: 0, remaining: o.hold, ...extra });
  const restart = () => { state = 'searching'; frames = []; };
  return {
    get state() { return state; },
    reset() { stillness.reset(); restart(); capturedWrist = null; },
    accept() { if (state === 'review') state = 'rearm'; },
    discard() { if (state === 'review') state = 'rearm'; },
    update(s) {
      if (state === 'review') return status({ progress: 1, remaining: 0 });
      const usable = s?.valid && s.capture && s.onItem && s.confidence >= o.minConfidence;
      if (state === 'rearm') {
        if (!s?.valid || !s.onItem || (capturedWrist && len(sub(s.wrist, capturedWrist)) * 1000 > o.rearmMm)) { stillness.reset(); restart(); }
        return status();
      }
      if (!usable) { stillness.reset(); restart(); return status(); }
      last = stillness.push(s);
      if (!last.still) { restart(); return status({ motion: last }); }
      if (state === 'searching') { state = 'holding'; start = s.t; frames = []; }
      frames.push(s.capture);
      const progress = Math.min(1, (s.t - start) / o.hold);
      if (progress < 1) return status({ progress, remaining: o.hold - (s.t - start), motion: last });
      if (frames.length < o.minFrames) { restart(); return status({ motion: last }); }
      const captured = averageCaptures(frames);
      capturedWrist = captured.wrist; state = 'review'; frames = [];
      return status({ progress: 1, remaining: 0, captured, motion: last });
    },
  };
}

// Animation capture (extensions plan step 7, Grasp Studio animation mode): the same stillness mechanism starts and stops a
// recording. Hold still for `hold` s -> recording starts; move (at least `minMotion` s of motion); hold still for `hold`
// s again -> it stops and the still tail (the stop countdown) is trimmed off. A drop in tracking while recording ends it
// as well (frames kept up to the drop); `maxSeconds` caps a recording. 'review' then waits for accept/discard, 'rearm'
// for the hand to move (so the stop pose does not immediately start the next take).
export const ANIM = Object.freeze({ ...STILL, maxSeconds: 15, minMotion: 0.2, minRecordFrames: 8 });

/**
 * update(sample) -> { state, progress (countdown 0..1), remaining, elapsed, frames, recorded? }. A sample is like the
 * auto-capture one plus `frame` (the frame to record, any shape; the caller turns them into a clip). states: 'searching',
 * 'arming' (start countdown), 'recording', 'stopping' (stop countdown, still recording), 'review', 'rearm'.
 * recorded = { frames, duration, reason: 'still' | 'max' | 'lost' }.
 */
export function createAnimationCapture(opts = ANIM) {
  const o = { ...ANIM, ...opts };
  const stillness = createStillness(o);
  let state = 'searching', start = 0, stopAt = 0, frames = [], moved = 0, lastT = null;
  const status = (extra = {}) => ({ state, progress: 0, remaining: o.hold, elapsed: state === 'recording' || state === 'stopping' ? lastT - start : 0, frames: frames.length, ...extra });
  const finish = (reason, keep) => {
    const kept = frames.slice(0, Math.max(0, keep));
    frames = []; stillness.reset();
    if (kept.length < o.minRecordFrames) { state = 'rearm'; return status({ discarded: reason }); }
    state = 'review';
    return status({ recorded: { frames: kept, duration: kept.at(-1).t - kept[0].t, reason } });
  };
  return {
    get state() { return state; },
    reset() { stillness.reset(); state = 'searching'; frames = []; moved = 0; },
    accept() { if (state === 'review') state = 'rearm'; },
    discard() { if (state === 'review') state = 'rearm'; },
    update(s) {
      const dt = lastT == null || !Number.isFinite(s?.t) ? 0 : Math.max(0, s.t - lastT);
      if (Number.isFinite(s?.t)) lastT = s.t;
      if (state === 'review') return status({ progress: 1, remaining: 0 });
      const usable = s?.valid && s.frame && (s.onItem ?? true) && s.confidence >= o.minConfidence;
      if (state === 'recording' || state === 'stopping') {
        if (!usable) return finish('lost', frames.length);
        frames.push({ ...s.frame, t: s.t });
        if (s.t - start >= o.maxSeconds) return finish('max', frames.length);
        const m = stillness.push(s);
        if (!m.still) { moved += dt; state = 'recording'; return status({ motion: m }); }
        if (moved < o.minMotion) return status({ motion: m });          // still at the start pose: not a stop yet
        if (state === 'recording') { state = 'stopping'; stopAt = s.t; }
        const progress = Math.min(1, (s.t - stopAt) / o.hold);
        if (progress < 1) return status({ progress, remaining: o.hold - (s.t - stopAt), motion: m });
        // trim the stop countdown and the stillness window before it (stillness is reported once the whole window is
        // still): the clip ends where the hand came to rest
        const end = stopAt - o.window;
        let keep = frames.length;
        while (keep > 1 && frames[keep - 1].t > end) keep--;
        return finish('still', keep);
      }
      if (state === 'rearm') {
        if (!usable) { stillness.reset(); return status(); }
        const m = stillness.push(s);
        if (!m.still) { state = 'searching'; stillness.reset(); }
        return status();
      }
      if (!usable) { stillness.reset(); state = 'searching'; return status(); }
      const m = stillness.push(s);
      if (!m.still) { state = 'searching'; return status({ motion: m }); }
      if (state === 'searching') { state = 'arming'; start = s.t; }
      const progress = Math.min(1, (s.t - start) / o.hold);
      if (progress < 1) return status({ progress, remaining: o.hold - (s.t - start), motion: m });
      state = 'recording'; start = s.t; frames = [{ ...s.frame, t: s.t }]; moved = 0;
      return status({ started: true });
    },
  };
}
