// P2 golden vectors: container ledger (store/retrieve/move/storeAll with rollback, rejection reasons, checkpoint v2), BackpackMount
// (acceptOnly, snapMode, returnDelayS, placing/placed/removing/removed, validators), the materialisation-limited view with its single
// refresh path, and the stash profile kind. Inputs only: tools/gen_golden.mjs runs them through the JS ledger (the source of the
// numbers) and the Godot twin (GSBackpackContainer) replays the same inputs. Kept apart from vectors.mjs so the older vectors stay as they were.
// Each op yields { result, events, where, refresh, extra } (see golden_runner.mjs runLedger).
import { profileCases } from './vectors.mjs';

// ---- profile validation, continued (kind/stash, BackpackMount fields, materialisation limit)
const profileCases2 = example => {
  const mk = fn => { const p = JSON.parse(JSON.stringify(example)); fn(p); return p; };
  const stash = mk(p => { p.id = 'locker'; p.kind = 'stash'; p.detachable = false; delete p.handle; delete p.dominantHand; delete p.donZone; delete p.recall; p.pockets = p.pockets.slice(0, 3); });
  const mkStash = fn => { const p = JSON.parse(JSON.stringify(stash)); fn(p); return p; };
  return [
    ['mount_fields_valid', mk(p => { p.pockets[4].mount = { acceptOnly: ['pistol', 'pistol_a'], snapMode: 'dropped', returnDelayS: 0.5 }; p.pockets[5].mount = {}; p.bagMount = { acceptOnly: ['field_pack'], snapMode: 'range', returnDelayS: 1 }; })],
    ['mount_unknown_key', mk(p => { p.pockets[4].mount = { color: 'red' }; })],
    ['mount_accept_only_empty', mk(p => { p.pockets[4].mount = { acceptOnly: [] }; })],
    ['mount_accept_only_duplicate', mk(p => { p.pockets[4].mount = { acceptOnly: ['a', 'a'] }; })],
    ['mount_bad_snap_mode', mk(p => { p.pockets[4].mount = { snapMode: 'magnet' }; })],
    ['mount_return_delay_negative', mk(p => { p.pockets[4].mount = { returnDelayS: -1 }; })],
    ['mount_return_delay_too_long', mk(p => { p.pockets[4].mount = { returnDelayS: 61 }; })],
    ['bag_mount_bad_snap_mode', mk(p => { p.bagMount = { snapMode: 3 }; })],
    ['kind_stash_valid', stash],
    ['kind_unknown', mk(p => { p.kind = 'crate'; })],
    ['stash_must_not_be_detachable', mkStash(p => { p.detachable = true; })],
    ['stash_rejects_handle', mkStash(p => { p.handle = { local: [0, 0, 0] }; })],
    ['stash_rejects_recall', mkStash(p => { p.recall = { seated: true }; })],
    ['stash_rejects_bag_mount', mkStash(p => { p.bagMount = {}; })],
    ['stash_rejects_carry_flags', mkStash(p => { p.tiers = { low: { detach: true } }; })],
    ['stash_allows_materialisation_flags', mkStash(p => { p.tiers = { high: { physicalItemsMax: 10 } }; })],
    ['pack_still_needs_handle', mk(p => { p.kind = 'pack'; delete p.handle; })],
    ['materialisation_limit_12_valid', mk(p => { p.tiers = { high: { physicalItemsMax: 12 } }; })],
    ['materialisation_limit_13_rejected', mk(p => { p.tiers = { high: { physicalItemsMax: 13 } }; })],
    ['materialisation_limit_fraction_rejected', mk(p => { p.tiers = { high: { physicalItemsMax: 7.5 } }; })],
  ].map(([name, profile]) => ({ name, profile }));
};
/** All profile cases: the P0/P1 cases first (unchanged), then the P2 additions. */
export const profileCasesAll = example => [...profileCases(example), ...profileCases2(example)];

/** Profiles the ledger vectors use: example (field_pack), mountPack (example + mounts and a 3-proxy limit on high), stash (data/profile.stash.example.json). */
export function goldenProfiles(example, stash) {
  const mountPack = JSON.parse(JSON.stringify(example));
  mountPack.id = 'mount_pack';
  mountPack.tiers = { high: { physicalItemsMax: 3 } };
  mountPack.pockets[3].mount = { snapMode: 'none' };
  mountPack.pockets[4].mount = { acceptOnly: ['sidearm', 'pistol_a'], snapMode: 'dropped', returnDelayS: 0.5 };
  mountPack.pockets[5].mount = { acceptOnly: ['magazine'], snapMode: 'range', returnDelayS: 0 };
  mountPack.pockets[6].mount = { acceptOnly: ['rifle_x'], returnDelayS: 1 };
  return { example, mountPack, stash };
}

const SZ = [0.10, 0.05, 0.03];
const reg = (id, category, size = SZ, extra = {}) => ({ op: 'registerItem', id, category, size, ...extra });
const put = (item, pocket, extra = {}) => ({ op: 'store', item, pocket, ...extra });
const take = (pocket, item, extra = {}) => ({ op: 'retrieve', pocket, ...(item ? { item } : {}), ...extra });
const ALLOW = { op: 'setAccess', pockets: 'all' };
const regMany = (cat, ids) => ids.map(id => reg(id, cat));
const FP = ['main_tool/0', 'main_tool/1', 'main_supply/0', 'main_supply/1', 'main_supply/2', 'main_case/0', 'side_pouch/0', 'left_hip/0', 'right_hip/0', 'back_long/0'];
/** A field_pack ledger checkpoint (v1 shape) with the given cell contents. */
const fpCells = (map = {}) => Object.fromEntries(FP.map(c => [`field_pack/${c}`, map[c] ?? '']));
const ledgerV1 = (map, extra = {}) => ({ schema: 'gamesystems.backpack-ledger.v1', profileId: 'field_pack', cells: fpCells(map), ...extra });
const v2 = (map, extra = {}) => ({ schema: 'gamesystems.backpack-checkpoint.v2', profileId: 'field_pack', ledger: ledgerV1(map), bag: null, ...extra });

export const ledgerVectors = [
  { name: 'store_retrieve_basics', profile: 'example', ops: [ALLOW,
    reg('t1', 'tool'), reg('s1', 'supply'), reg('m1', 'medical'), reg('p1', 'pistol'),
    put('t1', 'main_tool'), put('s1', 'main_supply'), put('m1', 'main_tool'), put('t1', 'main_tool'), take('main_tool'), take('main_case'), take('main_tool', 's1'),
    put('p1', 'main_tool'), put('ghost', 'main_tool'), put('s1', 'nowhere'), take('main_tool', 'm1', { newOwner: 'hand:left' }), take('nowhere'), put('m1', 'main_tool', { owner: 'hand:left' }), { op: 'capture' }] },
  { name: 'rejection_reasons_and_order', profile: 'example', ops: [ALLOW,
    reg('big', 'supply', [0.5, 0.1, 0.1]), reg('rot', 'supply', [0.03, 0.1, 0.25]), reg('odd', 'supply', [0, 0.1, 0.1], { force: true }), reg('nan', 'supply', [0.1, 'NaN', 0.1], { force: true }),
    reg('pg', 'pistol', [0.5, 0.5, 0.5]), reg('s1', 'supply'), reg('s2', 'supply'),
    { op: 'check', item: 'big', pocket: 'main_case' }, { op: 'check', item: 'rot', pocket: 'main_supply' }, put('rot', 'main_supply'), put('big', 'main_case'), put('odd', 'main_case'), put('nan', 'main_case'),
    put('pg', 'main_tool'), { op: 'check', item: 'pg', pocket: 'left_hip' }, put('s1', 'main_case'), put('s2', 'main_case'), { op: 'check', item: 's2', pocket: 'main_case' }, put('s2', 'nowhere')] },
  { name: 'access_by_bag_state_and_mounts', profile: 'example', ops: [
    reg('t1', 'tool'), reg('g1', 'pistol'), reg('r1', 'long_gun', [0.9, 0.2, 0.08]), reg('s1', 'supply'),
    { op: 'setAccess', pockets: [] }, put('t1', 'main_tool'), put('g1', 'left_hip'), { op: 'setAccess', pockets: ['left_hip', 'right_hip', 'back_long', 'side_pouch'] }, put('g1', 'left_hip'), put('r1', 'back_long'), put('t1', 'main_tool'), put('t1', 'side_pouch'),
    { op: 'setAccess', pockets: ['left_hip', 'back_long'] }, take('side_pouch'), take('left_hip'), { op: 'move', item: 'r1', pocket: 'left_hip' }, { op: 'setAccess', pockets: 'all' }, { op: 'move', item: 't1', pocket: 'main_tool' }, put('g1', 'left_hip'), put('s1', 'main_supply')] },
  { name: 'move_between_pockets_with_rollback', profile: 'example', ops: [ALLOW,
    ...regMany('supply', ['a', 'b', 'c']), reg('tl', 'tool'), reg('g1', 'pistol'), put('a', 'main_supply'), put('b', 'main_supply'), put('tl', 'main_tool'),
    { op: 'move', item: 'a', pocket: 'main_case' }, { op: 'move', item: 'b', pocket: 'main_case' }, { op: 'move', item: 'b', pocket: 'main_supply' }, { op: 'move', item: 'b', pocket: 'main_supply' },
    { op: 'fault', method: 'store', skip: 0, fail: 1 }, { op: 'move', item: 'b', pocket: 'main_case' }, { op: 'fault', method: 'store', skip: 0, fail: 0 },
    { op: 'move', item: 'c', pocket: 'main_tool' }, { op: 'move', item: 'tl', pocket: 'left_hip' }, { op: 'move', item: 'tl', pocket: 'nowhere' }, { op: 'move', item: 'a', pocket: 'side_pouch' }, { op: 'move', item: 'tl', pocket: 'main_supply' }] },
  { name: 'store_all_is_all_or_nothing', profile: 'example', ops: [ALLOW,
    ...regMany('supply', ['a', 'b', 'c', 'd', 'e']), reg('t1', 'tool'),
    { op: 'storeAll', items: ['a', 'b'], pocket: 'main_supply' }, { op: 'storeAll', items: ['c', 'd'], pocket: 'main_supply' }, { op: 'storeAll', items: ['c', 'c'], pocket: 'main_supply' },
    { op: 'storeAll', items: ['c', 't1'], pocket: 'main_supply' }, { op: 'fault', method: 'store', skip: 1, fail: 1 }, { op: 'storeAll', items: ['c', 'd'], pocket: 'main_case' }, { op: 'storeAll', items: ['c', 'd'], pocket: 'main_supply' },
    { op: 'fault', method: 'store', skip: 0, fail: 0 }, { op: 'storeAll', items: ['c'], pocket: 'main_supply' }, { op: 'storeAll', items: [], pocket: 'main_supply' }, { op: 'storeAll', items: ['a'], pocket: 'main_case' }] },
  { name: 'provider_faults_change_nothing', profile: 'example', ops: [ALLOW,
    reg('a', 'supply'), reg('b', 'supply'), put('a', 'main_supply'),
    { op: 'fault', method: 'store', skip: 0, fail: 1 }, put('b', 'main_supply'), put('b', 'main_supply'), { op: 'fault', method: 'retrieve', skip: 0, fail: 2 }, take('main_supply'), take('main_supply', 'a'), take('main_supply'), take('main_supply', 'a', { newOwner: 'hand:right' }),
    { op: 'fault', method: 'retrieve', skip: 0, fail: 0 }, take('main_supply', 'a'), put('a', 'main_supply')] },
  { name: 'checkpoint_roundtrip_and_invalid_restores', profile: 'example', ops: [ALLOW,
    ...regMany('supply', ['a', 'b', 'c']), reg('tl', 'tool'), reg('g1', 'pistol'), put('a', 'main_supply'), put('b', 'main_supply'), put('tl', 'main_tool'), { op: 'capture' },
    { op: 'move', item: 'a', pocket: 'main_case' }, put('g1', 'left_hip'), { op: 'capture' },
    { op: 'restore', data: ledgerV1({ 'main_tool/0': 'tl', 'main_supply/0': 'b', 'main_supply/1': 'a' }) }, { op: 'capture' },
    { op: 'restore', data: ledgerV1({}, { schema: 'gamesystems.backpack-ledger.v2' }) }, { op: 'restore', data: ledgerV1({}, { profileId: 'other' }) },
    { op: 'restore', data: { schema: 'gamesystems.backpack-ledger.v1', profileId: 'field_pack', cells: { 'field_pack/main_tool/0': 'tl' } } },
    { op: 'restore', data: ledgerV1({ 'main_tool/0': 'tl', 'main_tool/1': 'tl' }) },
    { op: 'restore', data: ledgerV1({ 'main_tool/0': 'ghost' }) },
    { op: 'restore', data: ledgerV1({ 'main_tool/0': 'g1' }) },
    { op: 'restore', data: { schema: 'gamesystems.backpack-ledger.v1', profileId: 'field_pack', cells: { 'field_pack/main_tool/0': 'c', 'field_pack/main_tool/1': 'c', 'field_pack/bogus/0': '' } } },
    { op: 'fault', method: 'store', skip: 1, fail: 1 },
    { op: 'restore', data: ledgerV1({ 'main_tool/0': 'tl', 'main_supply/0': 'a', 'main_supply/1': 'b' }) },
    { op: 'fault', method: 'store', skip: 0, fail: 0 }, { op: 'capture' }] },
  { name: 'checkpoint_v2_accepts_missing_backpack_state', profile: 'example', ops: [ALLOW,
    reg('a', 'supply'), reg('tl', 'tool'), put('a', 'main_supply'), put('tl', 'main_tool'), { op: 'captureV2' },
    take('main_supply'), take('main_tool'), { op: 'restoreV2', absent: true }, { op: 'captureV2' }, { op: 'restoreV2', data: null }, { op: 'captureV2' },
    { op: 'restoreV2', data: v2({ 'main_tool/0': 'tl', 'main_supply/0': 'a' }) }, { op: 'captureV2' },
    take('main_supply'),
    { op: 'restoreV2', data: ledgerV1({ 'main_tool/0': 'tl' }) }, { op: 'captureV2' },
    { op: 'restoreV2', data: { schema: 'gamesystems.backpack-system.v1', bag: { schema: 'gamesystems.backpack.v1' }, ledger: ledgerV1({ 'main_tool/0': 'tl', 'main_supply/0': 'a' }) } }, { op: 'captureV2' },
    { op: 'restoreV2', data: v2({}, { profileId: 'other' }) }, { op: 'restoreV2', data: v2({}, { schema: 'gamesystems.backpack-checkpoint.v3' }) },
    { op: 'restoreV2', data: { schema: 'gamesystems.backpack-checkpoint.v2', profileId: 'field_pack', bag: null } }, { op: 'restoreV2', data: v2({}, { bag: 3 }) },
    { op: 'restoreV2', data: v2({ 'main_tool/0': 'ghost' }) },
    { op: 'restoreV2', data: 'junk' }, { op: 'captureV2' }] },
  { name: 'mount_accept_only_and_snap_modes', profile: 'mountPack', ops: [ALLOW,
    reg('pa', 'pistol', SZ, { tags: ['pistol_a'] }), reg('pb', 'pistol'), reg('mg', 'magazine', SZ, { tags: ['magazine', 'ammo'] }), reg('mg2', 'magazine'), reg('rf', 'long_gun', [0.9, 0.2, 0.08]), reg('tl', 'tool'),
    put('pb', 'left_hip'), put('pa', 'left_hip'), { op: 'offer', item: 'pa', pocket: 'left_hip' }, { op: 'offer', item: 'pa', pocket: 'left_hip', released: true },
    { op: 'offer', item: 'mg', pocket: 'right_hip' }, put('mg2', 'right_hip'), put('pb', 'right_hip'), { op: 'offer', item: 'tl', pocket: 'side_pouch', released: true }, put('tl', 'side_pouch'),
    put('rf', 'back_long'), { op: 'hand', item: 'rf', from: 'world', to: 'hand:right' }, { op: 'offer', item: 'rf', pocket: 'back_long' }, { op: 'offer', item: 'ghost', pocket: 'back_long' }, { op: 'offer', item: 'rf', pocket: 'nowhere' },
    { op: 'move', item: 'pa', pocket: 'right_hip' }, { op: 'check', item: 'pb', pocket: 'left_hip' }] },
  { name: 'mount_events_and_validators', profile: 'mountPack', ops: [ALLOW,
    reg('pa', 'pistol', SZ, { tags: ['pistol_a'] }), reg('mg', 'magazine'), reg('a', 'supply'), reg('b', 'supply'), reg('c', 'supply'), reg('tl', 'tool'),
    put('pa', 'left_hip'), put('a', 'main_supply'), { op: 'move', item: 'a', pocket: 'main_case' }, take('main_case'), { op: 'storeAll', items: ['a', 'b'], pocket: 'main_supply' },
    { op: 'validator', on: ['placing'], items: ['c'] }, put('c', 'main_supply'), { op: 'storeAll', items: ['b', 'c'], pocket: 'main_case' }, { op: 'move', item: 'a', pocket: 'main_case' }, put('tl', 'main_tool'),
    { op: 'clearValidators' }, { op: 'validator', on: ['removing'], pockets: ['main_supply'] }, take('main_supply'), take('main_supply', 'a'), { op: 'move', item: 'a', pocket: 'main_case' }, take('left_hip'),
    { op: 'validator', on: ['placing', 'removing'], pockets: ['main_case'] }, put('c', 'main_case'), { op: 'move', item: 'tl', pocket: 'main_supply' }, { op: 'clearValidators' }, put('c', 'main_case')] },
  { name: 'mount_return_delay_and_pickup', profile: 'mountPack', ops: [ALLOW,
    reg('pa', 'pistol', SZ, { tags: ['pistol_a'] }), reg('mg', 'magazine'), reg('rf', 'long_gun', [0.9, 0.2, 0.08]), reg('tl', 'tool'),
    { op: 'scheduleReturn', item: 'pa', pocket: 'left_hip' }, { op: 'scheduleReturn', item: 'rf', pocket: 'back_long' }, { op: 'scheduleReturn', item: 'mg', pocket: 'right_hip' },
    { op: 'tick', dt: 0.2 }, { op: 'tick', dt: 0.2 }, { op: 'tick', dt: 'NaN' }, { op: 'tick', dt: -1 }, { op: 'tick', dt: 0.1 }, { op: 'tick', dt: 0.0 }, { op: 'tick', dt: 0.5 },
    { op: 'scheduleReturn', item: 'pa', pocket: 'nowhere' }, { op: 'scheduleReturn', item: 'ghost', pocket: 'left_hip' }, { op: 'scheduleReturn', item: 'pa', pocket: 'left_hip' },
    take('left_hip', 'pa'), { op: 'scheduleReturn', item: 'pa', pocket: 'left_hip' }, { op: 'hand', item: 'pa', from: 'world', to: 'hand:left' }, { op: 'tick', dt: 5 },
    { op: 'scheduleReturn', item: 'tl', pocket: 'left_hip' }, { op: 'tick', dt: 5 }, take('left_hip'), { op: 'tick', dt: 1 }] },
  { name: 'view_materialisation_limit_pages_and_tabs', profile: 'mountPack', tier: 'high', ops: [ALLOW,
    ...regMany('supply', ['s1', 's2', 's3']), ...regMany('tool', ['t1', 't2']), reg('m1', 'medical'), reg('t3', 'tool'), reg('g1', 'pistol'),
    put('t1', 'main_tool'), put('t2', 'main_tool'), put('s1', 'main_supply'), put('s2', 'main_supply'), put('s3', 'main_supply'), put('m1', 'main_case'), put('t3', 'side_pouch'), put('g1', 'left_hip'),
    { op: 'view' }, { op: 'view', page: 1 }, { op: 'view', page: 2 }, { op: 'view', page: 9 }, { op: 'view', page: -3 }, { op: 'view', page: 'NaN' },
    { op: 'view', tab: 'main_supply' }, { op: 'view', tab: 'main_supply', page: 1 }, { op: 'view', tab: 'main_case' }, { op: 'view', tab: 'nowhere' }, { op: 'view', tab: 'left_hip' }, { op: 'view', exclude: ['t1', 's2'] },
    { op: 'selectView', tab: 'main_tool', page: 0 }, { op: 'setAccess', pockets: ['main_tool', 'side_pouch', 'left_hip'] }, { op: 'view' }, { op: 'view', tab: 'main_supply' }, { op: 'selectView', tab: '*', page: 1 },
    ALLOW, { op: 'setTier', tier: 'medium' }, { op: 'view' }, { op: 'view', tab: 'main_case' }, { op: 'setTier', tier: 'low' }, { op: 'view', page: 4 }, { op: 'setTier', tier: 'off' }, { op: 'view' }, { op: 'setTier', tier: 'high' }, { op: 'view', page: 1 }] },
  { name: 'view_leaves_out_held_items', profile: 'mountPack', tier: 'high', ops: [ALLOW,
    ...regMany('supply', ['s1', 's2', 's3']), put('s1', 'main_supply'), put('s2', 'main_supply'), put('s3', 'main_supply'), { op: 'view', tab: 'main_supply' },
    { op: 'hold', item: 's2', side: 'right' }, { op: 'view', tab: 'main_supply' }, { op: 'hold', item: 'ghost', side: 'right' }, { op: 'hold', item: 's1', side: 'middle' }, { op: 'hold', item: 's1', side: 'left' }, { op: 'view', tab: 'main_supply' },
    take('main_supply', 's1', { newOwner: 'hand:left' }), { op: 'view', tab: 'main_supply' }, { op: 'unhold', item: 's2' }, { op: 'unhold', item: 's2' }, { op: 'view', tab: 'main_supply' }, put('s1', 'main_supply', { owner: 'hand:left' }), { op: 'view', tab: 'main_supply' },
    { op: 'hold', item: 's3', side: 'left' }, put('s3', 'main_case', { owner: 'world' }), { op: 'setTier', tier: 'low' }, { op: 'view', tab: 'main_supply' }, { op: 'unhold', item: 's3' }, { op: 'view', tab: 'main_supply' }] },
  { name: 'refresh_has_one_path_and_guards_reentrancy', profile: 'mountPack', tier: 'high', ops: [ALLOW,
    ...regMany('supply', ['s1', 's2', 's3']), { op: 'listener', mode: 'store_once', item: 's2', pocket: 'main_supply' },
    put('s1', 'main_supply'), { op: 'view', tab: 'main_supply' }, put('s3', 'main_supply'), { op: 'selectView', tab: 'main_supply', page: 0 }, { op: 'hold', item: 's3', side: 'left' }, { op: 'unhold', item: 's3' },
    take('main_supply', 's1'), { op: 'storeAll', items: ['s1'], pocket: 'main_supply' }, { op: 'move', item: 's1', pocket: 'main_case' }, { op: 'setTier', tier: 'low' },
    { op: 'listener', mode: 'store_always', item: 's1', pocket: 'main_supply' }, take('main_case'), { op: 'capture' }] },
  { name: 'stash_access_open_close_and_checkpoint', profile: 'stash', ops: [
    reg('t1', 'tool'), reg('t2', 'tool'), reg('m1', 'medical'), reg('rf', 'long_gun', [0.9, 0.2, 0.08]), reg('g1', 'pistol'), reg('s1', 'supply'),
    put('t1', 'drawer'), put('m1', 'shelf'), put('rf', 'gun_rack'), { op: 'open' }, put('m1', 'shelf'), put('rf', 'gun_rack'), put('g1', 'gun_rack'), put('t2', 'drawer'), put('s1', 'drawer'), put('s1', 'shelf'), { op: 'capture' },
    { op: 'close' }, take('shelf'), take('drawer'), { op: 'view' }, { op: 'capture' }, { op: 'open' }, take('gun_rack', 'rf'), put('rf', 'gun_rack'), { op: 'close' },
    { op: 'restore', data: { schema: 'gamesystems.backpack-stash.v1', profileId: 'wall_locker', open: true, backpack: null } }, { op: 'capture' },
    { op: 'restore', data: { schema: 'gamesystems.backpack-stash.v1', profileId: 'other', open: true, backpack: null } }, { op: 'restore', data: { schema: 'gamesystems.backpack-stash.v1', profileId: 'wall_locker', open: 'yes' } },
    { op: 'restore', data: { schema: 'gamesystems.backpack-stash.v0', profileId: 'wall_locker', open: false } }, { op: 'capture' }] },
  { name: 'stash_view_pages_and_slots', profile: 'stash', tier: 'high', ops: [
    ...regMany('supply', ['a', 'b', 'c']), ...regMany('tool', ['d', 'e']), { op: 'open' },
    put('a', 'shelf'), put('b', 'shelf'), put('c', 'shelf'), put('d', 'shelf'), put('e', 'drawer'), { op: 'view' }, { op: 'view', tab: 'shelf' }, { op: 'setTier', tier: 'low' }, { op: 'view' }, { op: 'view', tab: 'gun_rack' },
    { op: 'close' }, { op: 'view' }, { op: 'setTier', tier: 'high' }, { op: 'view' }] },
];
