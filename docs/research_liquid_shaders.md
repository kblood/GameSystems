# Research: open-source "fake liquid in a bottle" shaders and bottle breaking

Researched 2026-10-04. Sources were opened with WebFetch unless marked "unverified". Star counts, licences and pushed
dates come from the GitHub API on the same day. Read-only research; nothing in the project was changed.

## 0. TL;DR

- No open-source project does everything we do. Nothing found combines (a) a world-space fill plane, (b) a baked
  volume-preserving plane-offset LUT for arbitrary bottle shapes, (c) upside-down support, (d) a GLB asset pipeline and
  (e) both Godot 4 and three.js.
- Almost every open implementation uses the same core trick we use: a closed liquid mesh, a world-space clip plane,
  back faces rendered flat to show the surface, and a CPU damped spring tilting the plane.
- Most do NOT preserve volume, and most assume symmetric/upright bottles. Ours is ahead on this point.
- Closest relative to our design: hhldiniz/Fluidly (Godot 4.4, plane through the bottle axis; no licence).
  Closest permissively licensed Godot code: CaptainProton42/LiquidContainerDemo (MIT, Godot 3), the Lexpartizan
  shader (MIT) and its Godot 4 port Liquid-In-Mesh (CC0 label, see licence caveat).
- Best sources of ideas: Gil Damoiseaux's write-up (80.lv), Ryan Brucks' UE material, the andytech.art
  "Container Water" series. Valve internals are available only second-hand (see 3.1).
- Breaking: for three.js use three-pinata (MIT per README). For Godot, VoronoiShatter (MIT, concave, maintained) is the
  best runtime option. For bottles the best path is still pre-fractured shards authored in Blender (Cell Fracture)
  plus a swap on impact.

## 1. Existing implementations

### 1.1 Unity

| Project | URL | Licence | Technique | Notes |
|---|---|---|---|---|
| ToughNutToCrack/HalfLifeLiquid | https://github.com/ToughNutToCrack/HalfLifeLiquid | none declared (GitHub API: none) | Alyx-inspired liquid shader, full Unity project | 83 stars, last push 2020-08. Page showed no technical detail. Do not copy (no licence). |
| Gil Damoiseaux (Gaxil) bottle shader | https://80.lv/articles/simulating-liquids-in-a-bottle-with-a-shader | no code published (article gives no repo) | Single surface shader (Amplify); per-vertex spring heights in compute buffers, screen-space refraction, 3D-noise bubbles/foam scrolling up, "agitation" accumulator for foam, sticky coating variant (5 passes) | ~1.5 ms on a 2080 Ti with 50K tris. His stated limits: containers narrower at the bottom push liquid outside the geometry; below ~50% fill is simplified. Tweet: https://x.com/Gaxil/status/1267487276302577666 . |
| specoolar (Shahzod Boyhonov) | https://80.lv/articles/half-life-alyx-inspired-bottle-shader-created-with-unity | no code or licence (article links only his Twitter) | Ray marching in the shader, no liquid geometry | He calls it "far from perfect". Raymarching is expensive on mobile VR. Not downloadable. |
| aniruddhahar/URP-LiquidShadergraph | https://github.com/aniruddhahar/URP-LiquidShadergraph | MIT | Shader Graph: back faces flat colour + alpha clip above fill, Voronoi ripples and foam | 80 stars, 2020-06. Description from search summary (not opened). |
| Macoron/Unity-Simple-Liquid | https://github.com/Macoron/Unity-Simple-Liquid | MIT | Liquid surface from inertia and rotation, volume in litres from bottle size, transfer between containers | 79 stars, last push 2020-08, tested on Unity 2019.2. Volume algorithm not stated in README (unverified); read its source for volume-vs-plane. |
| Andy Green "Container Water" | https://andytech.art/container-water-00 (series 00-04) | blog; code licence unverified | HDRP Shader Graph; flattens the water mesh onto a plane (point-on-plane projection) instead of slicing, so a real surface exists; 2D heightfield sim; verts constrained to the bowl; screen-space refraction | Made for a fishbowl ("I am Fish"). Idea: flatten-to-plane keeps a watertight surface. |
| Not opened (unverified) | gist josephbk117 "Unity liquid shader"; przemyslawzaworski/Unity3D-CG-programming liquid.shader; leventeren/UnityShaders Liquid.shader | unknown | typical fill amount + wobble clip-plane shaders | |

### 1.2 Unreal / Blender / other

- Ryan Brucks, Unreal material: https://80.lv/articles/alyx-style-bottles-in-unreal-by-ryan-brucks . Motion is 3 sine
  waves driven by an FInterpTo-lagged float in Blueprint; bubbles are procedural Voronoi noise injected with the waves.
  Very cheap. No licence stated.
- Pavel Efimov "Dynamic Fake Liquid in a Bottle" UE material (2024): https://www.artstation.com/artwork/rAeqOO (not opened).
- Blender: SamHatesUnicorns used the Wiggle Bones add-on (bone jiggle):
  https://80.lv/articles/the-liquid-in-a-bottle-effect-from-half-life-alyx-made-in-blender . Offline only, not a shader.
- Leads from search, not opened (unverified): https://alectremblay.com/landshark (UE beer bottle),
  https://marginz.co.nz/max/index.php/shaders-liquid-bottles/ ,
  https://entertainmentengineers.net/?p=51653 ("Fake liquid shader simulation explained step by step"), a Fab "Liquid Shader"
  listing, and ShaderToy-style SDF bottles with Beer's-law absorption.
- No ShaderToy shader that is volume-preserving and tilt-complete was confirmed.

### 1.3 Godot

| Project | URL | Licence | Godot | Stars / last push | Technique |
|---|---|---|---|---|---|
| CaptainProton42/LiquidContainerDemo | https://github.com/CaptainProton42/LiquidContainerDemo | MIT (plus MIT OpenVR module) | 3.x, OpenVR demo | 151 / 2020-06 | 4-pass material (glass, liquid, surface, tint). Surface tilt = damped harmonic oscillator driven by mesh acceleration. Fill height uses a position rotated to world space and lerps between container width and height by orientation (an approximate volume fix, not exact). Worley-noise waves. |
| Lexpartizan/Lexpartizan_godot-bootle-shader | https://github.com/Lexpartizan/Lexpartizan_godot-bootle-shader | MIT | 3.x | 45 / 2020-06 | Builds on CaptainProton42. Author warns it works best for symmetric objects; transparency problems with cull_disable plus ALPHA/SCREEN_UV, so two material variants. |
| niceandgoodonline/Liquid-In-Mesh-Shader-Demo-Godot (also https://godotshaders.com/shader/liquid-in-mesh/) | https://github.com/niceandgoodonline/Liquid-In-Mesh-Shader-Demo-Godot | CC0-1.0 | 4.2 beta | 10 / 2023-11 | Port of Lexpartizan. Plane from physics coefficients (GDScript tracks motion), wave distortion, foam at the line, optional bubbles, glass thickness, backlighting. Renderer compatibility not stated (unverified). |
| hhldiniz/Fluidly | https://github.com/hhldiniz/Fluidly | none declared | 4.4, Compatibility/WebGL2, phones | 0 / pushed 2026-10-04 | A colour-sort puzzle game. liquid.gdshader cuts at a world-level plane through the bottle axis at the fill height ("keeps volume correct for a tilted cylinder"); a damped spring tilts the plane from acceleration/rotation. Closest to our design but cylinder-only (analytic). Brand-new repo with no licence: ideas only. |
| KingSahil/Godot-4.4-Liquid-Shader | https://github.com/KingSahil/Godot-4.4-Liquid-Shader | none shown | 4.4 | 4 / 2025-06 | Updated GDQuest stylised liquid shader. Page had no further detail. |
| Not opened | jrassa/godot-shaders; Space Milk (itch.io); YouTube "Godot Liquid Bottle Shader" | unverified | | | |

### 1.4 three.js / WebXR

- emmelleppi/r3f-cheers (https://github.com/emmelleppi/r3f-cheers ; old r3f-liquid-bottle URL redirects): R3F liquid
  shader plus glass, from a Patreon tutorial, cannon physics. No licence on the page; unverified whether the level is
  world-space. Demo-grade.
- Fluidly PR #5 (https://github.com/hhldiniz/Fluidly/pull/5) adds a 3D sloshing mode with the same plane-discard approach (from search summary).
- No maintained, reusable three.js "Alyx bottle" library was found. Our `bottle_liquid.js` fills that gap.

## 2. Techniques compared

| Technique | Who | Pros | Cons |
|---|---|---|---|
| Clip plane in world space + back-face surface | Fluidly, Lexpartizan/CaptainProton42, URP-LiquidShadergraph, ours | Very cheap; any tilt; mobile-VR fine | Volume only right if the offset is computed properly; surface needs a back-face trick |
| Offset computed analytically (cylinder/box) | Fluidly | Exact for simple shapes | Primitives only |
| Baked volume LUT (plane offset vs tilt and fill) | ours only (none found elsewhere) | Exact for any closed shape, upside down, cheap at runtime | Needs a bake step; uniform scale only |
| Heuristic (lerp width/height) | CaptainProton42 lineage | Trivial | Wrong for non-symmetric shapes, drifts |
| Vertex-spring heightfield (compute/vertex) | Damoiseaux, Andy Green | Rich slosh and normals | Geometry collapses in narrow-base bottles; needs compute/vertex data; heavy for Quest |
| Raymarched implicit surfaces (plane, bubbles as deformed spheres) | specoolar; Valve per second-hand report | Real refraction/density falloff; bubbles inside | Costly per pixel; hard on mobile VR |
| Sine waves + lagged float | Brucks | Almost free | Not physical |
| Bone jiggle | Blender Wiggle Bones | Offline | Not a realtime shader |
| Real fluid (PBD/SPH) | Scrawk/PBD-Fluid-in-Unity (MIT, 758 stars, 2022) | True behaviour | Far too heavy for VR bottles |

Capability notes
- Arbitrary tilt incl. upside down: only world-space plane designs can; exact volume needs analytic or LUT. Heuristic ones fail at large tilts.
- Non-symmetric bottles: Lexpartizan says symmetric-only; Damoiseaux fails with narrow bases; only our LUT is general.
- Bubbles/foam: Damoiseaux (scrolling 3D noise + agitation), Brucks (Voronoi), Liquid-In-Mesh (bubbles + foam line), URP-LiquidShadergraph (Voronoi foam).
- Refraction: screen-space refraction (Damoiseaux, Andy Green); cubemap/raymarch (Valve, specoolar).
- Mobile VR: plane-clip designs yes; raymarch and compute-buffer designs unlikely (not measured on device by anyone cited).

## 3. Prior art on the deeper pieces

### 3.1 Valve / Matt Wilde
- UploadVR (https://www.uploadvr.com/alyx-liquid-shaders/): verified only high-level facts: purely a shader, nothing inside the bottle,
  added in the late-May 2020 update, Wilde had started it before release. No internals on the page. The Polygon video
  "Why they look so good" was not watched.
- Second-hand technical description from a web-search summary (HN/ResetEra/tweet threads; I could NOT confirm exact wording or author on the
  pages I opened, so treat as unverified): the surface is always a flat plane in world space; its offset follows orientation and volume;
  plane state including the normal (the "jiggle") is computed on the CPU by a simple spring from object velocity; noise and ramps
  oscillate and settle; bubbles are spheres deformed by simple fields; implicit geometry is raymarched in the pixel shader giving
  refraction, density falloff and bubbles; a bubble normal map fades in at high acceleration, mapped in world space rather than UVs.
  This matches our architecture (CPU spring plus plane) except for the raymarching.
- andytech.art says the Alyx shader is "cheap enough to run in VR" (verified) but gives no internals.
- No true reverse-engineering write-up (shader dump) was found.

### 3.2 Volume vs fill plane
- No game-oriented paper found. Known methods:
  - Analytic for cylinders/spheres/boxes (Fluidly for tilted cylinders).
  - Generic: bisection on the plane offset against a volume function (clip the closed mesh by a plane, sum signed tetra volumes, or voxelise),
    baked into a LUT. This is what we do; no open-source project found shipping it.
  - Macoron/Unity-Simple-Liquid computes litres at runtime (algorithm unverified).
  - GPU readback appears in no project and is unnecessary with the LUT.
- Engineering sloshing literature (pendulum and spring-mass equivalents; Dodge, "Dynamic Behavior of Liquids in Moving Containers";
  PMC pendulum-model papers) models a flat surface plus oscillator, which justifies the spring-on-plane-normal design. Practical hint
  (my reasoning, unverified): derive the spring frequency from container width and fill, so narrow bottles slosh faster.

## 4. Bottle breaking

| Project | URL | Licence | Engine | Method | Notes |
|---|---|---|---|---|---|
| VoronoiShatter | https://github.com/robertvaradan/voronoishatter | MIT | Godot 4 (GDScript, C# adapters; version not stated) | Voronoi on convex and concave meshes (needs manifold), generates rigidbodies | 88 stars, pushed 2026-06. Authors recommend pre-shattering in editor; runtime is slow on complex meshes. |
| Godot-Destruction (the-dunk) | https://github.com/the-dunk/Godot-Destruction | MIT | Godot 4 | Plane slicing implemented; Voronoi fracture "in development"; convex only | 14 stars, 2026-01. Minimum-volume threshold avoids tiny fragments. |
| Destronoi | https://github.com/seadaemon/Destronoi | MIT | Godot 4.2 | 3D Voronoi subdivision tree, 2^n fragments, runtime | 36 stars, 2025-01. Convex only, UVs not transferred, slow beyond height 6. Poor fit for bottle necks. |
| Jummit godot-destruction-plugin | https://github.com/Jummit/godot-destruction-plugin | MIT | Godot (version unverified) | Turns a list of pre-segmented meshes into rigidbodies | 118 stars, 2024-06. Pre-fractured workflow. Not opened. |
| Godot-Glass-Break-Effect (Lord0Sanz) | https://github.com/Lord0Sanz/Godot-Glass-Break-Effect | unverified | Godot 4 | Screen/UI crack shader with refraction | UI only, not 3D shards. Not opened. |
| three-pinata (dgreenheck) | https://github.com/dgreenheck/three-pinata | MIT per README (GitHub licence field empty) | three.js | 3D and 2.5D Voronoi, impact-based fracture, plane slicing, dual material for inner faces, refracture | 437 stars, pushed 2026-05. Needs manifold meshes; 10-50 fragments recommended; geometry only, use Rapier for physics. Demo https://www.threepinata.com/ |
| nayrrod/voronoi-fracture | https://github.com/nayrrod/voronoi-fracture | MIT | three.js | 2D Voronoi extruded | 25 stars, 2017; stale. |
| Industrial-Mesh-Swap-Destruction | https://github.com/alexVirtualWorld/Industrial-Mesh-Swap-Destruction | MIT | three.js + cannon | BSP convex slicing to pre-fracture, mesh swap on break | 1 star, 2026-09; young. The pattern is the useful part. |
| Blender Cell Fracture | https://docs.blender.org/manual/en/4.1/addons/object/cell_fracture.html | bundled add-on (GPL code) | Blender | Voronoi cells | Authoring-time; outputs plain meshes we export in GLB. Availability in Blender 5.x unverified. |
| Commercial | ShardFlow, Real-Time Fracture (Gumroad) | commercial | Blender | | Ignore. |
| Reference | https://www.sidefx.com/docs/houdini/destruction/glass.html | n/a | Houdini | glass destruction docs | Crack-pattern reference (not opened). |

Trade-offs
- Pre-fractured (Cell Fracture in Blender, shards shipped in GLB, swap on impact): zero runtime cost, full look control, fine on
  Quest/WebXR; fixed fragment shapes. Recommended for bottles.
- Runtime Voronoi: impact-aware, but needs watertight input, cost grows with mesh complexity, inner-face materials/UVs need
  care, and a bottle neck is concave and hard.
- Glass patterns: real glass cracks radially from the impact with concentric hoop cracks; seed Voronoi points densely near the impact
  and sparsely away, cells elongated radially (three-pinata's impact mode does the dense-near-hit part).
- Energy/thresholds: no game-ready energy model found (one search snippet gives soda-lime fracture energy ~4.3 J/m^2, unverified). Practical
  suggestion (mine): an impulse/relative-velocity threshold tuned by feel, scaled by thickness and mass.
- When a bottle breaks, the liquid needs its own handoff (spill particles/decal, disable the liquid shader). No open reference found.

## 5. Comparison with our approach

| Solution | Licence | Engine | Technique | Tilt/upside-down | Volume-preserving | Bubbles/foam | Mobile-VR-ready | Maintained? |
|---|---|---|---|---|---|---|---|---|
| Ours (BlenderShared) | ours | Godot 4 + three.js | World plane, baked LUT, spring slosh, parallax bubbles | Yes | Yes, any closed shape | Yes (procedural) | Yes by design (not measured here) | Yes |
| Fluidly | none | Godot 4.4 | World plane, analytic cylinder, spring | Yes (cylinder) | Cylinders only | Unverified | Yes (targets phones/WebGL2) | New (2026-10) |
| CaptainProton42 | MIT | Godot 3 | Plane + oscillator + lerp heuristic | Partly | No (heuristic) | Worley waves | Unverified | No (2020) |
| Lexpartizan | MIT | Godot 3 | Same lineage | Partly | No | Foam/waves | Unverified | No (2020) |
| Liquid-In-Mesh | CC0 label | Godot 4.2 | Same lineage | Partly | No (heuristic) | Yes | Unverified | Barely (2023) |
| Damoiseaux | no code | Unity | Vertex springs + screen refraction | Limited | Approximate | Yes, good | No (compute, heavy) | n/a |
| specoolar | no code | Unity | Raymarch | Yes | Unverified | Unverified | Unlikely | n/a |
| Brucks | no code | Unreal | Sine waves + Voronoi | Limited | No | Yes | Cheap | n/a |
| Macoron Simple-Liquid | MIT | Unity | Inertia plane + litres | Yes | Stated, method unverified | No | Unverified | No (2020) |
| URP-LiquidShadergraph | MIT | Unity URP | Back face + clip | Partly | No | Voronoi foam | Likely | No (2020) |
| HalfLifeLiquid | none | Unity | Unverified | Unverified | Unverified | Unverified | Unverified | No (2020) |
| r3f-cheers | none | three.js/R3F | Liquid + glass shader | Unverified | Unverified | Unverified | No | Unclear |

## 6. Recommendation

Adopt / keep
- Keep our own liquid shader and LUT; nothing open-source beats it on correctness or shape generality. No dependency needed.
- three.js breaking: adopt three-pinata (MIT per README; check its LICENSE file before bundling) or borrow its impact-weighted Voronoi idea, with Rapier for physics.
- Godot breaking: pre-fractured shards from Blender Cell Fracture as default; optionally VoronoiShatter (MIT) for editor or runtime
  generation. Skip Destronoi (convex only) and Godot-Destruction (fracture unfinished).

Borrow (ideas, re-implemented by us)
- Damoiseaux: foam from an "agitation" accumulator (shake adds, decays); bubbles as 3D noise scrolling upward; sticky-coating variant for syrup; multi-sample screen refraction.
- Andy Green: flatten the closed mesh onto the plane so there is a real surface mesh (better normals/lighting, avoids the cull_disable transparency trouble Lexpartizan hit).
- Brucks: 2-3 sines on a lagged driver as a cheap secondary ripple; bubbles injected with the same driver.
- Valve (second-hand): fade in a bubble normal map under high acceleration; world-space mapping so bubbles do not swim with the bottle.
- Liquid-In-Mesh: glass-thickness and backlight terms; foam ring at the liquid line (meniscus-like).
- Sloshing literature: spring frequency from container width and fill; optional second mode.

What we may be missing
- Background refraction through the liquid: offset a screen/cubemap sample by normal and thickness. On Quest prefer a cubemap/probe or one low-res sample to save fill rate.
- Meniscus/edge brightening at the wall, Fresnel rim, absorption by path length (Beer's law approximated from back-face depth).
- Caustic hint on the base (animated noise); optional and cheap.
- Reaction to breaking, pouring and level drop; no open reference exists.
- Upside-down edge case: air pocket visible at the neck; check LUT near cos_tilt = -1 for narrow necks.

Ignore
- Raymarching on Quest-class hardware, compute-buffer vertex springs, SPH/PBD (Scrawk), Wiggle Bones (offline).

Licensing caveats
- Safe to read/reuse under MIT: CaptainProton42, Lexpartizan, URP-LiquidShadergraph, Macoron, the Godot destruction repos, three-pinata (per README).
- No licence means all rights reserved: Fluidly, HalfLifeLiquid, r3f-cheers, KingSahil. Ideas only; do not copy code.
- Liquid-In-Mesh is labelled CC0 but derives from MIT-licensed Lexpartizan/CaptainProton42 code, so the CC0 label may not remove the
  upstream MIT attribution duty. Keep MIT notices if we ever copy from it.
- Blender Cell Fracture is GPL add-on code; shards it produces are our own data (not legal advice).
- Blog and 80.lv write-ups carry no code licence; paraphrase only.

## 7. Verification log
- Opened and read: the 80.lv articles cited, UploadVR, andytech.art posts 00 and 04, GitHub pages for HalfLifeLiquid, LiquidContainerDemo,
  Lexpartizan, Liquid-In-Mesh (and its Godot Shaders listing), Fluidly, KingSahil, r3f-cheers, Macoron, VoronoiShatter, Godot-Destruction,
  Destronoi, three-pinata. Stars/licence/pushed dates came from the GitHub API.
- Not opened or unverified: Polygon/GDC video content, HN/ResetEra quotes from Valve staff, URP-LiquidShadergraph internals, Pavel Efimov,
  alectremblay, marginz, entertainmentengineers, Jummit repo details, Lord0Sanz licence, renderer compatibility of the Godot 4 shaders,
  Blender 5.x Cell Fracture availability. The 80.lv Damoiseaux article mentions a GameDev Stack Exchange breakdown that I did not find.
- Our own shader sources were not re-read beyond README.md, so statements about "ours" rely on that README.
