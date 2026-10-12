import { registry, positive, finite, vector, distance, tierState, SYSTEM_TIERS } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

// Bounded 10 Hz gameplay simulation; no airflow or hydraulic pressure simulation.
export function createSprinklerSystem({ supply, thermal, emit = () => {}, powered = () => true, powerFraction = null, quality = 'high', maxHeads = 256 } = {}) {
  if (!supply?.draw || !supply?.state || !thermal?.objects || !thermal?.water) throw new TypeError('Sprinklers require supply and thermal public APIs');
  positive(maxHeads, 'maxHeads'); if (!Number.isSafeInteger(maxHeads)) throw new RangeError('maxHeads must be integer');
  if(powerFraction!==null&&typeof powerFraction!=='function')throw new TypeError('powerFraction must be a function');
  const heads = registry(), tiers = tierState(quality); let pending = 0, disposed = false, stepping = false, restoring = false;
  function live() { if (disposed) throw new Error('System is disposed'); }
  function idle(operation) { if (stepping || restoring) throw new Error(`Cannot ${operation} during a sprinkler step or restore`); }
  function publish(id) { emit('sprinklers:changed', api.state(id)); }
  function targets(head, objects) {
    return objects.filter(s => s.roomId === head.roomId && s.position[1] <= head.position[1] && distance(s.position, head.position) <= head.radius);
  }
  class RetryableTickError {
    constructor(error) { this.error = error; }
  }
  function tick(dt) {
    let observerFailed = false, observerError;
    const publishTickEvent = (name, payload) => {
      try { emit(name, payload); }
      catch (error) { if (!observerFailed) { observerFailed = true; observerError = error; } }
    };
    const staged = [], groups = new Map(), requests = [];
    const objects = thermal.objects();
    for (const head of heads.entries.values()) {
      const nearby = targets(head, objects);
      const sensed = Math.max(20, head.roomId === null ? 20 : thermal.roomState(head.roomId).temperature, ...nearby.map(s => s.temperature));
      const temperature = head.temperature + (sensed - head.temperature) * (1 - Math.exp(-dt / head.responseSeconds));
      const triggered = head.triggered || temperature >= head.triggerTemperature;
      staged.push({ head, temperature, triggered, newlyTriggered: triggered && !head.triggered });
      if (!triggered || !head.open) continue;
      let hasPower;
      try { hasPower = powered(head.id); }
      catch (error) {
        // Only this read-only gate is replay-safe; other providers may have
        // advanced their own simulation or resource ledgers before throwing.
        throw new RetryableTickError(error);
      }
      if (!hasPower) continue;
      if (!groups.has(head.tankId)) groups.set(head.tankId, []);
      groups.get(head.tankId).push({ head, nearby, demand: head.rateMlPerSecond * dt });
    }
    for(const[tankId,entries]of groups){const requested=entries.reduce((n,e)=>n+e.demand,0),available=supply.state(tankId).ml;const fraction=requested?Math.min(1,available/requested):0;
      for(const entry of entries){const nominalMl=entry.demand;entry.demand*=fraction;requests.push({id:entry.head.id,tankId,ml:entry.demand,nominalMl});}
    }
    // A pump may advance its energy ledger before this callback throws. Once
    // invoked, consume the phase even when its result cannot be committed.
    const fraction=powerFraction===null?1:finite(powerFraction(requests,dt),'power fraction');
    if(fraction<0||fraction>1)throw new RangeError('Power fraction must be between zero and one');
    for (const { head, temperature, triggered } of staged) {
      head.temperature = temperature; head.triggered = triggered; head.flowMlPerSecond = 0;
    }
    for (const { head, newlyTriggered } of staged) {
      if (newlyTriggered) publishTickEvent('sprinklers:triggered', { id: head.id });
    }
    for (const [tankId, entries] of groups) {
      for(const entry of entries)entry.demand*=fraction;
      const demand = entries.reduce((n, e) => n + e.demand, 0), out = supply.draw(tankId, demand);
      for (const { head, nearby, demand: requested } of entries) {
        const fraction = demand ? requested / demand : 0, ml = out.ml * fraction;
        if (!ml) continue;
        const components = Object.fromEntries(Object.entries(out.components).map(([kind, amount]) => [kind, amount * fraction]));
        const waterMl = components.water ?? 0;
        // Spray coverage is a gameplay effect, not a CFD/droplet collision model.
        // Pools own their wetness through liquid:deposit below; cooling them here
        // as well would apply one sprinkler dose twice.
        const poolTargets = nearby.filter(target => target.id.startsWith('pool:'));
        const nonPoolTargets = nearby.filter(target => !target.id.startsWith('pool:'));
        for (const target of nonPoolTargets) if (waterMl) thermal.water(target.id, waterMl / Math.max(1, nearby.length));
        head.deliveredMl += ml; head.flowMlPerSecond = ml / dt;
        const event = { id: head.id, ml, components, sourceKey: `sprinkler:${head.id}`, roomId: head.roomId,
          surfaceId: head.surfaceId, position: [head.position[0], head.floorY, head.position[2]], targets: nearby.map(s => s.id) };
        publishTickEvent('sprinklers:spray', event);
        // Pools in spray range receive an even share directly. This lets a
        // sprinkler reach a burning puddle without requiring its floor impact
        // point to fall inside the pool merge radius. Otherwise the spray forms
        // the usual persistent puddle beneath the head.
        if (poolTargets.length) {
          const targetShare = 1 / Math.max(1, nearby.length);
          for (const target of poolTargets) {
            const share = Object.fromEntries(Object.entries(components).map(([kind, amount]) => [kind, amount * targetShare]));
            const deposit = { ...event, id: target.id.slice('pool:'.length), ml: Object.values(share).reduce((sum, amount) => sum + amount, 0),
              components: share, emitterId: head.id };
            delete deposit.position;
            delete deposit.surfaceId;
            delete deposit.roomId;
            delete deposit.targets;
            publishTickEvent('liquid:deposit', deposit);
          }
          if (nonPoolTargets.length) {
            const remainder = Object.fromEntries(Object.entries(components).map(([kind, amount]) => [kind, amount * nonPoolTargets.length * targetShare]));
            const deposit = { ...event, ml: Object.values(remainder).reduce((sum, amount) => sum + amount, 0),
              components: remainder, emitterId: head.id };
            delete deposit.id;
            publishTickEvent('liquid:deposit', deposit);
          }
        } else {
          // `id` belongs to the sprinkler head; pools interpret `id` as an
          // explicit pool record. Preserve emitter identity separately.
          const deposit = { ...event, emitterId: head.id };
          delete deposit.id;
          publishTickEvent('liquid:deposit', deposit);
        }
      }
    }
    for (const id of heads.entries.keys()) publishTickEvent('sprinklers:changed', api.state(id));
    // Finish every event/deposit in the tick before surfacing an observer fault;
    // callers can safely checkpoint afterward without capturing a half-tick.
    if (observerFailed) throw observerError;
  }
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    add(id, { tankId, position = [0, 2.5, 0], roomId = null, surfaceId = 'ground', floorY = 0, radius = 4,
      rateMlPerSecond = 250, triggerTemperature = 68, responseSeconds = 2, open = true } = {}) {
      live(); idle('add head'); if (heads.entries.size >= maxHeads) throw new RangeError('Sprinkler head budget exceeded');
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
    setOpen(id, value) { live(); idle('change valve'); heads.get(id).open = booleanState(value); publish(id); },
    trigger(id) { live(); idle('trigger head'); heads.get(id).triggered = true; publish(id); },
    reset(id) { live(); idle('reset head'); const h = heads.get(id); h.triggered = false; h.temperature = 20; h.flowMlPerSecond = 0; publish(id); },
    step(dt) {
      live(); idle('step'); positive(dt, 'dt', true);
      if (dt > 10) throw new RangeError('Sprinkler update exceeds catch-up budget');
      stepping = true;
      try {
        pending += dt;
        while (pending >= 0.1 - 1e-9) {
          const previousPending = pending;
          pending = Math.max(0, pending - 0.1);
          // Consume the phase before invoking host callbacks. If a listener
          // throws after a supply draw, retrying this same step could debit it twice.
          try { tick(0.1); }
          catch (error) {
            if (error instanceof RetryableTickError) {
              pending = previousPending;
              throw error.error;
            }
            throw error;
          }
        }
      } finally { stepping = false; }
    },
    capture() {
      live(); idle('capture');
      if (pending >= 0.1 - 1e-9) throw new Error('Cannot capture with unprocessed sprinkler steps');
      return { schema: 'gamesystems.sprinklers.v1', pending, heads: api.all() };
    },
    prepareRestore(raw) {
      live(); idle('prepare restore'); const data = jsonState(raw);
      if (data.schema !== 'gamesystems.sprinklers.v1' || !Array.isArray(data.heads) || data.heads.length !== heads.entries.size) throw new Error('Sprinkler topology differs');
      positive(data.pending, 'pending', true); if (data.pending >= 0.1 - 1e-9) throw new RangeError('Invalid sprinkler phase');
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
      return {
        commit() {
          live(); idle('commit restore'); restoring = true;
          try { pending = data.pending; for (const [id, h] of staged) heads.entries.set(id, { ...h, position: [...h.position] }); }
          finally { restoring = false; }
        },
        notify() {
          live(); idle('notify restore'); restoring = true;
          try { for (const id of staged.keys()) publish(id); }
          finally { restoring = false; }
        },
      };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { if (disposed) return; idle('dispose'); disposed = true; heads.dispose(); },
  };
  return api;
}
export default function sprinklersExtension(options = {}) {
  let api;
  return { id: 'sprinklers', requires: ['supply', 'thermal'], quality: SYSTEM_TIERS,
    init(ctx) { api = createSprinklerSystem({ ...options, supply: ctx.get('supply'), thermal: ctx.get('thermal'), emit: ctx.emit, quality: ctx.quality }); return api; },
    update(dt) { api.step(dt); }, setQuality(tier) { api.setQuality(tier); }, dispose() { api?.dispose(); } };
}
