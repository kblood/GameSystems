// Grasp Studio v1 (extensions plan step 4): record grasps on a virtual bottle with Quest 3 hand tracking.
// The scene: the item in front of you, your tracked hands (fingertips green on contact, red inside), a ghost copy of
// the item beside it with the avatar's hand closed to contact (bone model; the CharacterCreator twin at quality
// mellem/høj when the Contracts plugin is synced), a countdown badge and a poke panel. Model and capture logic:
// studio.js + capture.js (pure, tested in node); grasp maths: the synced GameSystems grasp extension; saving: the
// dev-server endpoint (server/grasp_store.mjs) writes GameSystems/extensions/grasp/recorded_grasps.json.
// Modes (panel row 3, extensions plan step 7): Greb (grasps, above), Animation (hold still to start, move, hold still to
// stop; saved as a hand clip) and Gestus (hold a hand pose still anywhere); both hand modes save through /api/hand
// (server/hand_store.mjs) into GameSystems/extensions/avatar/recorded_hand.json under the chosen name.
// URL options: ?quality=0..3 (default 2), ?avatar=off, ?side=left, ?synthetic (desktop: a synthetic hand grips the item).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHost } from './vendor/extensions/host/index.js';
import { XR_JOINTS, XR_CHAINS, RECORDED_SCHEMA, CATALOG, poseJoints } from './vendor/extensions/grasp/index.js';
import { createStudio, syntheticHands, KIND, MODES, GESTURE_NAMES } from './studio.js';
import { HAND_RECORDINGS_SCHEMA } from './vendor/extensions/avatar/handposes.js';
import { HandView, itemMesh, Badge, Panel } from './views.js';
import * as api from './api.js';

const params = new URLSearchParams(location.search);
const LEVELS = ['minimal', 'lav', 'mellem', 'høj'];
const MODE_LABEL = { grasp: 'Greb', animation: 'Animation', gesture: 'Gestus' };
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const GHOST_OFFSET = 0.5; // m beside the item (away from the recording hand): the ghost item, the avatar hand and the twin
const $ = id => document.getElementById(id);
let level = Math.max(0, Math.min(3, Number(params.get('quality') ?? 2) || 0));
let message = 'Klar. Gå i VR og grib flasken med hånden.';

// ---- scene --------------------------------------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2428);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0.05, 1.6, 0.35);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x40362e, 2.2));
const sun = new THREE.DirectionalLight(0xffefd8, 1.4); sun.position.set(1, 3, 2); scene.add(sun);
const floor = new THREE.GridHelper(6, 24, 0x52666b, 0x2f3c40); scene.add(floor);

const studio = createStudio({ kind: KIND, side: params.get('side') === 'left' ? 'left' : 'right', tier: level >= 2 ? 'high' : 'low' });
const shape = CATALOG[KIND].shape;
const bottle = itemMesh(shape, { color: CATALOG[KIND].glass, opacity: 0.6 });
const ghost = itemMesh(shape, { color: 0x86a7ad, opacity: 0.22 });
scene.add(bottle, ghost);
const userHands = { left: new HandView(scene), right: new HandView(scene) };
const avatarHand = new HandView(scene, { color: 0xf7c880, radius: 0.005 });
const badge = new Badge(scene);
const panel = new Panel(scene);
const controls = new OrbitControls(camera, renderer.domElement);

const v3 = (q, v) => new THREE.Vector3(...v).applyQuaternion(new THREE.Quaternion(...q)).toArray();
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const qmul = (a, b) => new THREE.Quaternion(...a).multiply(new THREE.Quaternion(...b)).toArray();
/** Ghost item pose: beside the item, on the side away from the recording hand. */
function ghostItem() {
  const it = studio.item, sign = studio.settings.side === 'right' ? -1 : 1;
  return { pos: add(it.pos, v3(it.quat, [sign * GHOST_OFFSET, 0, 0])), quat: it.quat };
}
function placeItem(head) {
  // In front of the head at chest height, facing the user (+Z toward them, so item +X is the user's right).
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...head.quat)); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  studio.setItem([head.pos[0] + fwd.x * 0.38, Math.max(0.5, head.pos[1] - 0.5), head.pos[2] + fwd.z * 0.38], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
}
studio.setItem([0, 1.0, -0.35]);
controls.target.set(0, 1.12, -0.35); controls.update();

// ---- extensions: the avatar twin ----------------------------------------------------------------------------------
const game = {};
const host = createHost({ THREE, scene, renderer, camera, game, quality: level, assetURL: path => new URL(path, document.baseURI),
  // The twin is optional: a failed load (no Contracts sync) is a warning, a failure while running an error.
  onError: (error, id, phase) => (phase === 'load' || phase === 'init' ? console.warn : console.error)(`Extension '${id}' ${phase}: ${error.message}`) });
let twin = null, head = { pos: [0, 1.6, 0], quat: [0, 0, 0, 1] }, time = 0;
game.twin = () => {
  const c = studio.live?.closed, g = ghostItem(), sign = studio.settings.side === 'right' ? -1 : 1;
  return { t: time, kind: KIND, side: studio.settings.side, head: { pos: add(head.pos, v3(studio.item.quat, [sign * GHOST_OFFSET, 0, 0])), quat: head.quat },
    hand: c ? { pos: add(g.pos, v3(g.quat, c.wrist)), quat: qmul(g.quat, c.quat) } : null, angles: c?.angles ?? null };
};

// ---- actions (panel, DOM, tests) ----------------------------------------------------------------------------------
const say = text => { message = text; };
function setQuality(value) {
  level = Math.max(0, Math.min(3, Number(value) || 0));
  renderer.setPixelRatio(Math.min(devicePixelRatio, [0.75, 1, 1.25, 1.5][level]));
  if (!renderer.xr.isPresenting) renderer.xr.setFramebufferScaleFactor([0.7, 0.85, 1, 1][level]);
  studio.setTier(level >= 2 ? 'high' : 'low');
  host.setQuality(level); // twin: minimal = off, lav = plugin low preset, mellem/høj = full
  $('quality').value = String(level);
}
async function saveClips() {
  const clips = studio.accept();
  if (!clips.length) return say('Intet at gemme.');
  say('Gemmer…');
  const res = await api.saveHand(clips);
  if (res.ok) say(`Gemt ${clips[0].id} (${clips.map(c => c.side).join(' + ')}, ${clips[0].frames.length} keyframes; ${res.library.clips.length} klip i alt). Kør sync i spillene.`);
  else if (res.offline && !renderer.xr.isPresenting) { api.download(clips, HAND_RECORDINGS_SCHEMA, { key: 'clips', name: 'recorded_hand.part.json' }); say(`Ingen dev-server (${res.error}): JSON hentet i stedet.`); }
  else say(`Kunne ikke gemme: ${res.error}`);
}
async function saveReview(markDefault) {
  if (studio.review?.clip) return saveClips();
  const poses = studio.accept({ markDefault });
  if (!poses.length) return say('Intet at gemme.');
  say('Gemmer…');
  const res = await api.save(poses);
  if (res.ok) {
    say(`Gemt ${poses.map(p => p.id.split('/').pop()).join(' + ')}${markDefault ? ' som standard' : ''} (${res.library.poses.length} i alt). Kør sync i demoen.`);
    refreshLibrary(res.library);
  } else if (res.offline && !renderer.xr.isPresenting) { api.download(poses, RECORDED_SCHEMA); say(`Ingen dev-server (${res.error}): JSON hentet i stedet.`); }
  else say(`Kunne ikke gemme: ${res.error}`);
}
const actions = {
  'side-right': () => { studio.setSide('right'); say('Optager højre hånd.'); },
  'side-left': () => { studio.setSide('left'); say('Optager venstre hånd.'); },
  'grasp-body': () => { studio.setGrasp('body'); say('Greb: krop.'); },
  'grasp-neck': () => { studio.setGrasp('neck'); say('Greb: hals.'); },
  save: () => saveReview(false),
  'save-default': () => saveReview(true),
  discard: () => { studio.discard(); say('Kasseret. Flyt hånden væk og grib igen.'); },
  mirror: () => { studio.setAutoMirror(!studio.settings.autoMirror); say(`Spejling til anden hånd: ${studio.settings.autoMirror ? 'til' : 'fra'}.`); },
  quality: () => { setQuality((level + 1) % 4); say(`Kvalitet: ${LEVELS[level]}.`); },
  recenter: () => { if (renderer.xr.isPresenting) placeItem(head); else studio.setItem([0, 1.0, -0.35]); say('Flasken er flyttet foran dig.'); },
  mode: () => {
    const next = MODES[(MODES.indexOf(studio.settings.mode) + 1) % MODES.length];
    studio.setMode(next);
    say(next === 'grasp' ? 'Tilstand: greb på flasken.' : next === 'animation' ? 'Tilstand: animation. Hold stille for at starte, bevæg, hold stille for at stoppe.'
      : 'Tilstand: gestus. Hold en håndstilling stille hvor som helst.');
  },
  'clip-name': () => {
    const names = GESTURE_NAMES[studio.settings.mode] || GESTURE_NAMES.gesture, at = names.indexOf(studio.settings.clipName);
    studio.setClipName(names[(at + 1) % names.length]);
    say(`Navn: ${studio.settings.clipName}.`);
  },
  synthetic: () => { synthetic = synthetic == null ? time : null; studio.reset(); say(synthetic != null ? 'Syntetisk hånd griber flasken.' : 'Syntetisk hånd fra.'); },
  'undo-save': async () => {
    const ids = [...new Set(studio.lastSaved.map(p => p.id))];
    if (!ids.length) return say('Intet at fortryde.');
    const hand = !!studio.lastSaved[0]?.frames;
    const res = await (hand ? api.removeHand(ids) : api.remove(ids));
    say(res.ok ? `Slettet ${ids.length} gemte.` : `Kunne ikke slette: ${res.error}`);
    if (res.ok && !hand) refreshLibrary(res.library);
  },
};
let synthetic = params.has('synthetic') ? 0 : null;

function panelButtons() {
  const s = studio.settings, review = !!studio.review, handMode = s.mode !== 'grasp';
  return [
    { id: 'side-right', label: 'Højre hånd', row: 0, col: 0, active: s.side === 'right' },
    { id: 'side-left', label: 'Venstre hånd', row: 0, col: 1, active: s.side === 'left' },
    { id: 'grasp-body', label: 'Krop', row: 0, col: 2, active: s.grasp === 'body' },
    { id: 'grasp-neck', label: 'Hals', row: 0, col: 3, active: s.grasp === 'neck' },
    { id: 'save', label: 'Gem', row: 1, col: 0, disabled: !review },
    { id: 'save-default', label: 'Gem som standard', row: 1, col: 1, cols: 2, disabled: !review || handMode },
    { id: 'discard', label: 'Kassér', row: 1, col: 3, disabled: !review },
    { id: 'mirror', label: `Spejl: ${s.autoMirror ? 'til' : 'fra'}`, row: 2, col: 0, active: s.autoMirror },
    { id: 'quality', label: `Kval.: ${LEVELS[level]}`, row: 2, col: 1 },
    { id: 'recenter', label: 'Centrér', row: 2, col: 2 },
    { id: 'undo-save', label: 'Fortryd gem', row: 2, col: 3, disabled: !studio.lastSaved.length },
    { id: 'mode', label: `Tilstand: ${MODE_LABEL[s.mode]}`, row: 3, col: 0, cols: 2, active: handMode },
    { id: 'clip-name', label: `Navn: ${s.clipName}`, row: 3, col: 2, cols: 2, disabled: !handMode },
  ];
}
function statusLines() {
  const live = studio.live, r = studio.review, conf = live?.confidence ?? { left: 0, right: 0 }, s = studio.settings.side;
  const pct = c => `${Math.round(c * 100)} %`;
  const lines = [`Sporing ${s === 'right' ? 'højre' : 'venstre'}: ${pct(conf[s])} ${conf[s] >= 0.6 ? '' : '(usikker)'} · anden: ${pct(conf[s === 'right' ? 'left' : 'right'])}`];
  if (r?.clip) {
    const rp = r.report;
    lines.push(`${MODE_LABEL[r.mode]} '${r.clip.id}': ${rp.keyframes} keyframes af ${rp.used} frames · ${rp.duration.toFixed(2)} s`);
    lines.push(`${rp.hard ? `${rp.hard} uden for leddenes grænser (klampet i ${rp.clampedFrames} keyframes)` : 'inden for leddenes grænser'}${rp.warn ? ` · ${rp.warn} advarsler` : ''}`);
  } else if (studio.settings.mode !== 'grasp') {
    const st = live?.auto?.state, anim = studio.settings.mode === 'animation';
    lines.push(!live?.valid ? 'Ingen hånd: hold hånden foran headsettet.'
      : st === 'holding' || st === 'arming' ? `Hold stille… ${live.auto.remaining.toFixed(1)} s`
      : st === 'recording' ? `Optager ${live.auto.elapsed.toFixed(1)} s · hold stille for at stoppe`
      : st === 'stopping' ? `Stopper… ${live.auto.remaining.toFixed(1)} s` : st === 'rearm' ? 'Bevæg hånden for næste optagelse.'
      : anim ? 'Hold stille for at starte optagelsen.' : 'Hold håndstillingen stille for at optage.');
  } else if (r) {
    lines.push(`Score ${r.score.score}${r.mirror ? ` · spejlet ${r.mirrorScore.score}` : ''} · ${r.score.ok ? 'godkendt' : 'afvist'} · ${r.frames} frames`);
    lines.push(r.score.failures.length ? r.score.failures.slice(0, 2).join('; ') : `indtr. ${r.score.metrics.penetrationMm} mm · håndflade ${r.score.metrics.palmGapMm} mm · tommel ${r.score.metrics.thumbOppositionDeg}°`);
  } else {
    const st = live?.auto?.state;
    lines.push(!live?.valid ? 'Ingen hånd: hold hånden foran headsettet.' : !live.onItem ? 'Grib flasken.'
      : st === 'holding' ? `Hold stille… ${live.auto.remaining.toFixed(1)} s` : st === 'rearm' ? 'Flyt hånden væk for næste optagelse.' : 'Hold stille for at optage.');
    if (live?.tips) lines.push(`Kontakt: ${FINGERS.map(f => `${f[0]}${live.tips[f] === 'touch' ? '✓' : live.tips[f] === 'inside' ? '✗' : '·'}`).join(' ')}`);
  }
  lines.push(message);
  return lines;
}

// ---- DOM panel (desktop and before entering VR) -------------------------------------------------------------------
let libraryCount = null;
function refreshLibrary(lib) {
  libraryCount = lib?.poses?.length ?? null;
  $('library').textContent = libraryCount == null ? 'Gemte greb: ukendt (ingen dev-server)'
    : `Gemte greb i extensions/grasp/recorded_grasps.json: ${libraryCount}${lib.poses.some(p => p.default) ? ` (standard: ${lib.poses.filter(p => p.default).map(p => p.id.split('/').slice(1, 3).join('/')).join(', ')})` : ''}`;
}
function renderDom() {
  const buttons = panelButtons();
  const box = $('actions');
  if (box.childElementCount !== buttons.length + 1) {
    box.replaceChildren(...buttons.map(b => Object.assign(document.createElement('button'), { id: `a-${b.id}`, onclick: () => actions[b.id]() })),
      Object.assign(document.createElement('button'), { id: 'a-synthetic', textContent: 'Syntetisk hånd', onclick: () => actions.synthetic() }));
  }
  for (const b of buttons) { const el = $(`a-${b.id}`); el.textContent = b.label; el.disabled = !!b.disabled; el.classList.toggle('active', !!b.active); }
  $('a-synthetic').classList.toggle('active', synthetic != null);
  $('status').replaceChildren(...statusLines().map(t => Object.assign(document.createElement('div'), { textContent: t })));
}
$('quality').addEventListener('change', () => setQuality($('quality').value));

// ---- XR -----------------------------------------------------------------------------------------------------------
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
vrButton.style.display = 'none';
document.body.append(vrButton);
$('enter-xr').addEventListener('click', () => vrButton.click());
let needPlace = false;
renderer.xr.addEventListener('sessionstart', () => { needPlace = true; synthetic = null; studio.reset(); say('Grib flasken med hånden. Tryk på panelet med den anden hånds pegefinger.'); });
renderer.xr.addEventListener('sessionend', () => { studio.setItem([0, 1.0, -0.35]); say('VR afsluttet.'); });

/** Tracked hand joints (world = the reference space) from an XR frame: { left|right: { joints, emulated } | null }. */
function readHands(frame, ref) {
  const out = { left: null, right: null };
  for (const src of frame.session.inputSources) {
    const side = src.handedness;
    if (!src.hand || (side !== 'left' && side !== 'right')) continue;
    const joints = {};
    let emulated = false, ok = true;
    for (const name of XR_JOINTS) {
      const space = src.hand.get(name), pose = space && frame.getJointPose(space, ref);
      if (!pose) { ok = false; break; }
      const p = pose.transform.position; joints[name] = [p.x, p.y, p.z]; emulated ||= !!pose.emulatedPosition;
    }
    if (ok) out[side] = { joints, emulated };
  }
  return out;
}

window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- frame loop -----------------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
let frames = 0;
renderer.setAnimationLoop((_, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt; frames++;
  let hands = { left: null, right: null };
  if (frame) {
    const ref = renderer.xr.getReferenceSpace(), vp = frame.getViewerPose(ref);
    if (vp) { const { position: p, orientation: o } = vp.transform; head = { pos: [p.x, p.y, p.z], quat: [o.x, o.y, o.z, o.w] }; }
    if (needPlace && vp) { placeItem(head); needPlace = false; }
    hands = readHands(frame, ref);
  } else {
    camera.updateWorldMatrix(true, false);
    head = { pos: camera.getWorldPosition(new THREE.Vector3()).toArray(), quat: camera.getWorldQuaternion(new THREE.Quaternion()).toArray() };
    if (synthetic != null) hands = syntheticHands(time - synthetic, studio.item, { side: studio.settings.side });
  }
  const live = studio.update(time, hands), side = studio.settings.side, it = studio.item, g = ghostItem();
  bottle.position.set(...it.pos); bottle.quaternion.set(...it.quat);
  ghost.position.set(...g.pos); ghost.quaternion.set(...g.quat);
  for (const s of ['left', 'right']) userHands[s].show(hands[s]?.joints ?? null, s === side ? live.tips : null);
  const c = live.closed;
  avatarHand.show(c ? poseJoints({ wrist: c.wrist, quat: c.quat }, c.hand, g, c.angles) : null,
    c ? Object.fromEntries(FINGERS.map(f => [f, c.fingers[f].stuck ? 'inside' : c.fingers[f].touching.length ? 'touch' : 'free'])) : null);
  const top = add(it.pos, v3(it.quat, [0, 0.34, 0]));
  const r = studio.review, st = live.auto;
  badge.update(top, r?.clip ? { mode: 'result', score: r.report.keyframes, ok: !r.report.hard } : r ? { mode: 'result', score: r.score.score, ok: r.score.ok }
    : ['holding', 'arming', 'stopping'].includes(st.state) ? { mode: 'countdown', progress: st.progress, remaining: st.remaining } : { mode: 'hidden' });
  const sign = side === 'right' ? -1 : 1;
  panel.mesh.position.set(...add(it.pos, v3(it.quat, [sign * 0.32, 0.5, 0.04])));
  panel.mesh.quaternion.set(...qmul(it.quat, [Math.sin(-0.13), 0, 0, Math.cos(-0.13)]));
  panel.mesh.visible = renderer.xr.isPresenting || params.has('panel');
  panel.render(panelButtons(), statusLines());
  const poker = hands[side === 'right' ? 'left' : 'right']?.joints;
  const pressed = panel.mesh.visible && poker ? panel.poke([poker[XR_CHAINS.Index[3]]], dt) : null;
  if (pressed) actions[pressed]();
  host.update(dt);
  if (frames % 10 === 1) renderDom();
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});

setQuality(level);
if (!['0', 'off'].includes(params.get('avatar'))) {
  host.load(() => import('./avatar.js'), { id: 'avatar' }).then(a => {
    if (!a) return say('Avatar-tvilling ikke indlæst (kør npm run sync med Contracts); viser referencehånden.');
    twin = a; studio.setAvatarHand(s => a.hand(s));
  });
}
api.library().then(res => refreshLibrary(res.ok ? res.library : null));
renderDom();
// Test hook (tests/smoke.mjs): state and actions, no emulation code in the app.
window.__studio = { studio, actions, host, get twin() { return twin; }, get message() { return message; }, scene, renderer };
window.__ready = true;
