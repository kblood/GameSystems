import { registry, positive, finite, extension, tierState } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

// Resistive DC networks with ideal sources and finite batteries with series resistance, solved by MNA.
function solve(matrix, rhs) {
  const a = matrix.map((r, i) => [...r, rhs[i]]), n = rhs.length;
  for (let c = 0; c < n; c++) {
    let pivot = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) throw new Error('Inconsistent or singular circuit');
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const divisor = a[c][c]; for (let k = c; k <= n; k++) a[c][k] /= divisor;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map(r => r[n]);
}
export function createElectricitySystem({ emit = () => {}, quality = 'high', maxComponents = 256, maxNodes = 128 } = {}) {
  for (const n of [maxComponents,maxNodes]) if(!Number.isSafeInteger(n)||n<1)throw new RangeError('Circuit budgets must be positive integers');
  const store = registry(), tiers = tierState(quality); let dirty = true, disposed = false, phase = null;
  function live(){if(disposed)throw new Error('System is disposed');}
  function idle(operation){if(phase!==null)throw new Error(`Cannot ${operation} during electricity ${phase}`);}
  let api;
  function energy(id,wh,charging){
    live();idle(charging?'charge battery':'draw battery');positive(wh,'Wh',true);const c=store.get(id);if(c.kind!=='battery')throw new Error('Not a battery');
    const actual=c.enabled?Math.min(wh,charging?c.capacityWh-c.energyWh:c.energyWh):0;
    c.energyWh+=charging?actual:-actual;c[charging?'chargedWh':'suppliedWh']+=actual;dirty=true;return actual;
  }
  function runEvaluate(silent=false, owner=null, deferObserverError=null) {
    live();if(phase!==null&&phase!==owner)throw new Error(`Cannot evaluate during electricity ${phase}`);
    const previous=phase;phase='evaluate';
    try {
      let observerFailure,observerFailed=false;
      const publish=silent?()=>{}:(...args)=>{try{emit(...args);}catch(error){
        if(deferObserverError)deferObserverError(error);
        else if(!observerFailed){observerFailure=error;observerFailed=true;}
      }};
      // At most one re-solve per fuse, so cascading trips terminate.
      const blocked=new Set();
      for (let pass = 0; pass <= store.entries.size; pass++) {
        const all = [...store.entries.values()], active = all.filter(c => c.enabled && !c.blown&&!blocked.has(c.id));
        for (const c of all) { c.current = 0; c.power = 0; c.volts = 0; }
        const neighbours = new Map();
        for (const c of active) { for (const [a, b] of [[c.a, c.b], [c.b, c.a]]) { if (!neighbours.has(a)) neighbours.set(a, new Set()); neighbours.get(a).add(b); } }
        const seen = new Set(); let fault = null;
        for (const start of neighbours.keys()) {
          if (seen.has(start)) continue;
          const nodes = [], queue = [start]; seen.add(start);
          for (let i = 0; i < queue.length; i++) { const v = queue[i]; nodes.push(v); for (const w of neighbours.get(v)) if (!seen.has(w)) { seen.add(w); queue.push(w); } }
          const nodeSet = new Set(nodes), components = active.filter(c => nodeSet.has(c.a)), sources = components.filter(c => c.kind === 'source'||c.kind==='battery');
          if (!sources.length) continue;
          const ground = sources[0].b, ids = nodes.filter(v => v !== ground), index = new Map(ids.map((v, i) => [v, i])), n = ids.length + sources.length;
          const matrix = Array.from({ length: n }, () => Array(n).fill(0)), rhs = Array(n).fill(0);
          const stamp = (i, j, value) => { if (i !== undefined && j !== undefined) matrix[i][j] += value; };
          for (const c of components) if (!sources.includes(c)) { const a = index.get(c.a), b = index.get(c.b), g = 1 / c.resistance; stamp(a, a, g); stamp(b, b, g); stamp(a, b, -g); stamp(b, a, -g); }
          sources.forEach((c, k) => { const a = index.get(c.a), b = index.get(c.b), s = ids.length + k; stamp(a, s, 1); stamp(s, a, 1); stamp(b, s, -1); stamp(s, b, -1); if(c.kind==='battery')matrix[s][s]=-c.resistance;rhs[s] = c.voltage; });
          try {
            const values = solve(matrix, rhs); if (!values.every(Number.isFinite)) throw new Error('Numerically unstable circuit');
            const voltageAt = v => v === ground ? 0 : values[index.get(v)];
            for (const c of components) { c.volts = voltageAt(c.a) - voltageAt(c.b); c.current = sources.includes(c) ? values[ids.length + sources.indexOf(c)] : c.volts / c.resistance; c.power = c.volts * c.current; }
          } catch (error) { fault = error.message; publish('electricity:fault', { nodes, message: fault }); }
        }
        const limited=active.filter(c=>c.kind==='battery'&&((c.energyWh<=0&&c.current< -1e-10)||(c.energyWh>=c.capacityWh&&c.current>1e-10)));
        // Remove depleted driving sources before deciding whether a full battery is really charging.
        // Blocking all limits at once can strand charged lower-voltage batteries after a higher one empties.
        if(limited.length){limited.sort((a,b)=>{
          const emptyA=a.energyWh<=0,emptyB=b.energyWh<=0;
          return emptyA!==emptyB?(emptyA?-1:1):emptyA?b.voltage-a.voltage:a.voltage-b.voltage;
        });blocked.add(limited[0].id);continue;}
        const tripped = active.filter(c => c.kind === 'fuse' && Math.abs(c.current) > c.rating);
        for (const c of tripped) { c.blown = true; publish('electricity:fuse-blown', { id: c.id, current: c.current, rating: c.rating }); }
        if(tripped.length)continue;
        dirty = false;
        for (const c of all) publish('electricity:changed', { ...c });
        const result={ fault, components: all.map(c => ({ ...c })) };
        if(observerFailed)throw observerFailure;
        return result;
      }
      throw new Error('Circuit did not converge');
    } finally { phase=previous; }
  }
  api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    add(id, { kind = 'load', a, b, resistance = kind==='battery'?.08:10, voltage = 12, enabled = true, rating = 2, capacityWh = 600, energyWh = capacityWh } = {}) {
      live();idle('add component');if(store.entries.size>=maxComponents)throw new RangeError('Circuit component budget exceeded');
      if (!['source', 'battery', 'wire', 'switch', 'fuse', 'load'].includes(kind)) throw new RangeError('Unknown component');
      if (typeof a !== 'string' || !a || typeof b !== 'string' || !b || a === b) throw new Error('Distinct terminal ids required');
      if(new Set([...store.entries.values()].flatMap(c=>[c.a,c.b]).concat(a,b)).size>maxNodes)throw new RangeError('Circuit node budget exceeded');
      if(kind==='battery'){positive(capacityWh,'capacityWh');positive(energyWh,'energyWh',true);positive(voltage,'voltage');if(energyWh>capacityWh)throw new RangeError('Battery energy exceeds capacity');}
      store.add(id, { id, kind, a, b, resistance: positive(resistance, 'resistance'), voltage: finite(voltage), enabled: !!enabled,
        rating: positive(rating, 'rating'), blown: false, current: 0, power: 0, volts: 0,
        ...(kind==='battery'?{capacityWh,energyWh,initialWh:energyWh,chargedWh:0,suppliedWh:0}:{} ) }); dirty = true; return api.state(id);
    },
    state(id) { live();return { ...store.get(id) }; },
    all(){live();return [...store.entries.keys()].map(id=>api.state(id));},
    setEnabled(id, value) { live();idle('change component');const c=store.get(id),enabled=!!value;if(c.enabled!==enabled){c.enabled=enabled;dirty=true;} },
    configure(id, changes={}){
      live();idle('configure component');const c=store.get(id),next={...c};
      for(const key of Object.keys(changes))if(!['resistance','voltage','rating','enabled'].includes(key))throw new Error(`Cannot configure ${key}`);
      if('resistance'in changes)next.resistance=positive(changes.resistance,'resistance');
      if('voltage'in changes)next.voltage=c.kind==='battery'?positive(changes.voltage,'voltage'):finite(changes.voltage,'voltage');
      if('rating'in changes)next.rating=positive(changes.rating,'rating');
      if('enabled'in changes)next.enabled=booleanState(changes.enabled);
      Object.assign(c,next);dirty=true;return api.state(id);
    },
    charge(id,wh){return energy(id,wh,true);},draw(id,wh){return energy(id,wh,false);},
    batteryAdapter(id){
      if(api.state(id).kind!=='battery')throw new Error('Not a battery');
      return {reversible:true,state(){const c=api.state(id);return {...c,voltage:c.enabled&&c.energyWh>0?c.voltage:0};},draw:wh=>api.draw(id,wh),charge:wh=>api.charge(id,wh)};
    },
    replaceFuse(id) { live();idle('replace fuse');const c = store.get(id); if (c.kind !== 'fuse') throw new Error('Not a fuse'); c.blown = false; dirty = true; },
    remove(id) { live();idle('remove component');dirty = true; return store.remove(id); },
    step(dt = 0) {
      live();idle('step');positive(dt,'dt',true);if(dt>10)throw new RangeError('Circuit update exceeds catch-up budget');
      phase='step';
      try {
      let failure,failed=false;
      const rememberObserverError=error=>{if(!failed){failure=error;failed=true;}};
      if(dirty)runEvaluate(false,'step',rememberObserverError);
      const energyJ=Object.create(null);let remaining=dt;
      // A battery may first fill from a higher source, then discharge after that source depletes.
      for(let pass=0;remaining>1e-10&&pass<=2*store.entries.size;pass++){
        const all=[...store.entries.values()],batteries=all.filter(c=>c.kind==='battery'&&c.enabled&&Math.abs(c.current)>1e-10);
        let seconds=remaining;
        for(const b of batteries){const chemicalW=b.voltage*b.current;const available=chemicalW<0?b.energyWh:b.capacityWh-b.energyWh;seconds=Math.min(seconds,available*3600/Math.abs(chemicalW));}
        if(seconds<=0){dirty=true;runEvaluate(false,'step',rememberObserverError);continue;}
        for(const c of all)energyJ[c.id]=(energyJ[c.id]??0)+c.power*seconds;
        for(const b of batteries){const wh=b.voltage*b.current*seconds/3600;
          if(wh<0){b.energyWh=Math.max(0,b.energyWh+wh);b.suppliedWh-=wh;}else{b.energyWh=Math.min(b.capacityWh,b.energyWh+wh);b.chargedWh+=wh;}
          if(b.energyWh<1e-12)b.energyWh=0;if(b.capacityWh-b.energyWh<1e-12)b.energyWh=b.capacityWh;
        }
        remaining=Math.max(0,remaining-seconds);
        if(remaining>1e-10||batteries.some(b=>b.energyWh===0||b.energyWh===b.capacityWh)){dirty=true;runEvaluate(false,'step',rememberObserverError);}
      }
      if(remaining>1e-8)throw new Error('Battery boundary solver did not converge');
      const result={seconds:dt,energyJ:{...energyJ}};
      // An observer may retain or edit its payload; the caller's receipt remains authoritative.
      try{emit('electricity:energy',{seconds:result.seconds,energyJ:{...result.energyJ}});}catch(error){rememberObserverError(error);}
      if(failed)throw failure;
      return result;
      } finally { phase=null; }
    },
    evaluate({silent=false}={}) { live();idle('evaluate');return runEvaluate(silent,null); },
    capture(){live();idle('capture');return {schema:'gamesystems.electricity.v1',components:api.all()};},
    prepareRestore(raw){
      live();idle('prepare restore');const data=jsonState(raw);if(data.schema!=='gamesystems.electricity.v1'||!Array.isArray(data.components)||data.components.length!==store.entries.size)throw new Error('Circuit topology differs');
      const staged=new Map();for(const saved of data.components){const c=store.get(saved.id);if(staged.has(saved.id)||saved.kind!==c.kind||saved.a!==c.a||saved.b!==c.b)throw new Error('Circuit topology differs');
        const next={...c,resistance:positive(saved.resistance,'resistance'),voltage:c.kind==='battery'?positive(saved.voltage,'voltage'):finite(saved.voltage),rating:positive(saved.rating,'rating'),enabled:booleanState(saved.enabled),blown:booleanState(saved.blown),current:0,volts:0,power:0};
        if(next.blown&&c.kind!=='fuse')throw new Error('Only fuses can be blown');
        if(c.kind==='battery'){if(saved.capacityWh!==c.capacityWh||saved.initialWh!==c.initialWh)throw new Error('Battery topology differs');
          for(const key of ['energyWh','chargedWh','suppliedWh'])next[key]=positive(saved[key],key,true);
          if(next.energyWh>c.capacityWh||Math.abs(c.initialWh+next.chargedWh-next.suppliedWh-next.energyWh)>1e-7)throw new Error('Battery ledger does not balance');
        }staged.set(c.id,next);
      }
      return {
        commit(){
          live();idle('commit restore');phase='restore';
          try { for(const[id,c]of staged)store.entries.set(id,{...c});dirty=true;runEvaluate(true,'restore'); }
          finally { phase=null; }
        },
        notify(){live();idle('notify restore');api.evaluate();},
      };
    },
    restore(raw){const plan=api.prepareRestore(raw);plan.commit();plan.notify();},
    dispose() { if(disposed)return;idle('dispose');disposed = true; store.dispose(); },
  };
  return api;
}
export default options => extension('electricity', createElectricitySystem, options);
