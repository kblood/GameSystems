// Grasp Studio v1 (extensions plan step 4): record grasps on a virtual bottle with Quest 3 hand tracking.
// The scene: the item in front of you, your tracked hands (fingertips green on contact, red inside), a ghost copy of
// the item beside it with the avatar's hand closed to contact (bone model; the CharacterCreator twin at quality
// mellem/høj when the Contracts plugin is synced), a countdown badge and a poke panel. Model and capture logic:
// studio.js + capture.js (pure, tested in node); grasp maths: the synced GameSystems grasp extension; saving: the
// dev-server endpoint (server/grasp_store.mjs) writes GameSystems/extensions/grasp/recorded_grasps.json.
// Modes (panel row 3, extensions plan step 7): Greb (grasps, above), Animation (hold still to start, move, hold still to
// stop; saved as a hand clip) and Gestus (hold a hand pose still anywhere); both hand modes save through /api/hand
// (server/hand_store.mjs) into GameSystems/extensions/avatar/recorded_hand.json as a variant of the chosen name.
// Saving APPENDS variants (never replaces the bake, the library clip or an earlier recording); every save is queued in
// localStorage first (api.js) and leaves the queue only when the endpoint confirmed it, so a failed save is kept and
// retried (on load, panel "Gem kø"). The result is shown in VR as a green / red toast above the panel.
// "Variant" (panel row 4) cycles the original and the saved recordings of the current grasp / name and shows the chosen
// one on the ghost hand, to compare them.
// Avatar view (optional, panel row 4 "Avatar"; default 'twin' = unchanged behaviour): 'mirror' drives the full-body VRIK
// avatar live from your head, hands and fingers in a mirror 1.5 m ahead; 'self' puts it on you (first person: its hands
// on your tracked hands). A second panel then switches the character (CC / VRM), the raw XRHand joints and the thumb
// roll / twist, and shows the hand source (tracked / controller), finger tracking quality and the thumb switches.
// URL options: ?quality=0..3 (default 2), ?avatar=off, ?side=left, ?synthetic (desktop: a synthetic hand grips the item),
// ?avatarview=mirror|self (start in that avatar view), ?character=vrm (start with the VRM character).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHost } from './vendor/extensions/host/index.js';
import { XR_JOINTS, XR_CHAINS, RECORDED_SCHEMA, CATALOG, poseJoints, referenceHand, graspVariants, isPose, THUMB_TWIST } from './vendor/extensions/grasp/index.js';
import { createStudio, syntheticHands, KIND, MODES, GESTURE_NAMES } from './studio.js';
import { HAND_RECORDINGS_SCHEMA, handClip, sampleClip, clipDuration, rowsToArray, toRows } from './vendor/extensions/avatar/handposes.js';
import { THUMB_AXIS, handFrame } from './vendor/extensions/avatar/rigdata.js';
import { snapshotSource } from './vendor/extensions/avatar/fingerInput.js';
import { HandView, itemMesh, Badge, Panel, Toast } from './views.js';
import * as api from './api.js';

const params = new URLSearchParams(location.search);
const LEVELS = ['minimal', 'lav', 'mellem', 'høj'];
const MODE_LABEL = { grasp: 'Greb', animation: 'Animation', gesture: 'Gestus' };
const VIEW_LABEL = { twin: 'tvilling', mirror: 'spejl', self: '1. person' };
const VIEWS = ['twin', 'mirror', 'self'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const GHOST_OFFSET = 0.5; // m beside the item (away from the recording hand): the ghost item, the avatar hand and the twin
const MIRROR_DISTANCE = 0.75; // m from the head to the mirror plane: the reflected avatar stands ~1.5 m ahead
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
const variantHand = new HandView(scene, { color: 0xb48cff, radius: 0.005 });
const mirrorHands = { left: new HandView(scene, { color: 0x7fe0ff, radius: 0.005 }), right: new HandView(scene, { color: 0x7fe0ff, radius: 0.005 }) };
const badge = new Badge(scene);
const panel = new Panel(scene);
const avatarPanel = new Panel(scene, { width: 0.36, height: 0.2, textRow: 0, maxLines: 4, font: 28 });
const toast = new Toast(scene);
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

// ---- avatar view (optional): the VRIK avatar driven live by the user -------------------------------------------------
let avatarView = VIEWS.includes(params.get('avatarview')) ? params.get('avatarview') : 'twin';
let showRaw = true, liveRecord = null, viewRecord = null, mirror = null;
game.avatarView = () => (twin ? avatarView : 'twin');
game.liveTracking = () => viewRecord;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/** The mirror plane: MIRROR_DISTANCE ahead of the head (horizontal), facing it. */
function placeMirror() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...head.quat)); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  mirror = { p: new THREE.Vector3(...head.pos).addScaledVector(fwd, MIRROR_DISTANCE), n: fwd };
}
const reflectP = a => { _v.fromArray(a); const d = _v.clone().sub(mirror.p).dot(mirror.n); return _v.addScaledVector(mirror.n, -2 * d).toArray(); };
const reflectD = v => v.addScaledVector(mirror.n, -2 * v.dot(mirror.n));
/** A frame's quaternion reflected: Y and Z reflected, X = Y x Z (a proper rotation: the mirror image's own frame). */
function reflectQ(q) {
  _q.fromArray(q);
  reflectD(_y.set(0, 1, 0).applyQuaternion(_q)); reflectD(_z.set(0, 0, 1).applyQuaternion(_q));
  _x.crossVectors(_y, _z);
  return _q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)).toArray();
}
const swap = side => (side === 'left' ? 'right' : side === 'right' ? 'left' : side);
/** The tracking record as seen in the mirror: positions and frames reflected, left and right swapped (fingers too). */
function mirrorRecord(r) {
  const hand = h => (h?.valid ? { ...h, pos: reflectP(h.pos), quat: reflectQ(h.quat), ray: null } : { valid: false, kind: h?.kind });
  return { ...r, eyes: null, head: { ...r.head, pos: reflectP(r.head.pos), quat: reflectQ(r.head.quat) },
    hands: { left: hand(r.hands?.right), right: hand(r.hands?.left) },
    snaps: (r.snaps || []).map(s => ({ ...s, handedness: swap(s.handedness),
      joints: s.joints ? Object.fromEntries(Object.entries(s.joints).map(([k, p]) => [k, reflectP(p)])) : null })) };
}
/** Desktop stand-in for the XR tracking record: the camera as head, the (synthetic) hand joints as tracked hands. */
function desktopRecord(hands) {
  const out = { t: time, head: { pos: head.pos, quat: head.quat }, eyes: null, hands: { left: { valid: false }, right: { valid: false } }, snaps: [] };
  for (const side of ['left', 'right']) {
    const J = hands[side]?.joints;
    if (!J) continue;
    const f = handFrame(side, J.wrist, J['index-finger-phalanx-proximal'], J['middle-finger-phalanx-proximal'], J['pinky-finger-phalanx-proximal']);
    out.hands[side] = { pos: [...J.wrist], quat: f.q, valid: true, kind: 'hand' };
    out.snaps.push(snapshotSource({ handedness: side, profiles: [], targetRayMode: 'tracked-pointer', hand: {} }, J));
  }
  return out;
}
function setAvatarView(next) {
  avatarView = next;
  if (next === 'mirror') placeMirror();
  for (const s of ['left', 'right']) mirrorHands[s].show(null);
}
/** Thumb switches (avatar THUMB_AXIS roll / twist): both -> roll only -> neither -> both. */
function cycleThumb() {
  if (THUMB_AXIS.roll && THUMB_AXIS.twist) THUMB_AXIS.twist = false;
  else if (THUMB_AXIS.roll) THUMB_AXIS.roll = false;
  else { THUMB_AXIS.roll = true; THUMB_AXIS.twist = true; }
}
const thumbLabel = () => (THUMB_AXIS.roll && THUMB_AXIS.twist ? 'roll+twist' : THUMB_AXIS.roll ? 'kun roll' : THUMB_AXIS.twist ? 'kun twist' : 'fra');

// ---- saved recordings: library lines, variants to compare ----------------------------------------------------------
let graspLib = null, handLib = null, lastSaved = null; // lastSaved: { kind: 'grasps' | 'hand', ids } of the last confirmed save
let variantAt = -1;  // index into variantList(), -1 = no preview
function variantList() {
  const s = studio.settings;
  if (s.mode === 'grasp') {
    const recorded = (graspLib?.poses || []).filter(isPose);
    return graspVariants(KIND, s.side, s.grasp, recorded).map((pose, i) => ({ kind: 'pose', pose, label: i === 0 && !pose.recorded ? 'original' : shortStamp(pose.recorded?.at, pose.id) }));
  }
  const base = handClip(s.clipName);
  const recorded = (handLib?.clips || []).filter(c => (c.variantOf || c.id.split('@')[0]) === s.clipName && (!c.side || c.side === s.side));
  return [...(base && !base.recorded ? [{ kind: 'clip', clip: base, label: 'original' }] : []),
    ...recorded.map(c => ({ kind: 'clip', clip: c, label: shortStamp(c.recorded?.at, c.id) }))];
}
function shortStamp(at, id) {
  if (at) { const d = new Date(at); if (!Number.isNaN(+d)) return `opt. ${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`; }
  return String(id).split(/[@/]/).pop();
}
const currentVariant = () => { const list = variantList(); return variantAt >= 0 && variantAt < list.length ? { ...list[variantAt], index: variantAt, count: list.length } : null; };
const HAND_SHOW = { pos: [0, 0.16, 0.1], quat: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }; // gesture preview: above the ghost, fingers up, palm to you
/** Joints of the previewed variant on the ghost (reference hand), or null. */
function variantJoints() {
  const v = currentVariant();
  if (!v) return null;
  const side = studio.settings.side, g = ghostItem(), hand = referenceHand(side);
  if (v.kind === 'pose') return poseJoints(v.pose, hand, g, v.pose.angles);
  const clip = v.clip, dur = clipDuration(clip) || 0;
  const f = sampleClip(clip, dur > 0 ? time % (dur + 0.6) : 0, { loop: false });
  const rows = rowsToArray(toRows(f.rows));
  const wrist = clip.space === 'item' ? f.wrist : { pos: add(HAND_SHOW.pos, v3(HAND_SHOW.quat, f.wrist.pos)), quat: qmul(HAND_SHOW.quat, f.wrist.quat) };
  return poseJoints({ wrist: wrist.pos, quat: wrist.quat }, hand, g, rows);
}

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
/** Result of a save on the 2D page too (the toast is the VR one). */
function flashDom(ok, text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text; el.className = ok ? 'ok' : 'fail';
  clearTimeout(flashDom.timer); flashDom.timer = setTimeout(() => { el.className = ''; }, ok ? 4000 : 15000);
}
function announce(ok, short, long = short) {
  say(long);
  toast.show(short, { ok });
  flashDom(ok, long);
}
/**
 * Save through the endpoint, never losing it: queued in localStorage first (api.keepPending), out of the queue only
 * when the endpoint confirmed it. kind 'grasps' | 'hand'. -> the endpoint's answer.
 */
async function persist(kind, items, describe) {
  const { key, stored } = api.keepPending(kind, items);
  say('Gemmer…'); toast.show('Gemmer…', { ok: true, seconds: 10 });
  const res = await api.sendPending({ key, kind, items });
  if (res.ok) {
    lastSaved = { kind, ids: res.changed };
    if (kind === 'grasps') refreshLibrary(res.library); else refreshHand(res.library);
    announce(true, `Gemt ✓ ${describe.short(res)}`, describe.long(res));
  } else {
    if (res.offline && !renderer.xr.isPresenting) {
      if (kind === 'hand') api.download(items, HAND_RECORDINGS_SCHEMA, { key: 'clips', name: 'recorded_hand.part.json' });
      else api.download(items, RECORDED_SCHEMA);
    }
    const n = api.pending().length;
    announce(false, `IKKE GEMT (${n} i kø): ${res.error}`.slice(0, 70),
      `IKKE GEMT: ${res.error}${res.kept ? ` (serveren gemte forsøget i ${res.kept})` : ''}. Optagelsen ligger i køen (${n}${stored ? ', gemt i browseren' : ', kun i denne side'}); tryk "Gem kø" for at prøve igen.`);
  }
  return res;
}
async function saveClips() {
  const clips = studio.accept();
  if (!clips.length) return say('Intet at gemme.');
  const name = clips[0].variantOf || clips[0].id;
  return persist('hand', clips, {
    short: res => `${name} (${res.changed[0]?.split('@')[1] ?? ''})`,
    long: res => `Gemt som ny variant ${res.changed[0]} (${clips.map(c => c.side).join(' + ')}, ${clips[0].frames.length} keyframes; ${res.library.clips.length} klip i alt). Originalen '${name}' er uændret. Kør sync i spillene.`,
  });
}
async function saveReview(preferred) {
  if (studio.review?.clip) return saveClips();
  const poses = studio.accept({ markDefault: preferred });
  if (!poses.length) return say('Intet at gemme.');
  return persist('grasps', poses, {
    short: () => `${poses.length} greb${preferred ? ' (foretrukken)' : ''}`,
    long: res => `Gemt som ny variant: ${res.changed.map(id => id.split('/').pop()).join(' + ')}${preferred ? ' (foretrukken optagelse)' : ''} (${res.library.poses.length} optagelser i alt). Det bagte greb er stadig standard. Kør sync i demoen.`,
  });
}
async function retryQueue() {
  const queue = api.pending();
  if (!queue.length) return say('Køen er tom: alt er gemt.');
  say(`Prøver at gemme ${queue.length} fra køen…`);
  const { saved, failed } = await api.retryPending();
  for (const { entry, res } of saved) { lastSaved = { kind: entry.kind, ids: res.changed }; if (entry.kind === 'grasps') refreshLibrary(res.library); else refreshHand(res.library); }
  if (!failed.length) announce(true, `Gemt ✓ ${saved.length} fra køen`, `Gemt ${saved.length} optagelse(r) fra køen.`);
  else announce(false, `IKKE GEMT: ${failed.length} stadig i kø`, `${saved.length} gemt, ${failed.length} stadig i køen: ${failed[0].error}`);
}
const actions = {
  'side-right': () => { studio.setSide('right'); variantAt = -1; say('Optager højre hånd.'); },
  'side-left': () => { studio.setSide('left'); variantAt = -1; say('Optager venstre hånd.'); },
  'grasp-body': () => { studio.setGrasp('body'); variantAt = -1; say('Greb: krop.'); },
  'grasp-neck': () => { studio.setGrasp('neck'); variantAt = -1; say('Greb: hals.'); },
  save: () => saveReview(false),
  'save-default': () => saveReview(true),
  discard: () => { studio.discard(); say('Kasseret. Flyt hånden væk og grib igen.'); },
  mirror: () => { studio.setAutoMirror(!studio.settings.autoMirror); say(`Spejling til anden hånd: ${studio.settings.autoMirror ? 'til' : 'fra'}.`); },
  quality: () => { setQuality((level + 1) % 4); say(`Kvalitet: ${LEVELS[level]}.`); },
  recenter: () => {
    if (renderer.xr.isPresenting) placeItem(head); else studio.setItem([0, 1.0, -0.35]);
    if (avatarView === 'mirror') placeMirror();
    say('Flasken er flyttet foran dig.');
  },
  mode: () => {
    const next = MODES[(MODES.indexOf(studio.settings.mode) + 1) % MODES.length];
    studio.setMode(next); variantAt = -1;
    say(next === 'grasp' ? 'Tilstand: greb på flasken.' : next === 'animation' ? 'Tilstand: animation. Hold stille for at starte, bevæg, hold stille for at stoppe.'
      : 'Tilstand: gestus. Hold en håndstilling stille hvor som helst.');
  },
  'clip-name': () => {
    const names = GESTURE_NAMES[studio.settings.mode] || GESTURE_NAMES.gesture, at = names.indexOf(studio.settings.clipName);
    studio.setClipName(names[(at + 1) % names.length]); variantAt = -1;
    say(`Navn: ${studio.settings.clipName}.`);
  },
  synthetic: () => { synthetic = synthetic == null ? time : null; studio.reset(); say(synthetic != null ? 'Syntetisk hånd griber flasken.' : 'Syntetisk hånd fra.'); },
  'undo-save': async () => {
    if (!lastSaved?.ids?.length) return say('Intet at fortryde.');
    const ids = [...new Set(lastSaved.ids)], hand = lastSaved.kind === 'hand';
    const res = await (hand ? api.removeHand(ids) : api.remove(ids));
    say(res.ok ? `Slettet ${ids.length} gemte.` : `Kunne ikke slette: ${res.error}`);
    if (res.ok) { lastSaved = null; if (hand) refreshHand(res.library); else refreshLibrary(res.library); variantAt = -1; }
  },
  variant: () => {
    const list = variantList();
    variantAt = variantAt + 1 >= list.length ? -1 : variantAt + 1;
    const v = currentVariant();
    say(v ? `Viser variant ${v.index + 1}/${v.count}: ${v.label} (lilla hånd ved spøgelsesflasken).` : 'Ingen variant vist.');
  },
  'retry-queue': () => retryQueue(),
  'avatar-view': () => {
    if (!twin) return say('Ingen avatar indlæst (kør npm run sync med Contracts, eller ?character=vrm).');
    const next = VIEWS[(VIEWS.indexOf(avatarView) + 1) % VIEWS.length];
    setAvatarView(next);
    say(next === 'mirror' ? 'Avatar: spejl. Den står 1,5 m foran dig og følger dit hoved, dine hænder og fingre.'
      : next === 'self' ? 'Avatar: 1. person. Avatarens hænder ligger på dine sporede hænder.' : 'Avatar: tvilling ved spøgelsesflasken (standard).');
  },
  'avatar-character': async () => {
    if (!twin) return;
    const next = twin.character === 'vrm' ? 'cc' : 'vrm';
    say(`Skifter figur til ${next.toUpperCase()}…`);
    const got = await twin.setCharacter(next);
    say(got === next ? `Figur: ${next.toUpperCase()}.` : `Kunne ikke skifte figur: ${twin.loadError}`);
  },
  'avatar-raw': () => { showRaw = !showRaw; say(`Rå XRHand-led: ${showRaw ? 'vises' : 'skjult'}.`); },
  'avatar-thumb': () => { cycleThumb(); say(`Avatarens tommelfinger: ${thumbLabel()}.`); },
};
let synthetic = params.has('synthetic') ? 0 : null;

function panelButtons() {
  const s = studio.settings, review = !!studio.review, handMode = s.mode !== 'grasp', queued = api.pending().length, v = currentVariant();
  return [
    { id: 'side-right', label: 'Højre hånd', row: 0, col: 0, active: s.side === 'right' },
    { id: 'side-left', label: 'Venstre hånd', row: 0, col: 1, active: s.side === 'left' },
    { id: 'grasp-body', label: 'Krop', row: 0, col: 2, active: s.grasp === 'body' },
    { id: 'grasp-neck', label: 'Hals', row: 0, col: 3, active: s.grasp === 'neck' },
    { id: 'save', label: 'Gem', row: 1, col: 0, disabled: !review },
    { id: 'save-default', label: 'Gem som foretrukken', row: 1, col: 1, cols: 2, disabled: !review || handMode },
    { id: 'discard', label: 'Kassér', row: 1, col: 3, disabled: !review },
    { id: 'mirror', label: `Spejl: ${s.autoMirror ? 'til' : 'fra'}`, row: 2, col: 0, active: s.autoMirror },
    { id: 'quality', label: `Kval.: ${LEVELS[level]}`, row: 2, col: 1 },
    { id: 'recenter', label: 'Centrér', row: 2, col: 2 },
    { id: 'undo-save', label: 'Fortryd gem', row: 2, col: 3, disabled: !lastSaved?.ids?.length },
    { id: 'mode', label: `Tilstand: ${MODE_LABEL[s.mode]}`, row: 3, col: 0, cols: 2, active: handMode },
    { id: 'clip-name', label: `Navn: ${s.clipName}`, row: 3, col: 2, cols: 2, disabled: !handMode },
    { id: 'avatar-view', label: `Avatar: ${VIEW_LABEL[avatarView]}`, row: 4, col: 0, cols: 2, active: avatarView !== 'twin', disabled: !twin },
    { id: 'variant', label: v ? `Variant ${v.index + 1}/${v.count}` : 'Variant: vis', row: 4, col: 2, active: !!v },
    { id: 'retry-queue', label: `Gem kø (${queued})`, row: 4, col: 3, disabled: !queued, active: queued > 0 },
  ];
}
function avatarButtons() {
  if (avatarView === 'twin' || !twin) return [];
  return [
    { id: 'avatar-character', label: twin.loading ? 'Indlæser…' : `Figur: ${twin.character.toUpperCase()}`, row: 0, col: 0, disabled: !!twin.loading },
    { id: 'avatar-raw', label: `Rå led: ${showRaw ? 'til' : 'fra'}`, row: 0, col: 1, active: showRaw },
    { id: 'avatar-thumb', label: `Tommel: ${thumbLabel()}`, row: 0, col: 2, cols: 2, active: THUMB_AXIS.roll || THUMB_AXIS.twist },
  ];
}
/** Hand source of a side in the tracking record: 'hånd' (XRHand joints), 'controller' or 'ingen'. */
function handSource(record, side) {
  const h = record?.hands?.[side], snap = record?.snaps?.find(s => s.handedness === side);
  if (!h?.valid) return h?.kind === 'hand' ? 'hånd (tabt)' : 'ingen';
  return h.kind === 'hand' && snap?.joints ? 'hånd' : 'controller';
}
function avatarLines() {
  if (avatarView === 'twin' || !twin) return [];
  const p = twin.player, conf = studio.live?.confidence ?? { left: 0, right: 0 }, pct = c => `${Math.round(c * 100)} %`;
  const src = s => { const k = handSource(liveRecord, s); return k === 'hånd' ? `sporet hånd, fingre ${pct(conf[s])}` : k; };
  return [
    `${VIEW_LABEL[avatarView]} · ${twin.character.toUpperCase()} · krop ${p?.quality ?? '-'} · fingerdata ${p?.handPoseQuality ?? '-'}${level === 0 ? ' · minimal: avatar slået fra' : ''}`,
    `V: ${src('left')} · H: ${src('right')}`,
    `Tommel: roll ${THUMB_AXIS.roll ? 'til' : 'fra'} · twist ${THUMB_AXIS.twist ? 'til' : 'fra'} (optagelse ${THUMB_TWIST.enabled ? 'til' : 'fra'})`,
    twin.loadError ? `Figur-fejl: ${twin.loadError}` : avatarView === 'mirror' ? 'Cyan led = dine rå led i spejlet. Centrér flytter spejlet.' : 'Hvide led = dine rå XRHand-led.',
  ];
}
function statusLines() {
  const live = studio.live, r = studio.review, conf = live?.confidence ?? { left: 0, right: 0 }, s = studio.settings.side;
  const pct = c => `${Math.round(c * 100)} %`;
  const lines = [`Sporing ${s === 'right' ? 'højre' : 'venstre'}: ${pct(conf[s])} ${conf[s] >= 0.6 ? '' : '(usikker)'} · anden: ${pct(conf[s === 'right' ? 'left' : 'right'])}`];
  if (r?.clip) {
    const rp = r.report;
    lines.push(`${MODE_LABEL[r.mode]} '${r.clip.variantOf || r.clip.id}': ${rp.keyframes} keyframes af ${rp.used} frames · ${rp.duration.toFixed(2)} s`);
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
function refreshLibrary(lib) {
  graspLib = lib ?? null;
  renderLibrary();
}
function refreshHand(lib) {
  handLib = lib ?? null;
  renderLibrary();
}
function renderLibrary() {
  const poses = graspLib?.poses, clips = handLib?.clips, queued = api.pending().length;
  const names = clips ? [...new Set(clips.map(c => c.variantOf || c.id.split('@')[0]))] : [];
  $('library').textContent = [
    poses == null ? 'Gemte greb: ukendt (ingen dev-server)'
      : `Gemte greb (varianter) i extensions/grasp/recorded_grasps.json: ${poses.length}${poses.some(p => p.default) ? ` (foretrukne: ${poses.filter(p => p.default).map(p => p.id.split('/').slice(1, 3).join('/')).join(', ')})` : ''}`,
    clips == null ? '' : `Gemte håndklip (varianter) i extensions/avatar/recorded_hand.json: ${clips.length}${names.length ? ` (${names.join(', ')})` : ''}`,
    queued ? `IKKE GEMT: ${queued} optagelse(r) i køen. Tryk "Gem kø".` : '',
  ].filter(Boolean).join(' · ');
}
function renderDom() {
  const buttons = [...panelButtons(), ...avatarButtons()];
  const box = $('actions');
  const key = buttons.map(b => b.id).join();
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...buttons.map(b => Object.assign(document.createElement('button'), { id: `a-${b.id}`, onclick: () => actions[b.id]() })),
      Object.assign(document.createElement('button'), { id: 'a-synthetic', textContent: 'Syntetisk hånd', onclick: () => actions.synthetic() }));
  }
  for (const b of buttons) { const el = $(`a-${b.id}`); el.textContent = b.label; el.disabled = !!b.disabled; el.classList.toggle('active', !!b.active); }
  $('a-synthetic').classList.toggle('active', synthetic != null);
  $('status').replaceChildren(...[...statusLines(), ...avatarLines()].map(t => Object.assign(document.createElement('div'), { textContent: t })));
}
$('quality').addEventListener('change', () => setQuality($('quality').value));

// ---- XR -----------------------------------------------------------------------------------------------------------
// Own enter/exit instead of three's VRButton: VRButton also calls navigator.xr.offerSession at creation, which the Quest
// browser cancels ("called more than once") as soon as the page requests a session itself, never re-offers after a
// session ended from the system menu, and its requestSession had no error handling (a refused or double start left the
// button dead). One request at a time; any end (button, system menu, headset off) restores the 2D page.
const SESSION_INIT = { optionalFeatures: ['local-floor', 'bounded-floor', 'layers', 'hand-tracking'] };
let xrStarting = false;
function setXrButton() {
  const b = $('enter-xr'), on = renderer.xr.isPresenting;
  b.textContent = xrStarting ? 'Starter VR…' : on ? 'Afslut VR' : 'Gå i VR';
  b.disabled = xrStarting || !navigator.xr;
}
async function toggleXR() {
  if (xrStarting) return;
  const current = renderer.xr.getSession();
  if (current) { current.end().catch(() => {}); return; }
  if (!navigator.xr) return say('WebXR findes ikke i denne browser.');
  xrStarting = true; setXrButton();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', SESSION_INIT);
    await renderer.xr.setSession(session);
  } catch (err) {
    say(`Kunne ikke starte VR: ${err?.message || err}`);
  } finally { xrStarting = false; setXrButton(); }
}
$('enter-xr').addEventListener('click', toggleXR);
setXrButton();
let needPlace = false;
renderer.xr.addEventListener('sessionstart', () => {
  needPlace = true; synthetic = null; studio.reset(); panel.reset(); avatarPanel.reset(); setXrButton();
  const queued = api.pending().length;
  say(queued ? `${queued} optagelse(r) er ikke gemt endnu: tryk "Gem kø".` : 'Grib flasken med hånden. Tryk på panelet med en pegefinger.');
});
renderer.xr.addEventListener('sessionend', () => {
  // the review (an unsaved capture) is kept: Gem / Kassér work on the 2D page after leaving VR
  needPlace = false; panel.reset(); avatarPanel.reset(); studio.setItem([0, 1.0, -0.35]); setXrButton(); say('VR afsluttet.');
});

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
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion();
renderer.setAnimationLoop((_, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt; frames++;
  let hands = { left: null, right: null };
  const live3 = avatarView !== 'twin' && !!twin;
  if (frame) {
    const ref = renderer.xr.getReferenceSpace(), vp = frame.getViewerPose(ref);
    if (vp) { const { position: p, orientation: o } = vp.transform; head = { pos: [p.x, p.y, p.z], quat: [o.x, o.y, o.z, o.w] }; }
    if (needPlace && vp) { placeItem(head); if (avatarView === 'mirror') placeMirror(); needPlace = false; }
    hands = readHands(frame, ref);
    liveRecord = live3 ? twin.readTracking(frame, dt) : null;
  } else {
    camera.updateWorldMatrix(true, false);
    head = { pos: camera.getWorldPosition(new THREE.Vector3()).toArray(), quat: camera.getWorldQuaternion(new THREE.Quaternion()).toArray() };
    if (synthetic != null) hands = syntheticHands(time - synthetic, studio.item, { side: studio.settings.side });
    liveRecord = live3 ? desktopRecord(hands) : null;
  }
  if (live3 && avatarView === 'mirror' && !mirror) placeMirror();
  viewRecord = !liveRecord ? null : avatarView === 'mirror' ? mirrorRecord(liveRecord) : liveRecord;
  const live = studio.update(time, hands), side = studio.settings.side, it = studio.item, g = ghostItem();
  bottle.position.set(...it.pos); bottle.quaternion.set(...it.quat);
  ghost.position.set(...g.pos); ghost.quaternion.set(...g.quat);
  const raw = !live3 || showRaw; // the raw tracked joints: always in the default view, switchable in the avatar views
  for (const s of ['left', 'right']) userHands[s].show(raw ? hands[s]?.joints ?? null : null, s === side ? live.tips : null);
  for (const s of ['left', 'right']) {   // the raw joints reflected onto the mirror avatar's hands (cyan)
    const J = live3 && avatarView === 'mirror' && showRaw && mirror ? viewRecord?.snaps?.find(x => x.handedness === s)?.joints : null;
    mirrorHands[s].show(J ?? null);
  }
  const c = live.closed;
  avatarHand.show(c ? poseJoints({ wrist: c.wrist, quat: c.quat }, c.hand, g, c.angles) : null,
    c ? Object.fromEntries(FINGERS.map(f => [f, c.fingers[f].stuck ? 'inside' : c.fingers[f].touching.length ? 'touch' : 'free'])) : null);
  variantHand.show(variantAt >= 0 ? variantJoints() : null);
  const top = add(it.pos, v3(it.quat, [0, 0.34, 0]));
  const r = studio.review, st = live.auto;
  badge.update(top, r?.clip ? { mode: 'result', score: r.report.keyframes, ok: !r.report.hard } : r ? { mode: 'result', score: r.score.score, ok: r.score.ok }
    : ['holding', 'arming', 'stopping'].includes(st.state) ? { mode: 'countdown', progress: st.progress, remaining: st.remaining } : { mode: 'hidden' });
  const sign = side === 'right' ? -1 : 1, tilt = qmul(it.quat, [Math.sin(-0.13), 0, 0, Math.cos(-0.13)]);
  panel.mesh.position.set(...add(it.pos, v3(it.quat, [sign * 0.32, 0.5, 0.04])));
  panel.mesh.quaternion.set(...tilt);
  const vrUi = renderer.xr.isPresenting || params.has('panel');
  panel.mesh.visible = vrUi;
  panel.render(panelButtons(), statusLines());
  toast.update(dt, _tp.set(...add(it.pos, v3(it.quat, [sign * 0.32, 0.69, 0.045]))), _tq.set(...tilt), vrUi);
  const aButtons = avatarButtons();
  avatarPanel.mesh.visible = vrUi && aButtons.length > 0;
  if (avatarPanel.mesh.visible) {
    avatarPanel.mesh.position.set(...add(it.pos, v3(it.quat, [-sign * 0.34, 0.45, 0.04])));
    avatarPanel.mesh.quaternion.set(...tilt);
    avatarPanel.render(aButtons, avatarLines());
  }
  // Either index tip presses the panel; the recording hand only while it is not being captured (a press with the free
  // recording hand right after a capture used to do nothing: only the other hand counted).
  const capturing = ['holding', 'arming', 'recording', 'stopping'].includes(st.state);
  const tips = ['left', 'right'].filter(s => !(capturing && s === side)).map(s => hands[s]?.joints?.[XR_CHAINS.Index[3]] ?? null);
  const pressed = (panel.mesh.visible ? panel.poke(tips, dt) : null) ?? (avatarPanel.mesh.visible ? avatarPanel.poke(tips, dt) : null);
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
    if (avatarView === 'mirror') placeMirror();
  });
}
// Libraries, then the queue: saves that failed before (this page or an earlier load) are retried once the endpoint answers.
Promise.all([api.library(), api.handLibrary()]).then(async ([g, h]) => {
  refreshLibrary(g.ok ? g.library : null); refreshHand(h.ok ? h.library : null);
  const queued = api.pending().length;
  if (queued && g.ok) await retryQueue();
  else if (queued) announce(false, `IKKE GEMT: ${queued} i kø`, `${queued} optagelse(r) venter i køen (ingen dev-server: ${g.error}).`);
});
renderDom();
// Test hook (tests/smoke.mjs): state and actions, no emulation code in the app.
window.__studio = { studio, actions, host, get twin() { return twin; }, get message() { return message; }, scene, renderer, panel, avatarPanel, toast, toggleXR,
  api, get avatarView() { return avatarView; }, get viewRecord() { return viewRecord; }, get liveRecord() { return liveRecord; }, get lastSaved() { return lastSaved; }, currentVariant, THUMB_AXIS };
window.__ready = true;
