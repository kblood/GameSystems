import { jsonState, stateId } from '../host/state.js';
import { SYSTEM_TIERS } from '../host/system.js';

// Engine-independent orchestration. Providers own validation and silent mutation; storage belongs to the caller.
export function createCheckpointSystem({ sceneId, emit = () => {}, maxBytes = 2 * 1024 * 1024 } = {}) {
  stateId(sceneId, 'sceneId');if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new RangeError('Invalid checkpoint byte budget');const providers = new Map(); let disposed = false, busy = false;
  const live = () => { if (disposed) throw new Error('Checkpoint system is disposed'); if (busy) throw new Error('Checkpoint operation is reentrant'); };
  function capture() {
    const state = Object.fromEntries([...providers].map(([id, provider]) => [id, provider.capture()]));
    return jsonState({ schema: 'gamesystems.checkpoint.v1', sceneId, state }, { maxBytes });
  }
  function validate(snapshot) {
    const data = jsonState(snapshot, { maxBytes });
    if (data.schema !== 'gamesystems.checkpoint.v1' || data.sceneId !== sceneId || !data.state || Array.isArray(data.state)) throw new Error('Checkpoint belongs to another scene or schema');
    const keys = Object.keys(data.state);
    if (keys.length !== providers.size || keys.some(id => !providers.has(id))) throw new Error('Checkpoint providers do not match');
    return data;
  }
  const api = {
    register(id, provider) {
      live(); stateId(id);
      if (providers.has(id) || typeof provider?.capture !== 'function' || typeof provider?.prepareRestore !== 'function') throw new Error('Invalid/duplicate checkpoint provider');
      if([provider.capture,provider.prepareRestore].some(fn=>fn.constructor?.name==='AsyncFunction'))throw new TypeError('Checkpoint providers must be synchronous');
      providers.set(id, provider); return () => {live();return providers.delete(id);};
    },
    capture() { live(); busy = true; try { return capture(); } finally { busy = false; } },
    restore(snapshot) {
      live(); busy = true;
      const plans = [], rollbacks = []; let committing = false;
      try {
        const data = validate(snapshot), before = capture();
        for (const [id, provider] of providers) {
          const plan = provider.prepareRestore(data.state[id]);
          if (typeof plan?.commit !== 'function') throw new TypeError(`Invalid restore plan: ${id}`);
          if(plan.commit.constructor?.name==='AsyncFunction')throw new TypeError('Checkpoint commits must be synchronous');
          plans.push(plan);
          const rollback = provider.prepareRestore(before.state[id]);
          if (typeof rollback?.commit !== 'function') throw new TypeError(`Invalid rollback plan: ${id}`);
          rollbacks.push(rollback);
        }
        committing = true;
        for (const plan of plans) plan.commit();
        const observerErrors = [];
        for (const plan of plans) { try { plan.notify?.(); } catch (e) { observerErrors.push(e.message); } }
        try {emit('checkpoint:restored', { sceneId, observerErrors });}catch(e){observerErrors.push(e.message);}
        return { restored: true, observerErrors };
      } catch (error) {
        if (committing) {
          const failures = [];
          for (const plan of [...rollbacks].reverse()) { try { plan.commit(); } catch (e) { failures.push(e); } }
          if (failures.length) throw new AggregateError([error, ...failures], 'Checkpoint failed and rollback was incomplete');
        }
        throw error;
      } finally {
        try {for (const plan of [...plans, ...rollbacks]) {try {plan.dispose?.();}catch(e){try{emit('checkpoint:cleanup-error',{sceneId,message:e.message});}catch{}}}}finally{busy=false;}
      }
    },
    encode(snapshot = api.capture()) { return JSON.stringify(validate(snapshot)); },
    decode(text) { if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw new RangeError('Checkpoint text exceeds budget'); return validate(JSON.parse(text)); },
    dispose() { if(disposed)return;live();disposed = true; providers.clear(); },
  };
  return api;
}

export default function checkpointExtension(options={}){let api;return {id:'checkpoint',quality:SYSTEM_TIERS,init(ctx){api=createCheckpointSystem({...options,emit:ctx.emit});return api;},dispose(){api?.dispose();}};}
