// Stand-in for ./contracts.js when the CharacterCreator files were not synced from Contracts (see vite.config.js). Same
// export names; importing it fails, which disables only the avatar extension.
throw new Error('CharacterCreator files not synced: run `npm run sync` with the Contracts repo next to GameSystems (after its npm run sync) or CONTRACTS_DIR set');
export const ccCharacters = null;
