import { registry, positive, finite, vector, distance, tierState, SYSTEM_TIERS } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

// Bounded 10 Hz gameplay simulation; no airflow or hydraulic pressure simulation.
export function createSprinklerSystem({ supply, thermal, emit = () => {}, powered = () => true, powerFraction = null, quality = 'high', maxHeads = 256 } = {}) {
  if (!supply?.draw || !supply?.state || !thermal?.objects || !thermal?.water) throw new TypeError('Sprinklers require supply and thermal public APIs');
  positive(maxHeads, 'maxHeads'); if (!Number.isSafeInteger(maxHeads)) throw new RangeError('maxHeads must be integer');
  if(powerFraction!==null&&typeof powerFraction!=='function')throw new TypeError('powerFraction must be a function');
  const heads = registry(), tiers = tierState(quality); let pending = 0, disposed = false;
  function live() { if (disposed) throw new Error('System is disposed'); }
  function publish(id) { emit('sprinklers:changed', api.state(id)); }
  function targets(head, objects) {
    return objects.filter(s => s.roomId === head.roomId && s.position[1] <= head.position[1] && distance(s.position, head.position) <= head.radius);
  }
  function tick(dt) {
    const objects = thermal.objects(), groups = new Map();
    for (const head of heads.entries.values()) {
      const nearby = targets(head, objects);
      const sensed = Math.max(20, head.roomId === null ? 20 : thermal.roomState(head.roomId).temperature, ...nearby.map(s => s.temperature));
      head.temperature += (sensed - head.temperature) * (1 - Math.exp(-dt / head.responseSeconds));
      if (!head.triggered && head.temperature >= head.triggerTemperature) { head.triggered = true; emit('sprinklers:triggered', { id: head.id }); }
      head.flowMlPerSecond = 0;
      if (!head.triggered || !head.open || !powered(head.id)) continue;
      if (!groups.has(head.tankId)) groups.set(head.tankId, []);
      groups.get(head.tankId).push({ head, nearby, demand: head.rateMlPerSecond * dt });
    }
    const requests=[];
    for(const[tankId,entries]of groups){const requested=entries.reduce((n,e)=>n+e.demand,0),available=supply.state(tankId).ml;const fraction=requested?Math.min(1,available/requested):0;
      for(const entry of entries){const nominalMl=entry.demand;entry.demand*=fraction;requests.push({id:entry.head.id,tankId,ml:entry.demand,nominalMl});}
    }
    const fraction=powerFraction===null?1:finite(powerFraction(requests,dt),'power fraction');
    if(fraction<0||fraction>1)throw new RangeError('Power fraction must be between zero and one');
    for (const [tankId, entries] of groups) {
      for(const entry of entries)entry.demand*=fraction;
      const demand = entries.reduce((n, e) => n + e.demand, 0), out = supply.draw(tankId, demand);
      for (const { head, nearby, demand: requested } of entries) {
        const fraction = demand ? requested / demand : 0, ml = out.ml * fraction;
        if (!ml) continue;
        const components = Object.fromEntries(Object.entries(out.components).map(([kind, amount]) => [kind, amount * fraction]));
        const waterMl = components.water ?? 0;
        // Spray coverage is a gameplay effect, not a CFD/droplet collision model.
        for (const target of nearby) if (waterMl) thermal.water(target.id, waterMl / nearby.length);
        head.deliveredMl += ml; head.flowMlPerSecond = ml / dt;
        const event = { id: head.id, ml, components, sourceKey: `sprinkler:${head.id}`, roomId: head.roomId,
          surfaceId: head.surfaceId, position: [head.position[0], head.floorY, head.position[2]], targets: nearby.map(s => s.id) };
        emit('sprinklers:spray', event);
        emit('liquid:deposit', event);
      }
    }
    for (const id of heads.entries.keys()) publish(id);
  }
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    add(id, { tankId, position = [0, 2.5, 0], roomId = null, surfaceId = 'ground', floorY = 0, radius = 4,
      rateMlPerSecond = 250, triggerTemperature = 68, responseSeconds = 2, open = true } = {}) {
      live(); if (heads.entries.size >= maxHeads) throw new RangeError('Sprinkler head budget exceeded');
      supply.state(tankId); if (roomId !== null) thermal.roomState(roomId); position = vector(position);
      if (typeof surfaceId !== 'string' || !surfaceId) throw new TypeError('Surface id required');
      finite(floorY); if (floorY > position[1]) throw new RangeError('Floor above sprinkler');
      positive(radius); positive(rateMlPerSecond); finite(triggerTemperature); positive(responseSeconds);
      heads.add(id, { id, tankId, position, roomId, surfaceId, floorY, radius, rateMlPerSecond, triggerTemperature,
        responseSeconds, open: booleanState(open), triggered: false, temperature: 20, deliveredMl: 0, flowMlPerSecond: 0 });
      publish(id); return api.state(id);
    },
    state(id) { live(); const head = heads.get(id); return { ...head, position: [...head.position] }; },
    all() { live(); return [...heads.entries.keys()].map(id => api.state(id)); },
    setOpen(id, value) { live(); heads.get(id).open = booleanState(value); publish(id); },
    trigger(id) { live(); heads.get(id).triggered = true; publish(id); },
    reset(id) { live(); const h = heads.get(id); h.triggered = false; h.temperature = 20; h.flowMlPerSecond = 0; publish(id); },
    step(dt) {
      live(); positive(dt, 'dt', true);
      if (dt > 10) throw new RangeError('Sprinkler update exceeds catch-up budget');
      pending += dt;
      while (pending >= 0.1 - 1e-9) { pending = Math.max(0, pending - 0.1); tick(0.1); }
    },
    capture() { return { schema: 'gamesystems.sprinklers.v1', pending, heads: api.all() }; },
    prepareRestore(raw) {
      live(); const data = jsonState(raw);
      if (data.schema !== 'gamesystems.sprinklers.v1' || !Array.isArray(data.heads) || data.heads.length !== heads.entries.size) throw new Error('Sprinkler topology differs');
      positive(data.pending, 'pending', true); if (data.pending >= 0.1) throw new RangeError('Invalid sprinkler phase');
      const staged = new Map(), dynamic = new Set(['temperature', 'open', 'triggered', 'deliveredMl', 'flowMlPerSecond']);
      for (const saved of data.heads) {
        const current = api.state(saved.id); if (staged.has(saved.id)) throw new Error('Duplicate sprinkler');
        for (const key of Object.keys(current)) if (!dynamic.has(key) && JSON.stringify(saved[key]) !== JSON.stringify(current[key])) throw new Error('Sprinkler topology differs');
        finite(saved.temperature); booleanState(saved.open); booleanState(saved.triggered);
        positive(saved.deliveredMl, 'deliveredMl', true); positive(saved.flowMlPerSecond, 'flowMlPerSecond', true);
        if (saved.flowMlPerSecond > current.rateMlPerSecond + 1e-6) throw new RangeError('Invalid sprinkler flow');
        staged.set(saved.id, { ...current, temperature: saved.temperature, open: saved.open, triggered: saved.triggered,
          deliveredMl: saved.deliveredMl, flowMlPerSecond: saved.flowMlPerSecond });
      }
      return { commit() { live(); pending = data.pending; for (const [id, h] of staged) heads.entries.set(id, { ...h, position: [...h.position] }); }, notify() { for (const id of staged.keys()) publish(id); } };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { if (disposed) return; disposed = true; heads.dispose(); },
  };
  return api;
}
export default function sprinklersExtension(options = {}) {
  let api;
  return { id: 'sprinklers', requires: ['supply', 'thermal'], quality: SYSTEM_TIERS,
    init(ctx) { api = createSprinklerSystem({ ...options, supply: ctx.get('supply'), thermal: ctx.get('thermal'), emit: ctx.emit, quality: ctx.quality }); return api; },
    update(dt) { api.step(dt); }, setQuality(tier) { api.setQuality(tier); }, dispose() { api?.dispose(); } };
}
