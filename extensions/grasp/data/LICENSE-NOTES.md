# Grasp data: licence and origin

`validator.data.json` extracts the public `HARD`, `COMFORT` and `GATES` constants
without changing their values from GameSystems `extensions/grasp/grasp_validator.js`
(MIT; originally part of Nightfall Contracts). Hard ranges follow the
CharacterCreatorXR hand limits (MIT, Copyright (c) 2026 Kasper Olesen), as documented
in the validator source. The JSON contract and extraction are GameSystems MIT work.

Angles and comfort widths are in degrees. Contact gate lengths are in millimetres;
`minFingersTouching` is a count and `minOppositionDeg` is in degrees. These are game
validation parameters, not medical constraints. The four comfort components are
ordered `dyaw`, `pitch`, `bend1`, `bend2`; thumb twist has a hard range only.

`closure.data.json` preserves the public `CLOSURE`, `PAD_RADIUS`, `REFERENCE_HAND`
and `THUMB_TILT` defaults from GameSystems `extensions/grasp/closure.js` (MIT).
Pad fractions and reference-hand measurements retain their CharacterCreator-hand
grasp-lab provenance, documented next to the original exports. The JSON extraction
does not import CharacterCreator runtime code or change those measurements.

Reference-hand lengths/vectors and closure contact lengths are metres. Pad radii
are fractions of hand length, thumb tilt is radians, opposition is degrees, and
overshoot/backoff/step are dimensionless amounts along the finger-row blend.
