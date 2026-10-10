// Positions and item order from demo/main.gd. Dimensions are metres.
export const SHELVES = [
  { y: 0.55, items: [['bottle_wine', ''], ['bottle_beer', ''], ['bottle_whiskey', ''], ['bottle_jar', ''], ['bottle_flask', ''], ['bottle_soda', '']] },
  { y: 1.05, items: [['bottle_v2_bordeaux', ''], ['bottle_v2_longneck', ''], ['bottle_v2_whisky', ''], ['bottle_v2_pet500', ''], ['bottle_v2_mason', ''], ['bottle_v2_spirit', '']] },
  { y: 1.55, items: [['container_tumbler', ''], ['container_hipflask', ''], ['container_mug', ''], ['bottle_wine', 'wine_classic'], ['bottle_beer', 'beer_pale'], ['bottle_soda', 'soda_cherry'], ['bottle_v2_bordeaux', 'v2_bordeaux_classic'], ['bottle_v2_longneck', 'v2_longneck_lager']] },
];
export const BAR_ITEMS = [
  ['container_tumbler', '', 0, -0.45, false], ['container_tumbler', '', 0.9, -0.28, false], ['container_mug', '', 0.8, -0.1, false],
  ['bottle_wine', '', 0.8, 0.08, true], ['bottle_v2_bordeaux', '', 0.7, 0.26, true], ['container_square', '', 0.7, 0.44, false],
  ['container_hipflask', 'container_hipflask_engraved', 0.6, -0.45, false], ['container_jerrycan', 'container_jerrycan_fuel', 0.7, 0.1, false],
  ['container_mug', 'container_mug_diner', 0, 0.3, false],
];
export const BAR_X = 2.7;
export const BAR_TOP = 0.72;
