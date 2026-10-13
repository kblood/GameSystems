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

`held_drive.data.json` preserves all six public scalar constants from GameSystems
`extensions/grasp/held_drive.js` (MIT), whose module header identifies its origin as
a port of the Godot held-drive implementation. No force or sampling algorithm is
copied into the Godot data reader. Spring stiffness is acceleration-normalized
(`s^-2`), damping is `s^-1`, acceleration is `m/s^2`, torque is `N m`, force is `N`,
and the motion window is a whole-number sample count.

`catalog.data.json` preserves `DEFAULT_MASS` and the mutable `CATALOG` records from
GameSystems `extensions/grasp/catalog.js`, a web port of the Godot grasp-catalog rows.
The bottle profiles were measured offline from GameSystems beer/wine bottle GLB
glass silhouettes (MIT, Kasper Olesen), as documented in the original module header.
All catalog records and this extraction remain under the repository's MIT licence.
Geometry uses item-local metres with +Y up, masses are kilograms, and color fields
are numeric 24-bit RGB values. The JSON contains no executable SDF or mesh algorithm.
