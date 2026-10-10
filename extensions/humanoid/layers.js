// GameSystems humanoid extension: three.js render layers every character uses, so the avatar's first-person view works
// the same for each character-* extension (CharacterCreatorXR convention, MIT, Copyright (c) 2026 Kasper Olesen).
// MAIN: what the player's camera renders. HEAD: head, face and hair meshes (also on MAIN unless first person hides them),
// for mirrors / third-person cameras. EYE_L/EYE_R/MONO/UI/DEBUG are reserved for the hosts.
export const LAYERS = Object.freeze({ MAIN: 0, EYE_L: 1, EYE_R: 2, MONO: 3, HEAD: 4, UI: 5, DEBUG: 6 });
