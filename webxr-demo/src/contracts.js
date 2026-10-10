// The only entry to the CharacterCreator character (GameSystems extension character-cc in ./vendor/extensions). Its
// generated CharacterCreator modules (./vendor/extensions/character-cc/vendor/cc) and assets (public/avatar-assets) come
// from the Contracts game, which generates them from an MIT CharacterCreator commit (npm run sync). When they are absent,
// vite.config.js resolves this file to ./contracts-missing.js instead, so the demo still builds and
// runs; loading the avatar extension then fails cleanly and the demo continues without it (grab_findings 1.7).
export { ccCharacters } from './vendor/extensions/character-cc/index.js';
