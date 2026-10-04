"""Bottle family "v2" specs (pure data, no bpy). Built by scripts/bottles_v2.py, documented in docs/bottle_design_review.md.

UNITS: all lengths in this file are MILLIMETRES (readability); `get_spec(name)` returns the same dict with every length
converted to metres (UNIT = 1e-3), which is what the builder and other tools (fracture, labels) should consume.
Axis: +Z up in Blender (+Y in glTF), base resting plane z = 0, axis through the origin.

Per-bottle keys (superset of scripts/bottles.py BOTTLES):
  outer      list of knots from the top of the heel to the outer edge of the lip:
               (r, z) smooth Catmull-Rom knot | (r, z, "c") sharp corner | "section" string = section tag for the
               following knots (body, shoulder, neck, finish ...). The "finish" section must be last; the last knot is
               the outer lip edge, the lip top is z_last + lip.round_o.
  base       dict(type=punt|pushup|petaloid|none, depth, r_rest, heel) -> knots from the axis to the heel are generated.
  lip        dict(r_bore, round_o, round_i): lip top rounding and the straight bore inside the "finish" section.
  wall       thickness (mm, along the surface normal) per section, blended with a gaussian of width `blend` along the
             profile: this replaces v1 `wall` (constant horizontal offset). The sampled `inner` profile is exported in
             the Glass node extras (`bv2_profile`) and in export/v2/bottle_<name>.profile.json.
  glass      key into GLASS (tint/ior/roughness/attenuation); `glass_options` lists sensible colour variants
             (build one with `blender -b --python bottles_v2.py -- name:variant`).
  liquid     RGBA colour of the contents, carbonation/foam/foam_height/bubble_size as in v1 extras.
  closure_depth  the Liquid volume ends this far below the lip top (cork length / liner), fill 1.0 = brim to closure.
  cap        dict(type=..., ...) closure (see CAP TYPES below). Extra nodes: Bail (swing-top wire), Cage (champagne
             muselet), Stand (cork ring); a glass stopper is named GlassCap (so the Godot helper overrides it as glass).
  features   list of dicts, procedural detail (see FEATURE TYPES). `geo` = tiers that build it as geometry
             (0 = HIGH, 1 = MEDIUM, 2 = LOW); tiers not listed fall back to the normal map when `nm` is True.
  wobble     dict(oval, lean, noise) mm, seeded per bottle name (deterministic). Glass, liquid and caps share the field.
  seg        radial segments per tier (HIGH, MEDIUM, LOW).
  label_zone (z0, z1) suggested label band on the body (smooth, no ribs/seams relief) for the label/designer agent;
  label_panel  True when the band is a recessed panel (PET, contour) - label should sit at r - depth.

FEATURE TYPES
  band     z, half, ramp, depth (+out/-in), inner (0..1 how much the inner wall follows; PET = 1)
  panel    z0, z1, ramp, depth (<0 = recess), inner
  ribs     n, depth, z0, z1, ramp, duty (0..1 rib width), mask [(centre_deg, half_deg)...] or None, inner, geo, nm
  petaloid n, depth, r0, r1 (fractions of body radius), zmax, inner, geo
  thread   pitch, height, z0, z1, starts, geo, nm (helical, on the outer finish only)
  spout    theta (deg), width (deg), out, zone (mm below lip top)
  seams    nm only: two mould seams at 0/180 deg from heel to lip (skipped on hand-made shapes)
  stipple  nm only: knurled anti-scuff band, z0, z1
  grad     nm only: graduation ridges every `step` ml from `first` to `last`, major every `major` ml, at theta `theta`
  waviness nm only: low-frequency glass waviness amplitude (mm)

CAP TYPES (all lathe based unless noted)
  foil     capsule hugging the finish from z0 up, colour, metal, rough
  wax      dipped wax capsule with seeded drips at the lower edge, colour
  crown    26 mm crown cork, 21 flutes (geometry at HIGH, normal map at MEDIUM), paint colour
  screw    plastic screw cap (knurl normal map) + tamper band, colour, r, h, z0
  ropp     long aluminium roll-on cap (spirits), colour, r, h, z0
  tcork    bar-top T-cork: head (wood/plastic) + cork shank in the bore (visible through glass)
  champagne foil over a mushroom cork + wire cage node `Cage`
  swing    ceramic stopper + rubber gasket + wire bail node `Bail`
  milkfoil pleated aluminium foil cap pressed over the bead
  mason    two-piece lid: flat lid disc + threaded screw band (one node, 2 materials)
  perfume  heavy overcap (cylinder) on a small neck
  stopper  glass ball stopper (node GlassCap)
  pourer   cork + stainless pour spout
  cork     plain tapered cork (lab / apothecary), protrude
"""
import copy

UNIT = 1e-3

# Glass palette. tint = baseColor (what v1 engines + the Godot override use), atten = KHR_materials_volume colour,
# dist = attenuation distance (m). PET is a polymer (ior 1.57) but rendered the same way.
GLASS = {
    "flint":     dict(tint=(0.93, 0.97, 0.96, 1), atten=(0.86, 0.95, 0.92), dist=0.20, ior=1.52, rough=0.015),
    "flint_hi":  dict(tint=(0.97, 0.985, 0.98, 1), atten=(0.94, 0.98, 0.97), dist=0.40, ior=1.52, rough=0.01),
    "green":     dict(tint=(0.10, 0.32, 0.12, 1), atten=(0.16, 0.45, 0.14), dist=0.012, ior=1.52, rough=0.02),
    "deadleaf":  dict(tint=(0.36, 0.40, 0.12, 1), atten=(0.45, 0.48, 0.12), dist=0.014, ior=1.52, rough=0.02),
    "champagne": dict(tint=(0.07, 0.15, 0.06, 1), atten=(0.10, 0.22, 0.06), dist=0.008, ior=1.52, rough=0.025),
    "amber":     dict(tint=(0.42, 0.20, 0.04, 1), atten=(0.55, 0.26, 0.04), dist=0.010, ior=1.52, rough=0.02),
    "brown":     dict(tint=(0.24, 0.11, 0.025, 1), atten=(0.36, 0.15, 0.02), dist=0.007, ior=1.52, rough=0.02),
    "blue":      dict(tint=(0.45, 0.70, 0.88, 1), atten=(0.45, 0.70, 0.90), dist=0.02, ior=1.52, rough=0.02),
    "cobalt":    dict(tint=(0.06, 0.12, 0.55, 1), atten=(0.08, 0.16, 0.65), dist=0.006, ior=1.52, rough=0.02),
    "aqua":      dict(tint=(0.70, 0.88, 0.84, 1), atten=(0.70, 0.90, 0.84), dist=0.03, ior=1.52, rough=0.02),
    "pet_clear": dict(tint=(0.95, 0.98, 0.99, 1), atten=(0.93, 0.97, 0.99), dist=0.5, ior=1.57, rough=0.03),
    "pet_green": dict(tint=(0.55, 0.85, 0.62, 1), atten=(0.55, 0.85, 0.62), dist=0.05, ior=1.57, rough=0.03),
    "borosilicate": dict(tint=(0.95, 0.98, 0.985, 1), atten=(0.94, 0.98, 0.985), dist=0.6, ior=1.47, rough=0.01),
}

TIER_NAMES = ("high", "medium", "low")

SPECS = {
    # ------------------------------------------------------------------------------------------------- wine
    "bordeaux": dict(
        desc="Bordeaux 750 ml: straight body, high rounded shoulder, cork + foil capsule, punt",
        family="wine", ref_ml=750,
        base=dict(type="punt", depth=24, r_rest=31.0, heel=7.0),
        outer=["body", (37.5, 14), (37.6, 110), (37.5, 196),
               "shoulder", (37.0, 203), (34.6, 212), (29.5, 220), (23.0, 227), (18.0, 233),
               "neck", (15.6, 240), (14.7, 250), (14.35, 268), (14.3, 284),
               "finish", (14.5, 286.0), (15.2, 287.2), (15.3, 290.0), (15.3, 298.8)],
        lip=dict(r_bore=9.3, round_o=1.2, round_i=0.8),
        wall=dict(base=7.0, heel=4.6, body=3.0, shoulder=2.6, neck=3.0, finish=3.5, blend=5.0),
        glass="green", glass_options=["green", "deadleaf", "flint", "amber"],
        liquid=(0.30, 0.015, 0.05, 1.0), foam=0.1, foam_height=0.006,
        closure_depth=46,
        cap=dict(type="foil", z0=250, color=(0.32, 0.02, 0.045, 1), metal=0.55, rough=0.38),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=8), dict(type="waviness", amp=0.012)],
        wobble=dict(oval=0.12, lean=0.35, noise=0.03), seg=(48, 32, 16), label_zone=(60, 170)),

    "burgundy": dict(
        desc="Burgundy 750 ml: wider body, long sloping S-shoulder, wax-dipped top",
        family="wine", ref_ml=750,
        base=dict(type="punt", depth=20, r_rest=33.5, heel=7.5),
        outer=["body", (40.2, 14), (40.3, 80), (40.1, 118),
               "shoulder", (39.4, 132), (37.0, 150), (32.8, 170), (27.4, 191), (22.0, 210), (18.0, 226),
               "neck", (15.8, 240), (14.8, 255), (14.5, 272), (14.45, 284),
               "finish", (14.7, 286.0), (15.3, 287.2), (15.4, 290.0), (15.4, 294.8)],
        lip=dict(r_bore=9.3, round_o=1.2, round_i=0.8),
        wall=dict(base=6.5, heel=4.5, body=3.0, shoulder=2.7, neck=3.0, finish=3.5, blend=6.0),
        glass="deadleaf", glass_options=["deadleaf", "green", "amber"],
        liquid=(0.42, 0.04, 0.07, 1.0), foam=0.1, foam_height=0.006,
        closure_depth=46,
        cap=dict(type="wax", z0=262, color=(0.38, 0.03, 0.04, 1), thick=1.2, drips=7),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=8), dict(type="waviness", amp=0.015)],
        wobble=dict(oval=0.15, lean=0.4, noise=0.035), seg=(48, 32, 16), label_zone=(40, 120)),

    "champagne": dict(
        desc="Champagne/sparkling 750 ml: thick glass, deep punt, bague lip, foil over mushroom cork + wire cage",
        family="wine", ref_ml=750,
        base=dict(type="punt", depth=34, r_rest=34.5, heel=9.0),
        outer=["body", (43.0, 16), (43.2, 90), (43.0, 140),
               "shoulder", (42.4, 151), (40.4, 168), (36.2, 190), (30.8, 210), (25.4, 228), (20.6, 245),
               "neck", (17.6, 257), (16.4, 268), (16.0, 280), (16.0, 287),
               "finish", (16.3, 288.5), (17.4, 289.6), (17.6, 292), (16.8, 293.6), (16.9, 296), (16.9, 298.8)],
        lip=dict(r_bore=8.9, round_o=1.2, round_i=1.0),
        wall=dict(base=11.0, heel=7.0, body=4.4, shoulder=4.0, neck=4.2, finish=5.0, blend=6.0),
        glass="champagne", glass_options=["champagne", "green", "flint"],
        liquid=(0.88, 0.80, 0.42, 1.0), carbonation=0.85, foam=0.6, foam_height=0.012, bubble_size=0.6,
        closure_depth=26,
        cap=dict(type="champagne", z0=212, color=(0.75, 0.60, 0.22, 1), metal=0.9, rough=0.28, dome=17.0),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=10)],
        wobble=dict(oval=0.12, lean=0.3, noise=0.03), seg=(48, 32, 16), label_zone=(55, 140)),

    # ------------------------------------------------------------------------------------------------- beer
    "longneck": dict(
        desc="Longneck beer 355 ml: slim body, slight neck bulge, 26 mm crown finish with transfer bead",
        family="beer", ref_ml=355,
        base=dict(type="pushup", depth=4.0, r_rest=25.0, heel=6.0),
        outer=["body", (30.9, 10), (31.0, 70), (30.9, 116),
               "shoulder", (30.5, 122), (28.9, 132), (25.3, 144), (20.8, 156), (17.2, 167),
               "neck", (15.3, 178), (14.75, 190), (14.85, 200), (14.3, 210), (13.0, 219), (12.1, 225),
               "finish", (12.0, 227.5), (12.6, 229.0), (12.7, 231.0), (12.15, 232.5), (12.4, 234.0), (13.2, 235.5),
               (13.25, 237.9)],
        lip=dict(r_bore=8.4, round_o=1.5, round_i=0.9),
        wall=dict(base=4.5, heel=3.4, body=2.4, shoulder=2.1, neck=2.4, finish=3.0, blend=4.0),
        glass="amber", glass_options=["amber", "brown", "green", "flint"],
        liquid=(0.85, 0.52, 0.06, 1.0), carbonation=0.45, foam=1.0, foam_height=0.026,
        closure_depth=4,
        cap=dict(type="crown", color=(0.42, 0.015, 0.012, 1), metal=0.6, rough=0.3),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=9),
                  dict(type="band", z=116, half=0.3, ramp=1.0, depth=0.35, inner=0)],
        wobble=dict(oval=0.1, lean=0.3, noise=0.03), seg=(48, 32, 16), label_zone=(35, 105)),

    "stubby": dict(
        desc="Stubby/steinie beer 330 ml: short wide body, short neck, crown",
        family="beer", ref_ml=330,
        base=dict(type="pushup", depth=4.0, r_rest=27.5, heel=7.0),
        outer=["body", (33.4, 11), (33.6, 60), (33.5, 90),
               "shoulder", (33.0, 98), (31.0, 109), (26.8, 122), (21.4, 134), (17.0, 145),
               "neck", (14.6, 155), (13.4, 163), (12.4, 170),
               "finish", (12.2, 172), (12.7, 173.5), (12.8, 175.5), (12.2, 177.0), (12.4, 178.6), (13.2, 180.1),
               (13.25, 182.4)],
        lip=dict(r_bore=8.4, round_o=1.5, round_i=0.9),
        wall=dict(base=5.0, heel=3.8, body=2.8, shoulder=2.5, neck=2.6, finish=3.0, blend=4.0),
        glass="brown", glass_options=["brown", "amber", "green"],
        liquid=(0.62, 0.32, 0.05, 1.0), carbonation=0.45, foam=1.0, foam_height=0.024,
        closure_depth=4,
        cap=dict(type="crown", color=(0.80, 0.68, 0.25, 1), metal=0.85, rough=0.25),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=10),
                  dict(type="band", z=95, half=0.4, ramp=1.0, depth=0.4, inner=0),
                  dict(type="band", z=14, half=0.4, ramp=1.0, depth=0.4, inner=0)],
        wobble=dict(oval=0.12, lean=0.25, noise=0.03), seg=(48, 32, 16), label_zone=(22, 88)),

    "growler": dict(
        desc="Craft 'grumbler' jug 1 L, brown glass, broad round shoulder, 38 mm screw finish, metal cap",
        family="beer", ref_ml=1000,
        base=dict(type="pushup", depth=5.0, r_rest=43.0, heel=10.0),
        outer=["body", (50.0, 16), (50.2, 70), (50.0, 112),
               "shoulder", (49.2, 124), (46.2, 140), (41.2, 154), (35.2, 166), (28.0, 175), (23.5, 181),
               "neck", (21.2, 187), (20.6, 194),
               "finish", (20.6, 196), (22.6, 197.5, "c"), (22.6, 199.0), (20.4, 199.5, "c"), (19.6, 200.5),
               (19.6, 211.0), (19.7, 213.8)],
        lip=dict(r_bore=15.2, round_o=1.2, round_i=1.0),
        wall=dict(base=6.0, heel=4.5, body=3.4, shoulder=3.0, neck=3.4, finish=3.6, blend=6.0),
        glass="brown", glass_options=["brown", "amber", "flint"],
        liquid=(0.45, 0.20, 0.04, 1.0), carbonation=0.35, foam=0.8, foam_height=0.02,
        closure_depth=3,
        cap=dict(type="ropp", r=21.6, h=17.0, z0=200.2, color=(0.08, 0.08, 0.09, 1), metal=0.6, rough=0.35),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=12),
                  dict(type="thread", pitch=3.2, height=1.0, z0=202.0, z1=210.5, starts=1, geo=(), nm=True)],
        wobble=dict(oval=0.15, lean=0.35, noise=0.04), seg=(56, 36, 16), label_zone=(30, 105)),

    # ------------------------------------------------------------------------------------------------- soda
    "pet500": dict(
        desc="PET soda 500 ml: petaloid 5-foot base, grip rings, label panel, PCO 28 mm neck with support flange",
        family="soda", ref_ml=500,
        base=dict(type="petaloid", depth=4.5),
        outer=["body", (33.0, 22), (33.0, 40), (33.0, 68), (32.8, 120),
               "shoulder", (32.2, 130), (29.6, 146), (24.8, 160), (19.2, 170), (15.4, 177),
               "neck", (13.6, 181), (13.4, 184.0),
               "finish", (16.6, 184.6, "c"), (16.6, 185.6), (13.4, 186.2, "c"), (13.2, 187.0), (13.6, 188.0),
               (13.6, 190.5), (12.6, 191.2, "c"), (12.6, 199.6)],
        lip=dict(r_bore=10.85, round_o=0.4, round_i=0.4),
        wall=dict(base=0.9, heel=0.55, body=0.45, shoulder=0.5, neck=0.9, finish=1.6, blend=4.0),
        glass="pet_clear", glass_options=["pet_clear", "pet_green", "blue"],
        liquid=(0.13, 0.05, 0.02, 1.0), carbonation=0.7, foam=0.7, foam_height=0.014, bubble_size=0.8,
        closure_depth=3,
        cap=dict(type="screw", r=15.0, h=15.5, z0=187.0, color=(0.50, 0.012, 0.010, 1), rough=0.35, band=True),
        features=[dict(type="petaloid", n=5, depth=6.0, r0=0.10, r1=1.0, zmax=24, inner=1.0, geo=(0, 1, 2)),
                  dict(type="band", z=40.5, half=0.6, ramp=1.4, depth=-1.4, inner=1.0),
                  dict(type="band", z=124.5, half=0.6, ramp=1.4, depth=-1.4, inner=1.0),
                  dict(type="band", z=102, half=0.5, ramp=1.6, depth=-1.0, inner=1.0),
                  dict(type="thread", pitch=2.7, height=1.0, z0=192.0, z1=198.4, starts=2, geo=(), nm=True)],
        wobble=dict(oval=0.08, lean=0.15, noise=0.02), seg=(50, 40, 20), label_zone=(45, 88), label_panel=True),

    "pet2l": dict(
        desc="PET soda 2 L: tall petaloid bottle, recessed label panel, fluted shoulder",
        family="soda", ref_ml=2000,
        base=dict(type="petaloid", depth=6.0),
        outer=["body", (52.0, 30), (52.1, 60), (52.1, 200), (51.9, 236),
               "shoulder", (51.1, 246), (47.7, 262), (41.2, 278), (32.4, 291), (23.6, 300), (17.4, 306),
               "neck", (14.2, 310), (13.5, 313.0),
               "finish", (16.8, 313.6, "c"), (16.8, 314.8), (13.4, 315.4, "c"), (13.2, 316.2), (13.6, 317.2),
               (13.6, 319.7), (12.6, 320.4, "c"), (12.6, 328.8)],
        lip=dict(r_bore=10.85, round_o=0.4, round_i=0.4),
        wall=dict(base=1.0, heel=0.6, body=0.45, shoulder=0.5, neck=1.0, finish=1.6, blend=5.0),
        glass="pet_green", glass_options=["pet_clear", "pet_green"],
        liquid=(0.82, 0.88, 0.62, 1.0), carbonation=0.75, foam=0.6, foam_height=0.014, bubble_size=0.8,
        closure_depth=3,
        cap=dict(type="screw", r=15.0, h=15.5, z0=316.2, color=(0.10, 0.45, 0.15, 1), rough=0.35, band=True),
        features=[dict(type="petaloid", n=5, depth=9.0, r0=0.10, r1=1.0, zmax=34, inner=1.0, geo=(0, 1, 2)),
                  dict(type="band", z=66, half=0.8, ramp=1.8, depth=-1.6, inner=1.0),
                  dict(type="band", z=200, half=0.8, ramp=1.8, depth=-1.6, inner=1.0),
                  dict(type="panel", z0=72, z1=194, ramp=2.0, depth=-0.8, inner=1.0),
                  dict(type="ribs", n=10, depth=-1.6, z0=250, z1=284, ramp=8, duty=0.35, mask=None, inner=1.0,
                       geo=(0, 1), nm=True),
                  dict(type="thread", pitch=2.7, height=1.0, z0=321.0, z1=327.6, starts=2, geo=(), nm=True)],
        wobble=dict(oval=0.12, lean=0.2, noise=0.03), seg=(50, 40, 20), label_zone=(74, 192), label_panel=True),

    "contour": dict(
        desc="Generic contour-style soda glass 330 ml (original shape): waisted body, vertical flutes, smooth panel",
        family="soda", ref_ml=330,
        base=dict(type="pushup", depth=3.5, r_rest=22.0, heel=7.5),
        outer=["body", (28.4, 10), (29.8, 28), (29.3, 48), (27.2, 70), (26.4, 88), (27.6, 106), (30.4, 124),
               (31.0, 134),
               "shoulder", (30.4, 143), (27.8, 154), (23.4, 166), (18.6, 179), (15.4, 192),
               "neck", (14.0, 203), (13.5, 212), (12.5, 219),
               "finish", (12.2, 221), (12.7, 222.5), (12.8, 224.5), (12.2, 226.0), (12.4, 227.6), (13.2, 229.1),
               (13.25, 231.4)],
        lip=dict(r_bore=8.4, round_o=1.5, round_i=0.9),
        wall=dict(base=5.0, heel=3.8, body=2.8, shoulder=2.6, neck=2.8, finish=3.0, blend=5.0),
        glass="aqua", glass_options=["aqua", "flint", "green"],
        liquid=(0.16, 0.06, 0.025, 1.0), carbonation=0.7, foam=0.7, foam_height=0.014, bubble_size=0.8,
        closure_depth=4,
        cap=dict(type="crown", color=(0.40, 0.012, 0.010, 1), metal=0.6, rough=0.3),
        features=[dict(type="ribs", n=14, depth=0.9, z0=12, z1=64, ramp=8, duty=0.42, mask=None, inner=0.0,
                       geo=(0,), nm=True),
                  dict(type="ribs", n=14, depth=0.9, z0=112, z1=150, ramp=10, duty=0.42, mask=None, inner=0.0,
                       geo=(0,), nm=True),
                  dict(type="panel", z0=72, z1=104, ramp=2.5, depth=-0.4, inner=0.0),
                  dict(type="seams"), dict(type="stipple", z0=1, z1=7)],
        wobble=dict(oval=0.1, lean=0.25, noise=0.03), seg=(56, 32, 16), label_zone=(72, 104), label_panel=True),

    # ------------------------------------------------------------------------------------------------- spirits
    "whisky": dict(
        desc="Round whisky 700 ml: tall straight body, compact round shoulder, short neck, heavy base, bar-top cork",
        family="spirit", ref_ml=700,
        base=dict(type="pushup", depth=4.0, r_rest=31.5, heel=6.5),
        outer=["body", (37.8, 10), (38.0, 100), (37.9, 182),
               "shoulder", (37.2, 192), (34.9, 203), (30.8, 213), (24.6, 221), (19.6, 227),
               "neck", (17.2, 233), (16.6, 241), (16.6, 251),
               "finish", (17.2, 252.5), (18.2, 254.0), (18.3, 262.0)],
        lip=dict(r_bore=9.4, round_o=1.6, round_i=1.0),
        wall=dict(base=13.0, heel=6.5, body=3.6, shoulder=3.3, neck=3.8, finish=4.0, blend=6.0),
        glass="flint", glass_options=["flint", "flint_hi", "green", "amber"],
        liquid=(0.62, 0.30, 0.04, 1.0), foam=0.08, foam_height=0.005,
        closure_depth=24,
        cap=dict(type="tcork", head_r=19.5, head_h=13.0, color=(0.18, 0.10, 0.05, 1), rough=0.45),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=7)],
        wobble=dict(oval=0.1, lean=0.25, noise=0.03), seg=(48, 32, 16), label_zone=(45, 165)),

    "spirit": dict(
        desc="Tall vodka/gin 700 ml: clear heavy base, tall straight body, short shoulder, long neck, ROPP cap",
        family="spirit", ref_ml=700,
        base=dict(type="pushup", depth=3.0, r_rest=30.0, heel=5.0),
        outer=["body", (35.9, 8), (36.0, 120), (35.9, 214),
               "shoulder", (35.2, 222), (32.0, 231), (25.5, 239), (19.0, 245), (15.6, 250),
               "neck", (14.6, 256), (14.3, 275), (14.3, 288),
               "finish", (15.6, 289.0, "c"), (15.6, 291.0), (14.2, 291.6, "c"), (14.0, 292.4), (14.0, 318.5)],
        lip=dict(r_bore=9.2, round_o=1.0, round_i=0.8),
        wall=dict(base=16.0, heel=7.0, body=3.4, shoulder=3.2, neck=3.4, finish=3.8, blend=7.0),
        glass="flint_hi", glass_options=["flint_hi", "blue", "green"],
        liquid=(0.92, 0.95, 0.96, 1.0), foam=0.05, foam_height=0.004,
        closure_depth=6,
        cap=dict(type="ropp", r=15.0, h=31.0, z0=292.0, color=(0.72, 0.72, 0.74, 1), metal=1.0, rough=0.25),
        features=[dict(type="seams"),
                  dict(type="thread", pitch=3.4, height=1.0, z0=304, z1=314, starts=1, geo=(), nm=True)],
        wobble=dict(oval=0.08, lean=0.25, noise=0.02), seg=(48, 32, 16), label_zone=(40, 200)),

    "swingtop": dict(
        desc="Swing-top beer 450 ml (original design): soft shoulders, wire bail + ceramic stopper",
        family="beer", ref_ml=450,
        base=dict(type="pushup", depth=4.5, r_rest=28.0, heel=7.0),
        outer=["body", (34.0, 11), (34.2, 70), (34.0, 128),
               "shoulder", (33.4, 138), (31.2, 152), (26.9, 167), (22.0, 181), (18.4, 193),
               "neck", (16.4, 203), (15.6, 211), (15.4, 214),
               "finish", (15.6, 215.0), (17.0, 216.3), (17.0, 218.4), (15.6, 219.6), (15.4, 222.0), (16.2, 224.5),
               (16.4, 230.6)],
        lip=dict(r_bore=10.2, round_o=1.6, round_i=1.2),
        wall=dict(base=5.5, heel=4.0, body=3.0, shoulder=2.8, neck=3.2, finish=4.0, blend=5.0),
        glass="green", glass_options=["green", "brown", "flint"],
        liquid=(0.80, 0.55, 0.10, 1.0), carbonation=0.45, foam=1.0, foam_height=0.024,
        closure_depth=6,
        cap=dict(type="swing", color=(0.94, 0.93, 0.90, 1), gasket=(0.78, 0.18, 0.08, 1), wire=(0.7, 0.7, 0.72, 1)),
        features=[dict(type="seams"), dict(type="stipple", z0=2, z1=9)],
        wobble=dict(oval=0.12, lean=0.3, noise=0.03), seg=(48, 32, 16), label_zone=(28, 120)),

    # ------------------------------------------------------------------------------------------------- small / special
    "apothecary": dict(
        desc="Ribbed apothecary/poison bottle 100 ml, cobalt: Boston-round body, ribs on the sides, smooth front/back",
        family="medicine", ref_ml=100,
        base=dict(type="pushup", depth=2.0, r_rest=18.0, heel=4.0),
        outer=["body", (23.0, 6), (23.1, 40), (23.0, 66),
               "shoulder", (22.3, 74), (20.0, 82), (15.8, 89), (11.6, 94),
               "neck", (10.2, 97), (9.9, 103),
               "finish", (10.0, 104.0), (11.0, 105.2), (11.0, 110.6)],
        lip=dict(r_bore=6.6, round_o=1.2, round_i=0.7),
        wall=dict(base=4.0, heel=3.0, body=2.2, shoulder=2.0, neck=2.4, finish=2.8, blend=3.0),
        glass="cobalt", glass_options=["cobalt", "amber", "green", "flint"],
        liquid=(0.85, 0.85, 0.75, 1.0), foam=0.05, foam_height=0.003,
        closure_depth=14,
        cap=dict(type="cork", r_top=7.4, r_bot=6.4, length=18, protrude=6),
        features=[dict(type="ribs", n=36, depth=0.7, z0=10, z1=62, ramp=4, duty=0.45,
                       mask=[(0, 50), (180, 50)], inner=0.0, geo=(0,), nm=True),
                  dict(type="seams")],
        wobble=dict(oval=0.1, lean=0.2, noise=0.02), seg=(72, 36, 14), label_zone=(15, 60)),

    "perfume": dict(
        desc="Perfume 50 ml: very thick base and walls, chamfered shoulder, small screw neck, heavy overcap",
        family="cosmetic", ref_ml=50,
        base=dict(type="pushup", depth=1.0, r_rest=24.0, heel=3.0),
        outer=["body", (28.0, 4), (28.0, 52),
               "shoulder", (27.4, 56), (25.0, 60), (20.0, 63.0), (12.0, 64.6),
               "neck", (8.6, 65.5), (7.9, 67), (7.8, 69),
               "finish", (8.4, 70.0, "c"), (8.4, 71.0), (7.8, 71.4, "c"), (7.8, 77.4)],
        lip=dict(r_bore=3.6, round_o=0.6, round_i=0.5),
        wall=dict(base=17.0, heel=9.0, body=6.0, shoulder=6.0, neck=3.8, finish=4.0, blend=3.0),
        glass="flint_hi", glass_options=["flint_hi", "blue", "aqua"],
        liquid=(0.95, 0.80, 0.84, 1.0), foam=0.0, foam_height=0.002,
        closure_depth=4,
        cap=dict(type="perfume", r=13.0, h=26.0, z0=66.5, color=(0.05, 0.05, 0.06, 1), metal=0.2, rough=0.12),
        features=[],
        wobble=dict(oval=0.0, lean=0.05, noise=0.0), seg=(48, 32, 16), label_zone=(20, 45)),

    "milk": dict(
        desc="Retro milk bottle 1 pint (568 ml): tapered upper body, wide mouth bead, pleated foil cap",
        family="dairy", ref_ml=568,
        base=dict(type="pushup", depth=2.5, r_rest=28.0, heel=9.0),
        outer=["body", (36.4, 14), (36.5, 60), (36.2, 106),
               "shoulder", (35.6, 118), (34.0, 134), (31.0, 152), (28.0, 170), (25.6, 186),
               "neck", (24.2, 198), (23.9, 206),
               "finish", (24.6, 208.5), (26.2, 210.8), (26.2, 213.0), (24.9, 215.2), (25.1, 218.0), (26.0, 219.4),
               (26.0, 220.6)],
        lip=dict(r_bore=21.0, round_o=1.6, round_i=1.2),
        wall=dict(base=6.0, heel=4.8, body=3.6, shoulder=3.4, neck=3.8, finish=4.2, blend=6.0),
        glass="flint", glass_options=["flint", "aqua"],
        liquid=(0.93, 0.93, 0.89, 1.0), foam=0.25, foam_height=0.006,
        closure_depth=5,
        cap=dict(type="milkfoil", color=(0.85, 0.70, 0.22, 1), metal=1.0, rough=0.3, pleats=28),
        features=[dict(type="seams"), dict(type="band", z=24, half=0.5, ramp=1.2, depth=0.5, inner=0),
                  dict(type="band", z=100, half=0.5, ramp=1.2, depth=0.5, inner=0),
                  dict(type="stipple", z0=3, z1=11)],
        wobble=dict(oval=0.18, lean=0.4, noise=0.05), seg=(48, 32, 16), label_zone=(30, 95)),

    "mason": dict(
        desc="Mason/canning jar 500 ml regular mouth: real helical thread, two-piece metal lid (disc + band)",
        family="jar", ref_ml=500,
        base=dict(type="pushup", depth=2.0, r_rest=31.0, heel=7.0),
        outer=["body", (38.0, 9), (38.2, 50), (38.0, 94),
               "shoulder", (37.4, 100), (36.0, 105), (34.4, 108.5),
               "neck", (33.8, 110.5),
               "finish", (35.4, 111.5, "c"), (35.4, 113.0), (33.6, 114.2, "c"), (33.5, 115.0), (33.5, 127.0),
               (33.4, 128.2)],
        lip=dict(r_bore=30.2, round_o=1.6, round_i=1.2),
        wall=dict(base=5.0, heel=4.0, body=3.2, shoulder=3.0, neck=3.0, finish=3.2, blend=4.0),
        glass="flint", glass_options=["flint", "blue", "aqua", "green"],
        liquid=(0.78, 0.48, 0.08, 1.0), foam=0.0, foam_height=0.003,
        closure_depth=3,
        cap=dict(type="mason", band_color=(0.75, 0.75, 0.77, 1), lid_color=(0.80, 0.66, 0.30, 1)),
        features=[dict(type="thread", pitch=4.2, height=1.6, z0=116.0, z1=126.0, starts=1, geo=(0,), nm=True),
                  dict(type="band", z=20, half=0.6, ramp=1.2, depth=0.6, inner=0),
                  dict(type="band", z=88, half=0.6, ramp=1.2, depth=0.6, inner=0),
                  dict(type="seams")],
        wobble=dict(oval=0.15, lean=0.25, noise=0.04), seg=(64, 40, 18), label_zone=(26, 84)),

    "decanter": dict(
        desc="Wine/ship decanter: very wide flat base, concave flaring cone, long neck, glass ball stopper",
        family="decanter", ref_ml=1000,
        base=dict(type="pushup", depth=3.0, r_rest=66.0, heel=8.0),
        outer=["body", (75.0, 9), (74.4, 16), (69.8, 30), (60.0, 50), (48.0, 74), (37.0, 100), (28.6, 128),
               "shoulder", (23.2, 152), (20.4, 172),
               "neck", (19.2, 190), (19.0, 215), (19.4, 226),
               "finish", (21.0, 231), (23.6, 234), (24.0, 235.8)],
        lip=dict(r_bore=15.2, round_o=1.6, round_i=1.2),
        wall=dict(base=6.0, heel=5.0, body=3.6, shoulder=3.4, neck=3.6, finish=3.6, blend=8.0),
        glass="flint_hi", glass_options=["flint_hi", "aqua", "blue"],
        liquid=(0.36, 0.02, 0.06, 1.0), foam=0.05, foam_height=0.004,
        closure_depth=26,
        cap=dict(type="stopper", ball_r=27.0, shank_r0=14.9, shank_r1=13.6, shank_len=24),
        features=[dict(type="waviness", amp=0.03)],
        wobble=dict(oval=0.25, lean=0.5, noise=0.06), seg=(64, 40, 20), label_zone=None),

    "cruet": dict(
        desc="Oil/vinegar cruet 250 ml: teardrop body, long tapering neck, cork + stainless pourer",
        family="kitchen", ref_ml=250,
        base=dict(type="pushup", depth=3.0, r_rest=24.0, heel=6.0),
        outer=["body", (30.5, 9), (32.6, 26), (32.4, 44), (29.0, 70),
               "shoulder", (24.0, 100), (19.0, 130), (15.0, 160),
               "neck", (12.6, 185), (11.6, 200), (11.4, 210),
               "finish", (12.2, 212.0), (12.8, 213.6), (12.8, 216.4)],
        lip=dict(r_bore=8.6, round_o=1.4, round_i=0.9),
        wall=dict(base=5.0, heel=3.8, body=2.8, shoulder=2.6, neck=2.6, finish=3.0, blend=6.0),
        glass="flint", glass_options=["flint", "green", "aqua"],
        liquid=(0.42, 0.40, 0.04, 1.0), foam=0.0, foam_height=0.002,
        closure_depth=16,
        cap=dict(type="pourer", cork_len=18, collar_r=11.0, spout_r0=4.0, spout_r1=2.6, spout_len=40),
        features=[dict(type="seams")],
        wobble=dict(oval=0.15, lean=0.4, noise=0.04), seg=(48, 32, 16), label_zone=(20, 60)),

    "erlenmeyer": dict(
        desc="Erlenmeyer flask 500 ml narrow neck, borosilicate: straight cone, beaded rim with pour spout, "
             "embossed graduations",
        family="lab", ref_ml=500,
        base=dict(type="pushup", depth=1.2, r_rest=44.0, heel=9.0),
        outer=["body", (52.5, 9), (52.4, 14), (35.8, 92),
               "shoulder", (24.2, 140), (20.6, 150),
               "neck", (18.4, 158), (17.8, 166), (17.8, 172),
               "finish", (18.4, 173.5), (19.6, 175.0), (19.7, 177.4)],
        lip=dict(r_bore=15.2, round_o=1.2, round_i=0.8),
        wall=dict(base=2.4, heel=2.2, body=1.8, shoulder=1.8, neck=1.8, finish=2.2, blend=5.0),
        glass="borosilicate", glass_options=["borosilicate", "amber"],
        liquid=(0.10, 0.55, 0.20, 1.0), foam=0.35, foam_height=0.01,
        closure_depth=12,
        cap=dict(type="cork", r_top=16.4, r_bot=14.6, length=22, protrude=10),
        features=[dict(type="spout", theta=90, width=16, out=2.4, zone=7.0),
                  dict(type="grad", first=100, last=450, step=50, major=100, theta=-90)],
        wobble=dict(oval=0.05, lean=0.1, noise=0.01), seg=(56, 36, 16), label_zone=(30, 80)),

    "roundflask": dict(
        desc="Round-bottom boiling flask 250 ml on a cork ring stand, beaded neck",
        family="lab", ref_ml=250,
        base=dict(type="none"),
        outer=["base", (0.0, 9.0), (14.0, 10.6), (27.0, 15.6), (36.6, 24.0), (41.6, 34.0), (43.2, 47.0),
               "body", (41.6, 60.0), (36.6, 70.0), (28.0, 78.0),
               "shoulder", (20.0, 82.5), (15.6, 86.5),
               "neck", (13.6, 92), (13.2, 110), (13.2, 150),
               "finish", (13.8, 151.6), (15.0, 153.0), (15.1, 155.0)],
        lip=dict(r_bore=11.4, round_o=1.0, round_i=0.7),
        wall=dict(base=1.6, heel=1.6, body=1.5, shoulder=1.5, neck=1.6, finish=2.0, blend=5.0),
        glass="borosilicate", glass_options=["borosilicate", "amber"],
        liquid=(0.75, 0.10, 0.45, 1.0), foam=0.35, foam_height=0.01,
        closure_depth=14,
        cap=dict(type="cork", r_top=12.0, r_bot=10.8, length=20, protrude=9),
        stand=dict(r_center=24.0, r_tube=7.0, z=7.0),
        features=[],
        wobble=dict(oval=0.05, lean=0.1, noise=0.01), seg=(56, 36, 16), label_zone=None),
}


def _scale(v, f):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v * f
    if isinstance(v, tuple):
        return tuple(_scale(x, f) if not isinstance(x, str) else x for x in v)
    if isinstance(v, list):
        return [_scale(x, f) if not isinstance(x, str) else x for x in v]
    if isinstance(v, dict):
        return {k: (_scale(x, f) if k in LENGTH_KEYS else x) for k, x in v.items()}
    return v


# keys inside nested dicts that are lengths (everything else - colours, counts, angles, fractions - is kept)
LENGTH_KEYS = {"depth", "r_rest", "heel", "r_bore", "round_o", "round_i", "base", "body", "shoulder", "neck",
               "finish", "blend", "z", "half", "ramp", "z0", "z1", "pitch", "height", "zmax", "out", "zone",
               "oval", "lean", "noise", "r", "h", "thick", "dome", "head_r", "head_h", "r_top", "r_bot", "length",
               "protrude", "ball_r", "shank_r0", "shank_r1", "shank_len", "cork_len", "collar_r", "spout_r0",
               "spout_r1", "spout_len", "r_center", "r_tube", "amp", "heel_r"}


def get_spec(name):
    """Spec in METRES (strings/colours/counts untouched). name may be 'bordeaux' or 'bordeaux:amber'."""
    base, _, variant = name.partition(":")
    s = copy.deepcopy(SPECS[base])
    if variant:
        assert variant in GLASS, variant
        s["glass"] = variant
    out = {}
    for k, v in s.items():
        if k in ("outer",):
            out[k] = [x if isinstance(x, str) else tuple(c * UNIT if not isinstance(c, str) else c for c in x) for x in v]
        elif k in ("base", "lip", "wall", "cap", "wobble", "stand"):
            out[k] = _scale(v, UNIT) if isinstance(v, dict) else v
        elif k == "features":
            out[k] = [_scale(f, UNIT) for f in v]
            for f in out[k]:   # grad ml values are not lengths
                if f["type"] == "grad":
                    f.update({kk: SPECS[base]["features"][out[k].index(f)][kk] for kk in ("first", "last", "step", "major")})
        elif k in ("closure_depth",):
            out[k] = v * UNIT
        elif k == "label_zone":
            out[k] = None if v is None else (v[0] * UNIT, v[1] * UNIT)
        else:
            out[k] = v
    out["name"] = base if not variant else f"{base}_{variant}"
    out["glass_def"] = GLASS[out["glass"]]
    return out


NAMES = list(SPECS)
