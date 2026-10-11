// Avatar twin (extension, GameSystems/extensions/host): the CharacterCreator avatar standing beside the user,
// holding the ghost copy of the item with the live capture closed to contact on ITS OWN hand, so the recorder sees on a
// real character what the game will show. Loaded by main.js with host.load(() => import('./avatar.js')): without the
// CharacterCreator files (src/contracts.js -> contracts-missing.js) loading fails cleanly and the studio keeps the
// bone-model hand. Same route as the bottle demo (webxr-demo/src/avatar.js): the avatar extension poses the character-cc
// character (via ./contracts.js); grasp from the synced GameSystems extension. Quality tiers as in the demo: off (hidden,
// not solved), low (avatar 'arms', character 'low' preset), high (avatar 'full', skin upgrade); the avatar tier switches
// live, the character's rendering preset is chosen when it loads.
//
// Views (main.js game.avatarView(); the studio's "Avatar" button, optional, default 'twin'):
//   'twin'    the above: ctx.game.twin() -> { t, head: {pos, quat}, side, kind, hand: {pos, quat} | null (world wrist on
//             the ghost item), angles: rows | null } in the twin's place (main.js shifts the head by the ghost offset)
//   'mirror'  full-body VRIK driven live by the user's head, hands and fingers, reflected into a mirror 1.5 m ahead
//   'self'    the same unreflected, first person (head hidden): the avatar's hands lie on the tracked hands
// For the live views main.js reads the frame with api.readTracking(frame, dt) (the plugin's XR tracking record) and
// hands the (reflected) record back through ctx.game.liveTracking(). setCharacter('cc' | 'vrm') swaps the character.
import { ccCharacters, characterChoice } from './character-select.js'; // ./contracts.js (CharacterCreator) or character-vrm
import { createCharacterPlugin } from './vendor/extensions/avatar/index.js';
import { fingerState, handGeometry, DEFAULT_OPEN } from './vendor/extensions/grasp/index.js';
import { STUDIO_AVATAR } from './avatar-config.js';

const AVATAR_TIER = { off: 'off', low: 'arms', high: 'full' };
export const AVATAR_VIEWS = Object.freeze(['twin', 'mirror', 'self']);

export default function avatarTwin() {
  let characters = null, player = null, hidden = false, handCache = null, ctx = null, game = null;
  let view = 'twin', character = characterChoice(), loading = null, loadError = null, tierNow = 'high';
  /** closure.handGeometry() of the twin's rest hand (player.restHand(side)), rebuilt when the rig, the scale or the hand profile (player.setHandProfile) changes. */
  function handOf(side) {
    if (!player?.rig) return null;
    if (handCache?.rig !== player.rig || handCache.scale !== player.scale || handCache.version !== player.handProfileVersion) handCache = { rig: player.rig, scale: player.scale, version: player.handProfileVersion };
    if (!(side in handCache)) { const rest = player.restHand(side); handCache[side] = rest && !rest.mitten ? handGeometry(rest) : null; }
    return handCache[side];
  }
  /** A character plugin + player for `choice` ('cc' | 'vrm'). */
  async function create(choice) {
    const playerQuality = ctx.quality === 'high' ? { skinUpgrade: true, shadows: false }
      : { cloth: false, skinUpgrade: false, hairUpgrade: false, shadows: false, hairCollision: false };
    const vrm = typeof location === 'object' ? new URLSearchParams(location.search).get('vrm') : null;   // ?vrm=<url> still applies
    const provider = ccCharacters({ assetsURL: ctx.assetURL('avatar-assets/'),
      quality: { player: playerQuality, npc: { skinUpgrade: false, shadows: false, cloth: false, hairCollision: false } } },
    `?character=${choice}${vrm ? `&vrm=${encodeURIComponent(vrm)}` : ''}`);
    const plugin = createCharacterPlugin({ scene: ctx.scene, renderer: ctx.renderer, character: provider, quality: AVATAR_TIER[tierNow] ?? 'full' });
    try {
      const p = await plugin.createPlayer({ ...STUDIO_AVATAR, firstPerson: false });
      await p.ready;
      if (!p.root.parent) ctx.scene.add(p.root);
      return { plugin, player: p };
    } catch (error) { plugin.dispose?.(); throw error; }
  }
  const api = {
    get active() { return !hidden; },
    get player() { return player; },
    get character() { return character; },
    get view() { return view; },
    get loading() { return loading; },
    get loadError() { return loadError; },
    hand: side => (hidden ? null : handOf(side)),
    /** The plugin's XR tracking record for this frame (head, hands with kind 'hand' | 'controller', finger snaps), or null. */
    readTracking: (frame, dt) => (characters && frame ? characters.readTracking(frame, dt) : null),
    /** Swap the character ('cc' | 'vrm'); the old one stays until the new one has loaded. Resolves to the choice in use. */
    async setCharacter(choice) {
      if (choice === character || loading) return character;
      loading = choice; loadError = null;
      try {
        const next = await create(choice);
        player?.dispose(); characters?.dispose?.();
        ({ plugin: characters, player } = next);
        handCache = null; character = choice; view = 'twin';   // update() re-applies the wanted view to the new player
      } catch (error) { loadError = `${choice}: ${error.message}`; console.warn(`[avatar] could not load character ${choice}: ${error.message}`); }
      finally { loading = null; }
      return character;
    },
  };
  return {
    id: 'avatar',
    quality: ['off', 'low', 'high'],
    async init(c) {
      ctx = c; game = c.game;
      hidden = c.quality === 'off'; tierNow = c.quality;
      ({ plugin: characters, player } = await create(character));
      return api;
    },
    update(dt) {
      if (!player) return;
      const want = game?.avatarView?.() ?? 'twin';
      if (want !== view) { view = want; player.setFirstPerson(view === 'self'); player.resetTracking(); }
      if (view !== 'twin') {
        const record = game?.liveTracking?.();
        if (record) player.updateTracking(record, dt);
        return;
      }
      const twin = game?.twin?.();
      if (!twin) return;
      const hands = { left: { valid: false }, right: { valid: false } }, fingers = {};
      if (twin.hand) {
        hands[twin.side] = { pos: twin.hand.pos, quat: twin.hand.quat, valid: true, kind: 'controller' };
        if (twin.angles) fingers[twin.side] = fingerState({ kind: twin.kind, open: DEFAULT_OPEN, angles: twin.angles }, 1);
      }
      player.updateTracking({ t: twin.t, head: twin.head, hands, snaps: [], eyes: null, fingers }, dt);
    },
    setQuality(tier) {
      hidden = tier === 'off'; tierNow = tier;
      player?.setQuality(AVATAR_TIER[tier] ?? 'full'); // 'off' hides it; leaving 'off' restarts the solver
    },
    dispose() { player?.dispose(); characters?.dispose?.(); player = characters = null; },
  };
}
