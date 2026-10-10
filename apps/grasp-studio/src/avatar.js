// Avatar twin (extension, GameSystems/extensions/host): the CharacterCreator avatar standing beside the user,
// holding the ghost copy of the item with the live capture closed to contact on ITS OWN hand, so the recorder sees on a
// real character what the game will show. Loaded by main.js with host.load(() => import('./avatar.js')): without the
// CharacterCreator files (src/contracts.js -> contracts-missing.js) loading fails cleanly and the studio keeps the
// bone-model hand. Same route as the bottle demo (webxr-demo/src/avatar.js): the avatar extension poses the character-cc
// character (via ./contracts.js); grasp from the synced GameSystems extension. Quality tiers as in the demo: off (hidden,
// not solved), low (avatar 'arms', character 'low' preset), high (avatar 'full', skin upgrade); the avatar tier switches
// live, the character's rendering preset is chosen when it loads.
//
// ctx.game.twin() -> { t, head: {pos, quat}, side, kind, hand: {pos, quat} | null (world wrist on the ghost item),
//                      angles: rows | null } in the twin's place (main.js shifts the head by the ghost offset).
import { ccCharacters } from './character-select.js'; // ./contracts.js (CharacterCreator) or ?character=vrm (character-vrm)
import { createCharacterPlugin } from './vendor/extensions/avatar/index.js';
import { fingerState, handGeometry, DEFAULT_OPEN } from './vendor/extensions/grasp/index.js';
import { STUDIO_AVATAR } from './avatar-config.js';

const AVATAR_TIER = { off: 'off', low: 'arms', high: 'full' };

export default function avatarTwin() {
  let characters = null, player = null, hidden = false, handCache = null;
  /** closure.handGeometry() of the twin's rest hand (player.restHand(side)), rebuilt when the rig or the scale changes. */
  function handOf(side) {
    if (!player?.rig) return null;
    if (handCache?.rig !== player.rig || handCache.scale !== player.scale) handCache = { rig: player.rig, scale: player.scale };
    if (!(side in handCache)) { const rest = player.restHand(side); handCache[side] = rest && !rest.mitten ? handGeometry(rest) : null; }
    return handCache[side];
  }
  let game = null;
  return {
    id: 'avatar',
    quality: ['off', 'low', 'high'],
    async init(ctx) {
      game = ctx.game;
      const playerQuality = ctx.quality === 'high' ? { skinUpgrade: true, shadows: false }
        : { cloth: false, skinUpgrade: false, hairUpgrade: false, shadows: false, hairCollision: false };
      const character = ccCharacters({ assetsURL: ctx.assetURL('avatar-assets/'),
        quality: { player: playerQuality, npc: { skinUpgrade: false, shadows: false, cloth: false, hairCollision: false } } });
      characters = createCharacterPlugin({ scene: ctx.scene, renderer: ctx.renderer, character, quality: AVATAR_TIER[ctx.quality] ?? 'full' });
      try {
        player = await characters.createPlayer({ ...STUDIO_AVATAR, firstPerson: false });
        await player.ready;
      } catch (error) { characters.dispose?.(); characters = null; throw error; }
      if (!player.root.parent) ctx.scene.add(player.root);
      hidden = ctx.quality === 'off';
      return { get active() { return !hidden; }, player, hand: side => (hidden ? null : handOf(side)) };
    },
    update(dt) {
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
      hidden = tier === 'off';
      player?.setQuality(AVATAR_TIER[tier] ?? 'full'); // 'off' hides it; leaving 'off' restarts the solver
    },
    dispose() { player?.dispose(); characters?.dispose?.(); player = characters = null; },
  };
}
