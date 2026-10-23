// Bottle quality tiers. The host maps the game's global level onto BOTTLE_TIERS (four tiers, so the demo's levels 0–3
// map one to one: minimal, low, mid, high); a game can pin one with host.setTier('bottles', 'low').
// Tiers change only what is drawn and the ceilings on spawned effects. Physics, damage and liquid volumes never depend
// on the tier: the same hit breaks the same bottle and the volume ledger balances on every tier (a capped drop merges
// into the newest one, a capped puddle stops being drawn but keeps its millilitres).
// 'mid' and 'high' keep the ceilings the demo always had (250 debris, 32/48 pane shards, 8–36 splash drops).
export const BOTTLE_TIERS = Object.freeze(['minimal', 'low', 'mid', 'high']);

const tier = t => Object.freeze(t);
export const BOTTLE_QUALITY = Object.freeze({
  //            mesh shadows, liquid bubbles (0..1) and slosh, pour streams drawn, every n-th drop drawn,
  //            every n-th shard spawned, live debris bodies, drops per splash, drops in flight, puddles drawn, marks per bottle,
  //            puddles shaded thick-centre-to-thin-rim (vertex colour + alpha) instead of one flat colour each,
  //            liquidMix: colour of a non-empty bottle caught in a pour. 'full' = ml-weighted absorbance, faded over mixFade s;
  //            'discrete' = own colour until half of the content is foreign, then one switch to the mix (no fade). The logical
  //            mix (b.absorbance, what is poured out next) is exact on every tier.
  //            liquidViscosity: holes drain slower for viscous liquids (liquid_props.js); false on every tier (opt-in: the bottles
  //            option liquidViscosity / setLiquidViscosity / ?viscosity=on).
  minimal: tier({ shadows: false, bubbles: 0, slosh: false, streams: false, dropStride: 4, shardStride: 3, maxDebris: 60, splashDrops: 12, maxFlights: 400, maxPuddles: 16, damageMarks: 3, puddleGradient: false, liquidMix: 'discrete', mixFade: 0, liquidViscosity: false }),
  low: tier({ shadows: false, bubbles: 0, slosh: false, streams: false, dropStride: 1, shardStride: 2, maxDebris: 120, splashDrops: 20, maxFlights: 1200, maxPuddles: 32, damageMarks: 5, puddleGradient: false, liquidMix: 'discrete', mixFade: 0, liquidViscosity: false }),
  mid: tier({ shadows: true, bubbles: 0.4, slosh: true, streams: true, dropStride: 1, shardStride: 1, maxDebris: 250, splashDrops: 36, maxFlights: 4096, maxPuddles: 256, damageMarks: 8, puddleGradient: true, liquidMix: 'full', mixFade: 0.3, liquidViscosity: false }),
  high: tier({ shadows: true, bubbles: 1, slosh: true, streams: true, dropStride: 1, shardStride: 1, maxDebris: 250, splashDrops: 36, maxFlights: 4096, maxPuddles: 256, damageMarks: 8, puddleGradient: true, liquidMix: 'full', mixFade: 0.45, liquidViscosity: false }),
});

/** Settings of a tier name (unknown names: 'high'). */
export const bottleQuality = name => BOTTLE_QUALITY[name] ?? BOTTLE_QUALITY.high;
/** Index of a tier name in BOTTLE_TIERS (the demo's quality level), 3 for unknown names. */
export const tierIndex = name => { const i = BOTTLE_TIERS.indexOf(name); return i < 0 ? BOTTLE_TIERS.length - 1 : i; };
