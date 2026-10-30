// Audio engine: Web Audio voice pool with spatial sound, contact sounds by material pair and impact strength, loops and
// acoustics-based muffling. No three.js, no DOM: the AudioContext is injected (or created lazily from globalThis), so the
// whole thing runs against a fake context in node tests. Data (materials, thresholds, names) lives in sound_materials.json.
//
// Tiers (AUDIO_QUALITY): off = silent, low = 16 voices / no panning (distance gain only), mid = 32 voices / stereo pan,
// high = 48 voices / HRTF PannerNode + per-voice lowpass for muffling + layered second material.
// Hot path (play/contact): scalar math on preallocated voice objects; the only allocations are the AudioBufferSourceNode a
// one-shot needs (Web Audio has no reusable sources) and the options object the caller passes.
import { clamp } from '../host/system.js';
import DEFAULT_DATA from './sound_materials.json' with { type: 'json' };

export const AUDIO_TIERS = Object.freeze(['off', 'low', 'mid', 'high']);
export const AUDIO_QUALITY = Object.freeze({
  off: Object.freeze({ voices: 0, spatial: 'none', filter: false, layers: false, limiter: false }),
  low: Object.freeze({ voices: 16, spatial: 'none', filter: false, layers: false, limiter: false }),
  mid: Object.freeze({ voices: 32, spatial: 'stereo', filter: false, layers: false, limiter: true }),
  high: Object.freeze({ voices: 48, spatial: 'hrtf', filter: true, layers: true, limiter: true }),
});
const EMPTY = Object.freeze({});
const STEAL_FADE = 0.012; // s: a stolen voice fades out this long before the new sound starts

const px = p => (p ? (p.x ?? p[0]) : NaN), py = p => (p ? (p.y ?? p[1]) : NaN), pz = p => (p ? (p.z ?? p[2]) : NaN);

/**
 * Options: context | createContext (ours, closed on dispose) | sharedContext (() => AudioContext|null: the game's own context,
 * borrowed and never closed or created here), delayBySpeed (default false: sounds arrive after distance / speedOfSound,
 * at most maxDelay s; only sounds with a position), speedOfSound (343 m/s), maxDelay (0.25 s).
 */
export function createAudioSystem({ context = null, createContext = null, sharedContext = null, emit = () => {}, quality = 'high', data = DEFAULT_DATA,
  assetURL = path => path, fetchBuffer = null, acoustics = null, seed = 1, masterGain = 1,
  delayBySpeed = false, speedOfSound = 343, maxDelay = 0.25 } = {}) {
  if (!AUDIO_TIERS.includes(quality)) throw new RangeError(`Unknown quality: ${quality}`);
  let tier = quality, cfg = AUDIO_QUALITY[tier], disposed = false, ctx = context, ownsContext = false, master = null, limiter = null;
  let rngState = (seed >>> 0) || 1, stolen = false, listenerRoom = null, volume = masterGain, delayOn = !!delayBySpeed, loopCheckAt = 0;
  let retryPromise = null;
  const loops = new Set(); // live loop handles (their room muffling follows the listener's room)
  const stats = { played: 0, delayed: 0, loopRefreshes: 0, contacts: 0, stolen: 0, rateLimited: 0, culled: 0, suspended: 0, silent: 0, unknown: 0, below: 0, unloaded: 0, loadErrors: 0, decoded: 0 };
  const voices = [], lastKey = new Map(), lastSource = new Map(), roomCache = new Map(), buffers = new Map(), pending = new Map(), failed = new Set();
  const L = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0, set: false };
  const D = data, S = D.strength, SP = D.spatial, AC = D.acoustics, dflt = D.defaults;

  // ---- sound table: name -> { name, files[], buf[], priority, gap, gain }, resolved once from the data
  const sounds = new Map();
  for (const [name, s] of Object.entries(D.sounds)) {
    const files = Array.from({ length: s.variants }, (_, i) => `${name}_${String(i + 1).padStart(2, '0')}`);
    sounds.set(name, { name, files, buf: new Array(s.variants).fill(null), last: -1, priority: s.priority ?? dflt.priority, gap: s.gap ?? dflt.gap, gain: s.gain ?? dflt.gain });
  }
  for (const [alias, name] of Object.entries(D.aliases)) if (sounds.has(name) && !sounds.has(alias)) sounds.set(alias, sounds.get(name));
  // material -> [light, medium, hard] sound records (no string work when a contact plays)
  const mats = new Map();
  for (const [name, m] of Object.entries(D.materials)) {
    const names = ['light', 'medium', 'hard'].map(l => (typeof m.contact === 'string' ? `${m.contact}_${l}` : m.contact[l]));
    const rec = names.map(n => sounds.get(n));
    if (rec.some(r => !r)) throw new Error(`Material ${name} refers to a sound that is not in the data: ${names}`);
    mats.set(name, { name, rank: m.rank, damp: m.damp ?? 0, sounds: rec });
  }
  const defaultMat = mats.get(D.defaultMaterial);

  const rand = () => { rngState ^= rngState << 13; rngState >>>= 0; rngState ^= rngState >>> 17; rngState ^= rngState << 5; rngState >>>= 0; return rngState / 4294967296; };
  const clock = () => ctx.currentTime;

  function ensureContext() {
    if (ctx || disposed || !cfg.voices) return !!ctx;
    if (sharedContext) { try { ctx = sharedContext() ?? null; } catch { ctx = null; } return !!ctx; } // borrowed: not ours to create or close
    try {
      if (createContext) ctx = createContext();
      else { const AC_ = globalThis.AudioContext || globalThis.webkitAudioContext; ctx = AC_ ? new AC_() : null; }
    } catch (error) { ctx = null; emit('audio:error', { error, phase: 'context' }); }
    if (ctx) ownsContext = true;
    return !!ctx;
  }
  function ensureMaster() {
    if (master || !ctx) return;
    master = ctx.createGain(); master.gain.value = volume;
    let tail = master;
    if (cfg.limiter && ctx.createDynamicsCompressor) { limiter = ctx.createDynamicsCompressor(); master.connect(limiter); tail = limiter; }
    tail.connect(ctx.destination);
  }

  // ---- listener
  function applyListener() {
    const l = ctx?.listener; if (!l || cfg.spatial !== 'hrtf') return;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = L.fx; l.forwardY.value = L.fy; l.forwardZ.value = L.fz;
      l.upX.value = L.ux; l.upY.value = L.uy; l.upZ.value = L.uz;
    } else { l.setPosition?.(L.x, L.y, L.z); l.setOrientation?.(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz); }
  }
  function setListener(x, y, z, fx, fy, fz, ux = 0, uy = 1, uz = 0) {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)
      && Number.isFinite(ux) && Number.isFinite(uy) && Number.isFinite(uz))) return; // an invalid pose is ignored (the last one stays)
    const same = L.set && L.x === x && L.y === y && L.z === z && L.fx === fx && L.fy === fy && L.fz === fz;
    L.x = x; L.y = y; L.z = z; L.fx = fx; L.fy = fy; L.fz = fz; L.ux = ux; L.uy = uy; L.uz = uz; L.set = true;
    if (same) return;
    // right = forward x up (for the stereo pan)
    let rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux; const n = Math.hypot(rx, ry, rz) || 1;
    L.rx = rx / n; L.ry = ry / n; L.rz = rz / n;
    applyListener();
  }

  // ---- voices
  function endVoice(v) {
    if (!v.active) return;
    v.active = false; v.loop = false; v.gen++;
    const s = v.src; v.src = null;
    if (s) { s.onended = null; try { s.disconnect(); } catch { /* already gone */ } }
  }
  function makeVoice() {
    const v = { gain: ctx.createGain(), panner: null, filter: null, input: null, src: null, active: false, loop: false, gen: 0, dist: 1, priority: 0, start: 0, endsAt: 0, end: null };
    v.input = v.gain;
    if (cfg.filter) { v.filter = ctx.createBiquadFilter(); v.filter.type = 'lowpass'; v.filter.frequency.value = AC.maxHz; v.filter.connect(v.gain); v.input = v.filter; }
    if (cfg.spatial === 'hrtf') {
      const p = v.panner = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = SP.refDistance; p.rolloffFactor = SP.rolloff; p.maxDistance = SP.maxDistance;
      v.gain.connect(p); p.connect(master);
    } else if (cfg.spatial === 'stereo' && ctx.createStereoPanner) { v.panner = ctx.createStereoPanner(); v.gain.connect(v.panner); v.panner.connect(master); }
    else v.gain.connect(master);
    v.end = function onended() { if (this === v.src) endVoice(v); };
    voices.push(v);
    return v;
  }
  function acquire(priority, now, protectedVoice = null) {
    stolen = false;
    let worst = null;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.active && !v.loop && v.endsAt <= now) endVoice(v); // onended may lag or never come
      if (!v.active) return v;
      // A contact's optional layer must not steal its own just-started primary.
      if (v === protectedVoice) continue;
      if (!worst || v.priority < worst.priority || (v.priority === worst.priority && v.start < worst.start)) worst = v;
    }
    if (voices.length < cfg.voices) return makeVoice();
    if (worst && worst.priority <= priority) { stolen = true; stats.stolen++; return worst; }
    return null;
  }
  const distanceGain = d => (d <= SP.refDistance ? 1 : SP.refDistance / (SP.refDistance + SP.rolloff * (d - SP.refDistance)));
  /** Place a voice; returns the extra gain the panner does not apply itself. Without a position the sound sits on the listener. */
  function place(v, x, y, z) {
    const has = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z); // NaN / invalid: the sound sits on the listener
    if (!has) { x = L.x; y = L.y; z = L.z; }
    if (v.panner && cfg.spatial === 'hrtf') {
      const p = v.panner;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition?.(x, y, z);
      return (v.dist = 1);
    }
    if (!has) return (v.dist = 1);
    const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz);
    if (v.panner) v.panner.pan.value = d < 1e-4 ? 0 : clamp((dx * L.rx + dy * L.ry + dz * L.rz) / d, -1, 1);
    return (v.dist = distanceGain(d));
  }

  // ---- acoustics: loss in dB from a room to the listener's room (null = no path), cached for ac.ttl seconds
  function roomLoss(room, now) {
    const ac = typeof acoustics === 'function' ? acoustics() : acoustics;
    if (!ac || room == null || listenerRoom == null || room === listenerRoom) return 0;
    let e = roomCache.get(room);
    if (!e) roomCache.set(room, e = { loss: 0, at: -Infinity, listener: null });
    if (now - e.at > AC.ttl || e.listener !== listenerRoom) {
      let path = null;
      try { path = ac.path(room, listenerRoom); } catch { path = { lossDb: 0 }; } // unknown room: treat as no information
      e.loss = path ? path.lossDb : null; e.at = now; e.listener = listenerRoom;
    }
    return e.loss;
  }

  const lossGain = loss => (loss > 0 ? 10 ** (-loss / 20) : 1);
  const lossHz = loss => (loss > 0 ? clamp(AC.maxHz * 10 ** (-loss / AC.dbPerDecade), AC.minHz, AC.maxHz) : AC.maxHz);
  /** Re-apply the room muffling of every running loop (listener changed room, or the acoustics path changed: a door opened). */
  function refreshLoops(now) {
    loopCheckAt = now;
    for (const h of loops) {
      const v = h.voice;
      if (v.gen !== h.gen || !v.active) { loops.delete(h); continue; }
      applyLoopLevel(h, now);
    }
    stats.loopRefreshes++;
  }
  function applyLoopLevel(h, now) {
    const v = h.voice;
    let loss = 0;
    if (h.room != null) loss = roomLoss(h.room, now);
    const silent = loss === null || loss > AC.maxLossDb; // no path: the loop keeps running but is inaudible
    h.loss = silent ? AC.maxLossDb : loss;
    v.gain.gain.setTargetAtTime(silent ? 0 : h.gain * h.snd.gain * v.dist * lossGain(loss), now, 0.05);
    if (v.filter) v.filter.frequency.setTargetAtTime(silent ? AC.minHz : lossHz(loss), now, 0.05);
  }

  // ---- loading
  function loadFile(snd, i, retry = false) {
    if (disposed) return Promise.resolve(null);
    const file = snd.files[i];
    if (buffers.has(file) || (failed.has(file) && !retry)) return pending.get(file) || Promise.resolve(buffers.get(file) ?? null);
    if (pending.has(file) || !ensureContext()) return pending.get(file) ?? Promise.resolve(null);
    const decodeContext = ctx;
    const live = () => !disposed && ctx === decodeContext;
    const url = String(assetURL(`audio/ogg/${file}.ogg`));
    if (!live()) return Promise.resolve(null);
    const get = Promise.resolve().then(() => {
      if (!live()) return null;
      return fetchBuffer ? fetchBuffer(url) : fetch(url).then(r => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return live() ? r.arrayBuffer() : null;
      });
    });
    const p = get.then(bytes => live() ? decodeContext.decodeAudioData(bytes) : null).then(buf => {
      if (!live()) return null;
      buffers.set(file, buf); snd.buf[i] = buf; failed.delete(file); stats.decoded++; return buf;
    }).catch(error => {
      if (!live()) return null;
      failed.add(file); stats.loadErrors++; emit('audio:error', { error, phase: 'load', file }); return null;
    }).finally(() => { if (pending.get(file) === p) pending.delete(file); });
    pending.set(file, p);
    return p;
  }
  /** Decode sounds ahead of use. names: sound names, group names from the data ('contacts', 'hand', ...) or 'all'. */
  function preload(names = ['contacts', 'hand']) {
    if (disposed || !cfg.voices || !ensureContext()) return Promise.resolve(0);
    const list = new Set();
    for (const n of [].concat(names)) {
      if (n === 'all') for (const k of Object.keys(D.sounds)) list.add(k);
      else if (D.groups[n]) for (const k of D.groups[n]) list.add(k);
      else list.add(D.aliases[n] ?? n);
    }
    const jobs = [];
    for (const n of list) { const s = sounds.get(n); if (s) for (let i = 0; i < s.files.length; i++) jobs.push(loadFile(s, i)); }
    return Promise.all(jobs).then(r => disposed ? 0 : r.filter(Boolean).length);
  }

  /** Retry only failures observed at invocation; never replace live buffers/voices. */
  function retryFailedSamples() {
    if (retryPromise) return retryPromise;
    const selected = new Set(failed);
    const result = recovered => ({ attempted: selected.size, recovered, remaining: failed.size, disposed });
    if (disposed || !selected.size || !cfg.voices || !ensureContext()) return Promise.resolve(result(0));
    const jobs = [];
    for (const snd of new Set(sounds.values())) for (let i = 0; i < snd.files.length; i++) {
      const file = snd.files[i];
      if (!selected.has(file)) continue;
      jobs.push(Promise.resolve().then(async () => {
        // A retry requested by a load-error observer must wait for that load's cleanup.
        await pending.get(file);
        return disposed ? null : loadFile(snd, i, true);
      }));
    }
    const run = Promise.allSettled(jobs).then(values => result(disposed ? 0 : values.filter(v => v.status === 'fulfilled' && v.value).length))
      .finally(() => { if (retryPromise === run) retryPromise = null; });
    retryPromise = run;
    return run;
  }

  // ---- playing
  function pickBuffer(snd, seedValue) {
    const n = snd.files.length;
    let i;
    if (seedValue != null) i = Math.abs(Math.floor(seedValue)) % n;
    else { i = Math.floor(rand() * n); if (n > 1 && i === snd.last) i = (i + 1) % n; }
    snd.last = i;
    let b = snd.buf[i];
    if (!b) { loadFile(snd, i); for (let k = 0; k < n && !b; k++) b = snd.buf[k]; } // fall back to any decoded variant
    return b;
  }
  /** Core: one sound record on one voice. Returns the voice or null. */
  function start(snd, gain, rate, seedValue, o, loop, ownSource = true, protectedVoice = null) {
    if (disposed || !cfg.voices) { stats.silent++; return null; }
    if (!ensureContext()) { stats.silent++; return null; }
    ensureMaster();
    if (ctx.state !== 'running') { stats.suspended++; return null; } // a suspended context would replay everything on resume
    const now = clock();
    if (!loop) {
      const gap = o.minGap ?? snd.gap;
      if (now - (lastKey.get(snd.name) ?? -Infinity) < gap) { stats.rateLimited++; return null; }
      if (ownSource && o.sourceId != null && now - (lastSource.get(o.sourceId) ?? -Infinity) < (o.sourceGap ?? 0.03)) { stats.rateLimited++; return null; }
    }
    const x = px(o.position), y = py(o.position), z = pz(o.position);
    if (x === x && L.set && Math.hypot(x - L.x, y - L.y, z - L.z) > SP.maxDistance) { stats.culled++; return null; }
    let loss = 0;
    if (o.room != null) { loss = roomLoss(o.room, now); if (loss === null || loss > AC.maxLossDb) { stats.culled++; return null; } }
    const buf = pickBuffer(snd, seedValue);
    if (!buf) { stats.unloaded++; return null; }
    const priority = o.priority ?? snd.priority;
    const v = acquire(priority, now, protectedVoice);
    if (!v) { stats.culled++; return null; }
    const wasActive = v.active, old = v.src;
    if (wasActive && old) { old.onended = null; try { old.stop(now + STEAL_FADE); } catch { /* ended */ } }
    const vol = gain * snd.gain * lossGain(loss) * place(v, x, y, z);
    let delay = 0;
    if (delayOn && !loop && x === x && L.set) { delay = Math.min(Math.hypot(x - L.x, y - L.y, z - L.z) / speedOfSound, maxDelay); if (delay > 0.001) stats.delayed++; }
    const g = v.gain.gain, when = (stolen && wasActive ? now + STEAL_FADE : now) + delay;
    g.cancelScheduledValues(now);
    if (stolen && wasActive) g.setTargetAtTime(0, now, 0.002);
    g.setValueAtTime(vol, when);
    if (v.filter) v.filter.frequency.value = lossHz(loss);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = loop; src.playbackRate.value = rate; src.onended = v.end; src.connect(v.input);
    src.start(when);
    v.src = src; v.scheduledAt = when; v.active = true; v.loop = loop; v.priority = priority; v.start = now; v.gen++;
    v.endsAt = loop ? Infinity : when + buf.duration / rate;
    if (!loop) { lastKey.set(snd.name, now); if (ownSource && o.sourceId != null) lastSource.set(o.sourceId, now); }
    stats.played++;
    return v;
  }
  const lookup = key => sounds.get(key) ?? sounds.get(D.aliases[key]);

  // ---- materials and contacts
  const materialOf = name => (name == null ? defaultMat : mats.get(name) ?? mats.get(D.things[name]) ?? mats.get(D.things[String(name).toLowerCase()]) ?? defaultMat);
  const last = { primary: null, secondary: null, level: 0, gain: 0, rate: 1, material1: null, material2: null };
  /** Decide sound, strength level, gain and pitch for a contact (fills and returns `out`; no allocation when it is passed). */
  function chooseContact(material1, material2, speed, out = {}) {
    const a = materialOf(material1), b = materialOf(material2);
    // a damping material (cloth, cardboard) swallows the ring of the other; otherwise the more resonant one speaks
    let first = a, second = b;
    if (a.damp !== b.damp) { if (b.damp > a.damp) { first = b; second = a; } }
    else if (b.rank > a.rank) { first = b; second = a; }
    const level = speed < S.lightMax ? 0 : speed < S.mediumMax ? 1 : 2;
    const lo = level === 0 ? S.minSpeed : level === 1 ? S.lightMax : S.mediumMax, hi = level === 0 ? S.lightMax : level === 1 ? S.mediumMax : S.hardRef;
    const frac = clamp((speed - lo) / (hi - lo), 0, 1);
    out.level = level; out.frac = frac;
    out.gain = S.gainRange[0] + (S.gainRange[1] - S.gainRange[0]) * frac;
    out.rate = S.pitchRange[0] + (S.pitchRange[1] - S.pitchRange[0]) * frac; // light = a bit higher, hard = a bit lower
    out.primary = first.sounds[level];
    out.secondary = first === second ? null : second.sounds[Math.max(0, level - 1)];
    out.material1 = first.name; out.material2 = second.name;
    return out;
  }

  const api = {
    get quality() { return tier; },
    get available() { return !!ctx; },
    get context() { return ctx; },
    get activeVoices() { let n = 0; for (let i = 0; i < voices.length; i++) if (voices[i].active) n++; return n; },
    get voiceCap() { return cfg.voices; },
    get lastContact() { return last; },
    get listenerRoom() { return listenerRoom; },
    get delayBySpeed() { return delayOn; },
    set delayBySpeed(on) { delayOn = !!on; },
    get loopCount() { let n = 0; for (const h of loops) if (h.voice.gen === h.gen && h.voice.active) n++; return n; },
    stats() { return { ...stats, tier, voiceCap: cfg.voices, voicesCreated: voices.length, active: api.activeVoices, cached: buffers.size }; },
    setQuality(next) {
      if (!AUDIO_TIERS.includes(next)) throw new RangeError(`Unknown quality: ${next}`);
      if (next === tier) return;
      api.stopAll(); teardownPool(); tier = next; cfg = AUDIO_QUALITY[next];
      if (ctx && master) {
        master.disconnect(); limiter?.disconnect(); limiter = null;
        if (cfg.limiter && ctx.createDynamicsCompressor) { limiter = ctx.createDynamicsCompressor(); master.connect(limiter); limiter.connect(ctx.destination); } else master.connect(ctx.destination);
      }
      applyListener();
    },
    /** Resume the AudioContext (browsers/Quest: call from a user gesture or the XR session start). */
    resume() {
      if (disposed || !ensureContext()) return Promise.resolve(false);
      ensureMaster();
      const resumeContext = ctx;
      return Promise.resolve(resumeContext.state === 'running' ? true : resumeContext.resume?.())
        .then(() => !disposed && ctx === resumeContext && resumeContext.state === 'running', () => false);
    },
    setMasterGain(v) { volume = clamp(v, 0, 2); if (master) master.gain.value = volume; },
    preload,
    retryFailedSamples,
    get failedSampleCount() { return failed.size; },
    setListener,
    /** Listener from a column-major 4x4 matrix (three.js Matrix4.elements): position, -Z forward, +Y up. */
    listenerFromMatrix(e) { setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]); },
    /** Set the listener's room; running loops are re-muffled at once when it changes. */
    setListenerRoom(room) { const changed = room !== listenerRoom; listenerRoom = room; if (changed) roomCache.clear(); if (changed && ctx && loops.size) refreshLoops(clock()); },
    materialOf: name => materialOf(name).name,
    chooseContact,
    /** play(key, { position, gain, rate, variantSeed, priority, minGap (s), sourceId, room }) -> true when a voice started. */
    play(key, o = EMPTY) {
      const snd = lookup(key); if (!snd) { stats.unknown++; return false; }
      return !!start(snd, o.gain ?? 1, o.rate ?? 1, o.variantSeed, o, false);
    },
    /** contact({ material1, material2, speed (m/s), normal, position, sourceId, room, variantSeed }) -> true when a sound started. */
    contact(c) {
      if (!(c.speed >= S.minSpeed)) { stats.below++; return false; }
      stats.contacts++;
      const r = chooseContact(c.material1, c.material2, c.speed, last);
      const jitter = 1 + (rand() * 2 - 1) * S.pitchJitter, gain = r.gain * (c.gain ?? 1), rate = r.rate * jitter * (c.rate ?? 1);
      const ok = start(r.primary, gain, rate, c.variantSeed, c, false);
      if (cfg.layers && r.secondary && ok) start(r.secondary, gain * S.layerGain, rate, c.variantSeed == null ? null : c.variantSeed + 1, c, false, false, ok);
      return !!ok;
    },
    grab(o = EMPTY) { return api.play(D.events.grab, o); },
    release(o = EMPTY) { return api.play(D.events.release, o); },
    /** footstep({ surface|material, position, speed (m/s), sourceId }) */
    footstep(o = EMPTY) {
      const m = o.surface ?? o.material, name = D.footsteps[m] ?? D.footsteps[materialOf(m).name] ?? D.footsteps.concrete;
      const snd = sounds.get(name); if (!snd) return false;
      return !!start(snd, clamp(0.35 + 0.65 * ((o.speed ?? 1.4) / 4), 0.2, 1) * (o.gain ?? 1), 1 + (rand() * 2 - 1) * 0.05, o.variantSeed, o, false);
    },
    /** Looping sound; returns a handle for updateLoop/stopLoop, or null when no voice/buffer was available. */
    startLoop(key, o = EMPTY) {
      const snd = lookup(key); if (!snd) { stats.unknown++; return null; }
      const v = start(snd, o.gain ?? 1, o.rate ?? 1, o.variantSeed, o, true);
      if (!v) return null;
      const h = { voice: v, gen: v.gen, gain: o.gain ?? 1, snd, room: o.room ?? null, loss: 0 };
      loops.add(h);
      return h;
    },
    updateLoop(h, o = EMPTY) {
      const v = h?.voice; if (!v || v.gen !== h.gen || !v.active || !ctx) return false;
      if (o.gain !== undefined) h.gain = o.gain;
      if (o.room !== undefined) h.room = o.room;
      if (o.gain !== undefined || o.position || o.room !== undefined) {
        if (o.position) place(v, px(o.position), py(o.position), pz(o.position));
        applyLoopLevel(h, clock());
      }
      if (o.rate !== undefined && v.src) v.src.playbackRate.setTargetAtTime(o.rate, clock(), 0.03);
      return true;
    },
    stopLoop(h, fade = 0.06) {
      const v = h?.voice; if (!v || v.gen !== h.gen || !v.active) return false;
      const now = clock(), s = v.src;
      v.gain.gain.cancelScheduledValues(now); v.gain.gain.setTargetAtTime(0, now, fade / 4);
      if (s) { try { s.stop(now + fade); } catch { /* ended */ } } // onended frees the voice
      v.endsAt = now + fade; v.loop = false; v.priority = -1; // also reclaimable by acquire() after the fade
      v.gen++; loops.delete(h);
      return true;
    },
    /** Cancel only not-yet-started sources; leave active tails and the shared graph intact. */
    cancelPendingStarts() {
      if (!ctx || disposed) return;
      const now = clock();
      for (const v of voices) if (v.active && v.scheduledAt > now) {
        try { v.src?.stop(now); } catch { /* ended */ }
        endVoice(v);
      }
    },
    stopAll() { for (let i = 0; i < voices.length; i++) { const v = voices[i]; if (v.active) { try { v.src?.stop(); } catch { /* ended */ } endVoice(v); } } },
    /** Housekeeping: reclaim finished voices (normally onended does it). */
    step() { if (!ctx) return; const now = clock(); if (loops.size && now - loopCheckAt > AC.ttl) refreshLoops(now); for (let i = 0; i < voices.length; i++) { const v = voices[i]; if (v.active && !v.loop && v.endsAt <= now) endVoice(v); } },
    dispose() {
      if (disposed) return;
      disposed = true; api.stopAll(); teardownPool();
      try { limiter?.disconnect(); master?.disconnect(); } catch { /* ignore */ }
      if (ownsContext) { try { ctx?.close?.(); } catch { /* ignore */ } }
      buffers.clear(); pending.clear(); failed.clear(); lastKey.clear(); lastSource.clear(); roomCache.clear(); loops.clear();
      for (const s of sounds.values()) s.buf.fill(null);
      master = limiter = null; ctx = null;
    },
  };
  function teardownPool() {
    for (const v of voices) { try { v.gain.disconnect(); v.filter?.disconnect(); v.panner?.disconnect(); } catch { /* ignore */ } }
    voices.length = 0;
  }
  return api;
}
