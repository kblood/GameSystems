// Which character the demo's avatar wears (extensions plan step 6): ?character=cc (default, the CharacterCreator
// character via ./contracts.js) or ?character=vrm (GameSystems extension character-vrm: a CC0 test VRM via three-vrm,
// synced to public/vrm-assets). Both are character providers for the avatar extension's createCharacterPlugin(); avatar.js
// imports ccCharacters from here instead of ./contracts.js, so this is the only place that knows about the choice.
// Each provider's code is loaded only when it creates a character (dynamic import): ?character=vrm runs without the
// CharacterCreator files, and three-vrm is a separate chunk the default demo never loads. ?vrm=<url> loads another VRM.
export const CHARACTERS = Object.freeze(['cc', 'vrm']);

const params = search => new URLSearchParams(search ?? (typeof location === 'object' ? location.search : ''));
/** 'cc' | 'vrm' from the page URL (unknown values: 'cc'). */
export function characterChoice(search) {
  const id = params(search).get('character');
  return CHARACTERS.includes(id) ? id : 'cc';
}

/** The CharacterCreator flags avatar.js passes for the player -> the VRM tier (skin upgrade = the demo's 'high'). */
const vrmTier = quality => (quality?.player?.skinUpgrade ? 'high' : 'low');

/**
 * Drop-in for contracts.js ccCharacters(options) (same options: assetsURL = the CharacterCreator assets folder, quality):
 * the provider of the chosen character. The VRM model is read from the sibling folder vrm-assets/.
 */
export function ccCharacters(options = {}, search) {
  const choice = characterChoice(search), url = params(search).get('vrm');
  if (choice === 'vrm') {
    const assetsURL = String(options.assetsURL ?? 'avatar-assets/').replace(/avatar-assets\/?$/, 'vrm-assets/');
    return lazyProvider('vrm', ['low', 'high'], () => import('./vendor/extensions/character-vrm/index.js')
      .then(m => m.vrmCharacters({ assetsURL, url: url || undefined, quality: { player: vrmTier(options.quality), npc: 'low' } })));
  }
  return lazyProvider('cc', ['low', 'high'], () => import('./contracts.js').then(m => m.ccCharacters(options)));
}

function lazyProvider(id, quality, load) {
  let provider = null;
  return { id, quality, async create(args) { provider ??= await load(); return provider.create(args); } };
}
