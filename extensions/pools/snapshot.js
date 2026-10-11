import { finite, positive, vector } from '../host/system.js';
import { parseSources } from './provenance.js';

const idValue = (value, name) => {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name} needs a nonempty string`);
  return value;
};

// Validate and detach the complete snapshot before either owner changes its live state.
export function parsePoolSnapshot(data, { maxPools, presets, roomExists }) {
  if (data?.schema !== 'gamesystems.pools.v1' || !Array.isArray(data.pools))
    throw new Error('Invalid pool snapshot');
  const ids = new Set();
  const pools = data.pools.map(raw => {
    const id = idValue(raw.id, 'pool id');
    if (ids.has(id)) throw new Error('Duplicate snapshot id');
    ids.add(id);
    const surfaceId = idValue(raw.surfaceId, 'surfaceId');
    const roomId = raw.roomId ?? null;
    if (roomId !== null) { idValue(roomId, 'roomId'); roomExists(roomId); }
    if (!raw.components || typeof raw.components !== 'object' || Array.isArray(raw.components))
      throw new Error('Invalid snapshot components');
    const components = {};
    let ml = 0;
    for (const [kind, amount] of Object.entries(raw.components)) {
      if (!Object.hasOwn(presets, kind)) throw new Error('Unknown snapshot liquid');
      components[kind] = positive(amount, 'component ml', true);
      ml += amount;
    }
    const sourceMl = positive(raw.sourceMl ?? ml, 'sourceMl', true);
    if (sourceMl + 1e-5 < ml) throw new Error('Pool source volume is smaller than remaining volume');
    const blanket = finite(raw.blanket ?? 0);
    if (blanket < 0 || blanket > 1) throw new RangeError('Invalid blanket');
    if (raw.burning !== undefined && typeof raw.burning !== 'boolean') throw new TypeError('Invalid burning state');
    const active=raw.active===undefined?true:raw.active;if(typeof active!=='boolean')throw new TypeError('Invalid pool activity');
    if(!active&&(raw.burning||raw.heaterW))throw new Error('Dormant pools cannot burn or run heaters');
    const sources=parseSources(raw.sources,components,presets),wetSources=Object.create(null);
    if(raw.wetSources!==undefined){if(!raw.wetSources||typeof raw.wetSources!=='object'||Array.isArray(raw.wetSources))throw new Error('Invalid source wetness');for(const[key,amount]of Object.entries(raw.wetSources)){if(!Object.hasOwn(sources,key)||amount>(sources[key].water??0)+1e-5)throw new Error('Source wetness exceeds source water');wetSources[key]=positive(amount,'source wetness',true);}}
    const wetMl=positive(raw.wetMl??0,'wetMl',true);let wetUnattributed=positive(raw.wetUnattributed??wetMl,'wetUnattributed',true);const tracked=Object.values(wetSources).reduce((sum,amount)=>sum+amount,0)+wetUnattributed;
    if(tracked>wetMl+1e-5)throw new Error('Wetness accounts exceed pool wetness');
    wetUnattributed+=Math.max(0,wetMl-tracked);
    return { id, active, airConductance:positive(raw.airConductance??0,'airConductance',true),thermalId: `pool:${id}`, surfaceId, roomId, position: vector(raw.position), components, sources,
      wetSources,wetUnattributed,
      sourceMl, ml, temperature: finite(raw.temperature), blanket, burning: raw.burning ?? false,
      wetMl, heaterW: positive(raw.heaterW ?? 0, 'heaterW', true) };
  });
  if(pools.filter(p=>p.active).length>maxPools)throw new Error('Active pool budget exceeded');
  const activeIds=pools.filter(p=>p.active).map(p=>p.id),activeOrder=data.activeOrder===undefined?activeIds:data.activeOrder;
  if(!Array.isArray(activeOrder)||activeOrder.length!==activeIds.length||new Set(activeOrder).size!==activeOrder.length||activeOrder.some(id=>!activeIds.includes(id)))throw new Error('Invalid active pool order');
  const hotIds=pools.filter(p=>{if(p.active)return false;let ml=0,threshold=0;for(const[kind,amount]of Object.entries(p.components))if(presets[kind].fuelJPerMl){ml+=amount;threshold+=amount*presets[kind].ignition;}return ml>0&&p.temperature>=threshold/ml;}).map(p=>p.id);
  const hotOrder=data.hotOrder===undefined?hotIds:data.hotOrder;
  if(!Array.isArray(hotOrder)||hotOrder.length!==hotIds.length||new Set(hotOrder).size!==hotOrder.length||hotOrder.some(id=>!hotIds.includes(id)))throw new Error('Invalid hot pool order');
  const ledger = {};
  for (const key of ['initialMl', 'burnedMl', 'removedMl']) ledger[key] = positive(data.ledger?.[key], key, true);
  const remaining = pools.reduce((n, p) => n + p.ml, 0);
  if (Math.abs(ledger.initialMl - ledger.burnedMl - ledger.removedMl - remaining) > 1e-5)
    throw new Error('Unbalanced snapshot');
  if (data.ledger.remainingMl !== undefined && Math.abs(positive(data.ledger.remainingMl, 'remainingMl', true) - remaining) > 1e-5)
    throw new Error('Snapshot remaining volume disagrees with components');
  ledger.remainingMl=data.ledger.remainingMl??remaining;
  let nextId = data.nextId ?? 1;
  if (!Number.isSafeInteger(nextId) || nextId < 1) throw new RangeError('Invalid generated id counter');
  for (const id of ids) {
    const match = /^puddle-(\d+)$/.exec(id);
    if (match && Number.isSafeInteger(+match[1])) nextId = Math.max(nextId, +match[1] + 1);
  }
  if (!Number.isSafeInteger(nextId)) throw new RangeError('Generated id counter exhausted');
  return { pools, ledger, nextId,activeOrder:[...activeOrder],hotOrder:[...hotOrder] };
}
