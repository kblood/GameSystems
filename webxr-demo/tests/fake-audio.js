// Minimal fake Web Audio context for node tests of extensions/audio: records node creation, routes onended when the
// test advances time, and keeps AudioParam values readable (.value is the last scheduled value).
export function createFakeAudioContext({ state = 'running', bufferDuration = 0.3 } = {}) {
  const param = (value = 0) => ({ value, calls: [],
    setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]); },
    setTargetAtTime(v, t, k) { this.value = v; this.calls.push(['target', v, t, k]); },
    cancelScheduledValues() {} });
  const ctx = { currentTime: 0, state, closed: false, created: { gain: 0, source: 0, panner: 0, stereo: 0, filter: 0, compressor: 0 }, sources: [], decoded: 0 };
  const node = kind => ({ kind, outputs: [], connect(n) { this.outputs.push(n); return n; }, disconnect() { this.outputs.length = 0; } });
  ctx.destination = node('destination');
  ctx.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(-1), upX: param(), upY: param(1), upZ: param() };
  ctx.createGain = () => { ctx.created.gain++; return Object.assign(node('gain'), { gain: param(1) }); };
  ctx.createDynamicsCompressor = () => { ctx.created.compressor++; return node('compressor'); };
  ctx.createBiquadFilter = () => { ctx.created.filter++; return Object.assign(node('filter'), { type: 'lowpass', frequency: param(350), Q: param(1) }); };
  ctx.createStereoPanner = () => { ctx.created.stereo++; return Object.assign(node('stereo'), { pan: param() }); };
  ctx.createPanner = () => { ctx.created.panner++; return Object.assign(node('panner'), { positionX: param(), positionY: param(), positionZ: param(), panningModel: 'equalpower', distanceModel: 'linear', refDistance: 1, rolloffFactor: 1, maxDistance: 10000 }); };
  ctx.createBufferSource = () => {
    ctx.created.source++;
    const s = Object.assign(node('source'), { buffer: null, loop: false, playbackRate: param(1), onended: null, started: null, stopped: null, ended: false,
      start(t = ctx.currentTime) { this.started = t; }, stop(t = ctx.currentTime) { this.stopped = t; } });
    ctx.sources.push(s); return s;
  };
  ctx.decodeAudioData = async () => { ctx.decoded++; return { duration: bufferDuration, length: Math.round(bufferDuration * 44100) }; };
  ctx.resume = async () => { ctx.state = 'running'; };
  ctx.close = async () => { ctx.closed = true; ctx.state = 'closed'; };
  /** Move time on; sources whose end has passed fire onended like the browser does. */
  ctx.advance = seconds => {
    ctx.currentTime += seconds;
    for (const s of ctx.sources) {
      if (s.ended || s.started === null) continue;
      const natural = !s.loop && s.started + s.buffer.duration / s.playbackRate.value <= ctx.currentTime;
      if (natural || (s.stopped !== null && s.stopped <= ctx.currentTime)) { s.ended = true; s.onended?.call(s); }
    }
  };
  /** Sources that have started and not ended. */
  ctx.live = () => ctx.sources.filter(s => s.started !== null && !s.ended);
  return ctx;
}
export const fakeFetch = async () => new ArrayBuffer(8);
