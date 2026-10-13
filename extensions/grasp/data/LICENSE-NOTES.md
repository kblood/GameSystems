# Grasp validator data: licence and origin

`validator.data.json` extracts the public `HARD`, `COMFORT` and `GATES` constants
without changing their values from GameSystems `extensions/grasp/grasp_validator.js`
(MIT; originally part of Nightfall Contracts). Hard ranges follow the
CharacterCreatorXR hand limits (MIT, Copyright (c) 2026 Kasper Olesen), as documented
in the validator source. The JSON contract and extraction are GameSystems MIT work.

Angles and comfort widths are in degrees. Contact gate lengths are in millimetres;
`minFingersTouching` is a count and `minOppositionDeg` is in degrees. These are game
validation parameters, not medical constraints. The four comfort components are
ordered `dyaw`, `pitch`, `bend1`, `bend2`; thumb twist has a hard range only.
