import { registry, positive, finite, clamp, vector, extension, tierState } from '../host/system.js';
import {jsonState,booleanState,stateId} from '../host/state.js';

// Engine-independent, finite-resource vehicle gameplay. Distance m, time s, fuel L, energy Wh.
export const VEHICLE_PARTS = Object.freeze({
  door_fl: { node: 'Door_FL', axis: [0, 1, 0], angle: 1.18 },
  door_fr: { node: 'Door_FR', axis: [0, 1, 0], angle: -1.18 },
  door_rl: { node: 'Door_RL', axis: [0, 1, 0], angle: 1.18 },
  door_rr: { node: 'Door_RR', axis: [0, 1, 0], angle: -1.18 },
  hood: { node: 'Hood', axis: [1, 0, 0], angle: -1.10 },
  trunk: { node: 'Trunk', axis: [1, 0, 0], angle: 1.18 },
  fuel_flap: { node: 'FuelFlap', axis: [0, 1, 0], angle: -1.40 },
});

export function createFuelStore({ capacityL = 52, amountL = 28, kind = 'petrol' } = {}) {
  positive(capacityL, 'capacityL'); positive(amountL, 'amountL', true);
  if (amountL > capacityL) throw new RangeError('Fuel exceeds capacity');
  if (typeof kind !== 'string' || !kind) throw new TypeError('Fuel kind required');
  const api={ reversible: true,
    state: () => ({ amountL, capacityL, kind }),
    consume(liters) { positive(liters, 'liters', true); const taken = Math.min(liters, amountL); amountL -= taken; return taken; },
    refill(liters, incoming = kind) { positive(liters, 'liters', true); if (incoming !== kind) return 0; const taken = Math.min(liters, capacityL - amountL); amountL += taken; return taken; },
    capture(){return {schema:'gamesystems.vehicle-fuel.v1',capacityL,amountL,kind};},
    prepareRestore(raw){const d=jsonState(raw);if(d.schema!=='gamesystems.vehicle-fuel.v1'||d.capacityL!==capacityL||d.kind!==kind)throw new Error('Fuel store differs');positive(d.amountL,'amountL',true);if(d.amountL>capacityL)throw new RangeError('Fuel exceeds capacity');return {state:()=>({capacityL,amountL:d.amountL,kind}),commit(){amountL=d.amountL;}};},
  };
  return api;
}
export function createBatteryStore({ capacityWh = 720, energyWh = 540, voltage = 12.6, enabled = true } = {}) {
  positive(capacityWh, 'capacityWh'); positive(energyWh, 'energyWh', true); positive(voltage, 'voltage');
  if (energyWh > capacityWh) throw new RangeError('Energy exceeds capacity');
  const api={ reversible: true,
    state: () => ({ energyWh, capacityWh, voltage: enabled && energyWh > 0 ? voltage : 0, enabled }),
    draw(wh) { positive(wh, 'wh', true); const taken = enabled ? Math.min(wh, energyWh) : 0; energyWh -= taken; return taken; },
    charge(wh) { positive(wh, 'wh', true); const taken = enabled ? Math.min(wh, capacityWh - energyWh) : 0; energyWh += taken; return taken; },
    setEnabled(value) { enabled = !!value; },
    capture(){return {schema:'gamesystems.vehicle-battery.v1',capacityWh,energyWh,voltage,enabled};},
    prepareRestore(raw){const d=jsonState(raw);if(d.schema!=='gamesystems.vehicle-battery.v1'||d.capacityWh!==capacityWh||d.voltage!==voltage)throw new Error('Battery store differs');positive(d.energyWh,'energyWh',true);booleanState(d.enabled);if(d.energyWh>capacityWh)throw new RangeError('Battery energy exceeds capacity');return {state:()=>({capacityWh,energyWh:d.energyWh,voltage:d.enabled&&d.energyWh>0?voltage:0,enabled:d.enabled}),commit(){energyWh=d.energyWh;enabled=d.enabled;}};},
  };
  return api;
}
function adapter(value, type) {
  const methods = type === 'fuel' ? ['state', 'consume', 'refill'] : ['state', 'draw', 'charge'];
  if (!value || methods.some(name => typeof value[name] !== 'function')) throw new TypeError(`Invalid ${type} adapter`);
  if (value.reversible !== true) throw new TypeError(`Invalid ${type} adapter: reversible transfers must be declared`);
  const s = value.state();
  for (const key of type === 'fuel' ? ['amountL', 'capacityL'] : ['energyWh', 'capacityWh', 'voltage']) positive(s[key], key, true);
  return value;
}
function transfer(source, method, amount, ...args) {
  if (!amount) return 0;
  const actual = source[method](amount, ...args);
  if (!Number.isFinite(actual) || actual < 0 || actual > amount + 1e-8) throw new RangeError(`Adapter ${method} returned invalid quantity`);
  return clamp(actual, 0, amount);
}
function modes(current, next) {
  const out = { ...current };
  for (const key of Object.keys(next)) {
    if (!['fuel', 'power'].includes(key) || !['adapter', 'disabled'].includes(next[key])) throw new RangeError('Modes are fuel/power: adapter or disabled');
    out[key] = next[key];
  }
  return out;
}

// Bounded RK4 bicycle integration; resource accounting remains separate from visual frame size.
function move(s,seconds,force){
  if(seconds<=0)return;const c=s.controls,rolling=.15+9*c.brake+(c.handbrake?13:0),drag=.00036,curve=Math.tan(c.steer*.48)/s.wheelbase;
  const count=Math.min(600,Math.max(1,Math.ceil(seconds*60))),h=seconds/count;
  const arc=t=>{const angle=s.heading+curve*s.speed*t;if(Math.abs(curve)<1e-12){s.position[0]+=Math.sin(s.heading)*s.speed*t;s.position[2]+=Math.cos(s.heading)*s.speed*t;}else{s.position[0]+=(Math.cos(s.heading)-Math.cos(angle))/curve;s.position[2]+=(Math.sin(angle)-Math.sin(s.heading))/curve;}s.heading=angle;s.distanceM+=Math.abs(s.speed*t);s.wheelAngle+=s.speed*t/.34;};
  function integrate(t){
    const sign=Math.sign(s.speed)||Math.sign(force),start=[s.speed,s.heading,s.position[0],s.position[2],s.distanceM,s.wheelAngle];
    const derivative=v=>{const speed=clamp(v[0],-12,58),acceleration=force-sign*(rolling+drag*speed*speed);return [(speed>=58&&acceleration>0)||(speed<=-12&&acceleration<0)?0:acceleration,curve*speed,Math.sin(v[1])*speed,Math.cos(v[1])*speed,Math.abs(speed),speed/.34];};
    const add=(a,k,n)=>a.map((v,i)=>v+k[i]*n),a=derivative(start),b=derivative(add(start,a,t/2)),d=derivative(add(start,b,t/2)),e=derivative(add(start,d,t));
    const end=start.map((v,i)=>v+t*(a[i]+2*b[i]+2*d[i]+e[i])/6);s.speed=clamp(end[0],-12,58);s.heading=end[1];s.position[0]=end[2];s.position[2]=end[3];s.distanceM=end[4];s.wheelAngle=end[5];
  }
  for(let i=0;i<count;i++){
    if(!s.speed&&Math.abs(force)<=rolling)break;
    if((s.speed===58&&force>=rolling+drag*58**2)||(s.speed===-12&&force<=-rolling-drag*12**2)){arc(seconds-i*h);break;}
    const sign=Math.sign(s.speed),opposition=rolling-sign*force;
    const stopTime=sign&&opposition>0?Math.atan(Math.abs(s.speed)*Math.sqrt(drag/opposition))/Math.sqrt(drag*opposition):Infinity;
    const first=Math.min(h,stopTime);integrate(first);
    if(stopTime<=h){s.speed=0;if(h-first>1e-12&&Math.abs(force)>rolling)integrate(h-first);}
  }
}

export function createVehicleSystem({ emit = () => {}, quality = 'high' } = {}) {
  const store = registry(), bindings=new Map(),tiers = tierState(quality); let disposed = false;
  function alive() { if (disposed) throw new Error('System is disposed'); }
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    registerAdapters(key,pair){alive();stateId(key,'adapter key');if(bindings.has(key))throw new Error('Duplicate adapter key');const fuel=adapter(pair.fuel,'fuel'),power=adapter(pair.power,'power');bindings.set(key,{fuel,power});},
    bindAdapters(id,key){alive();const pair=bindings.get(key);if(!pair)throw new Error('Unknown adapter key');const s=store.get(id);Object.assign(s,pair,{adapterKey:key,owned:false});return api.state(id);},
    add(id, options = {}) {
      alive();if(options.adapterKey!==undefined){const pair=bindings.get(options.adapterKey);if(!pair)throw new Error('Unknown adapter key');options={...options,...pair};}
      const { fuel = createFuelStore(), power = createBatteryStore(), position = [0, 0, 0], heading = 0,
        fuelKind = 'petrol', massKg = 1530, wheelbase = 2.82, idleLps = 0.00022, driveLps = 0.0022,
        starterWh = 0.35, alternatorW = 700, resourceModes = {} } = options;
      if (typeof fuelKind !== 'string' || !fuelKind) throw new TypeError('fuelKind required');
      if (positive(wheelbase, 'wheelbase') < 0.1) throw new RangeError('wheelbase must be at least 0.1 m');
      const owned=options.fuel===undefined&&options.power===undefined;
      const s = { id, fuel: adapter(fuel, 'fuel'), power: adapter(power, 'power'), fuelKind,adapterKey:options.adapterKey??null,
        owned,inlineStores:owned?{fuel,power}:null,
        massKg: positive(massKg), wheelbase: positive(wheelbase), idleLps: positive(idleLps, 'idleLps', true),
        driveLps: positive(driveLps, 'driveLps', true), starterWh: positive(starterWh), alternatorW: positive(alternatorW, 'alternatorW', true),
        modes: modes({ fuel: 'adapter', power: 'adapter' }, resourceModes), position: vector(position), heading: finite(heading),
        running: false, lights: false, electrics: false, speed: 0, distanceM: 0, wheelAngle: 0, rpm: 0,
        controls: { throttle: 0, brake: 0, steer: 0, gear: 1, handbrake: true },
        parts: Object.fromEntries(Object.keys(VEHICLE_PARTS).map(k => [k, { fraction: 0, target: 0, locked: false }])),
        consumedL: 0, spilledL:0,drawnWh: 0, chargedWh: 0, lastStop: null };
      store.add(id, s); return api.state(id);
    },
    state(id) {
      const s = store.get(id);
      return { id, adapterKey:s.adapterKey,running: s.running, lights: s.lights, electrics: s.electrics, speed: s.speed, rpm: s.rpm,
        position: [...s.position], heading: s.heading, distanceM: s.distanceM, wheelAngle: s.wheelAngle,
        controls: { ...s.controls }, parts: Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, { ...v }])),
        fuel: { ...s.fuel.state() }, power: { ...s.power.state() }, modes: { ...s.modes },
        consumedL: s.consumedL,spilledL:s.spilledL,drawnWh: s.drawnWh, chargedWh: s.chargedWh, lastStop: s.lastStop };
    },
    setAdapters(id, updates) {
      alive(); const s = store.get(id), next = {};
      for (const key of Object.keys(updates)) { if (!['fuel', 'power'].includes(key)) throw new RangeError('Unknown adapter'); next[key] = adapter(updates[key], key); }
      Object.assign(s, next,{adapterKey:null,owned:false}); return api.state(id);
    },
    setModes(id, next) { alive(); const s = store.get(id); s.modes = modes(s.modes, next); return api.state(id); },
    setControls(id, next) {
      alive(); const s = store.get(id), controls = { ...s.controls };
      for (const [key, value] of Object.entries(next)) {
        if (key === 'handbrake') controls[key] = !!value;
        else if (key === 'gear') { if (![-1, 0, 1].includes(value)) throw new RangeError('gear must be -1, 0, or 1'); controls[key] = value; }
        else if (['throttle', 'brake', 'steer'].includes(key)) controls[key] = clamp(finite(value, key), key === 'steer' ? -1 : 0, 1);
        else throw new RangeError(`Unknown control ${key}`);
      }
      s.controls = controls;
    },
    start(id) {
      alive(); const s = store.get(id); if (s.running) return { started: true, reason: 'already-running' };
      if (s.modes.fuel === 'adapter') {
        const f = s.fuel.state();
        if (f.kind && f.kind !== s.fuelKind) return { started: false, reason: 'wrong-fuel' };
        if (!(f.amountL > 0)) return { started: false, reason: 'fuel-empty' };
      }
      if (s.modes.power === 'adapter') {
        const p = s.power.state();
        if (p.enabled === false || p.voltage < 10.8 || p.energyWh < s.starterWh) return { started: false, reason: 'battery-flat' };
        const drawn = transfer(s.power, 'draw', s.starterWh); s.drawnWh += drawn;
        if (drawn < s.starterWh - 1e-8) return { started: false, reason: 'starter-power' };
      }
      s.running = true; s.lastStop = null; s.rpm = 800; emit('vehicle:started', { id }); return { started: true };
    },
    stop(id, reason = 'ignition') { alive(); const s = store.get(id); const was = s.running; s.running = false; s.rpm = 0; s.lastStop = reason; if (was) emit('vehicle:stopped', { id, reason }); },
    setLights(id, value) { alive(); store.get(id).lights = !!value; },
    setPart(id, name, fraction) {
      alive(); const s = store.get(id), part = s.parts[name]; if (!part) throw new RangeError(`Unknown vehicle part: ${name}`);
      fraction = clamp(finite(fraction), 0, 1); if (part.locked || (Math.abs(s.speed) > 0.5 && fraction > part.fraction)) return false;
      part.target = fraction; return true;
    },
    setLocked(id, name, value) { alive(); const part = store.get(id).parts[name]; if (!part) throw new RangeError('Unknown vehicle part'); part.locked = !!value; },
    refuel(id, liters, kind = 'petrol') {
      alive(); positive(liters, 'liters', true); const s = store.get(id);
      if (s.running || Math.abs(s.speed) > 0.1 || s.parts.fuel_flap.fraction < 0.8 || kind !== s.fuelKind) return 0;
      const amountL = transfer(s.fuel, 'refill', liters, kind); if (amountL) emit('vehicle:refueled', { id, amountL, kind }); return amountL;
    },
    charge(id, wh) { alive(); positive(wh, 'wh', true); const s = store.get(id); const actual = transfer(s.power, 'charge', wh); s.chargedWh += actual; return actual; },
    withdrawFuel(id,liters){alive();positive(liters,'liters',true);const s=store.get(id),actual=transfer(s.fuel,'consume',liters);s.spilledL+=actual;
      if(s.running&&s.modes.fuel==='adapter'&&s.fuel.state().amountL<=0)api.stop(id,'fuel-empty');return actual;
    },
    step(dt) {
      alive(); positive(dt, 'dt', true);if(dt>86400)throw new RangeError('Vehicle update exceeds one-day catch-up budget'); if (!dt) return;
      // Resources use the whole elapsed interval. Motion is a lightweight bicycle model, not a collision solver.
      for (const s of store.entries.values()) {
        const initialSpeed=s.speed;
        const c = s.controls,wasRunning=s.running,idleW=3+(s.lights?95:0),runningW=idleW+85;
        const rate=s.idleLps+s.driveLps*c.throttle*(.25+Math.min(Math.abs(s.speed)/22,1));let runningTime=wasRunning?dt:0,fuelLimit=Infinity,powerLimit=Infinity,stopReason=null;
        if (s.running && s.modes.fuel === 'adapter') {
          const f = s.fuel.state();
          if(f.kind&&f.kind!==s.fuelKind){runningTime=0;stopReason='wrong-fuel';}else{fuelLimit=f.amountL>0?(rate>0?f.amountL/rate:Infinity):0;runningTime=Math.min(runningTime,fuelLimit);}
        }
        const deficit=Math.max(0,runningW-s.alternatorW);
        if(wasRunning&&s.modes.power==='adapter'&&deficit>0){const p=s.power.state();powerLimit=p.enabled===false?0:p.energyWh*3600/deficit;runningTime=Math.min(runningTime,powerLimit);}
        let fuelUsed=0;
        const fuelBatch=wasRunning&&s.modes.fuel==='adapter';
        const fuelBatchToken=fuelBatch?s.fuel.beginBatch?.():undefined;
        try {
          if(fuelBatch){const need=rate*runningTime;fuelUsed=transfer(s.fuel,'consume',need);s.consumedL+=fuelUsed;if(rate>0&&fuelUsed<need-1e-10){runningTime=fuelUsed/rate;fuelLimit=runningTime;}}
          if(s.modes.power==='adapter'){
            const needWh=(deficit*runningTime+idleW*(dt-runningTime))/3600,drawn=transfer(s.power,'draw',needWh);s.drawnWh+=drawn;
            if(deficit>0&&drawn*3600+1e-8<deficit*runningTime){runningTime=drawn*3600/deficit;powerLimit=runningTime;}
          }
          // A power adapter can return less than its advertised reserve after fuel was consumed. Return the fuel for
          // the engine interval that could not run; both built-in and public fuel adapters expose this inverse sink.
          if(rate>0&&fuelUsed>rate*runningTime+1e-10){const excess=fuelUsed-rate*runningTime,refunded=transfer(s.fuel,'refill',excess,s.fuelKind);fuelUsed-=refunded;s.consumedL-=refunded;
            if(refunded<excess-1e-10)throw new Error('Fuel adapter violated its reversible transfer contract');}
        } finally { if(fuelBatchToken!==undefined)s.fuel.flush?.(fuelBatchToken); }
        if(s.modes.power==='adapter'){
          const p=s.power.state();if(p.enabled!==false){const charge=transfer(s.power,'charge',Math.max(0,s.alternatorW-runningW)*runningTime/3600);s.chargedWh+=charge;}
        }
        if(wasRunning&&(runningTime<dt-1e-10||fuelLimit<=dt||powerLimit<=dt)){stopReason=stopReason??(powerLimit<fuelLimit?'power-loss':'fuel-empty');api.stop(s.id,stopReason);}
        const endPower=s.power.state();s.electrics=s.modes.power==='disabled'||(s.running&&s.alternatorW>=runningW)||(endPower.enabled!==false&&endPower.energyWh>1e-10);
        move(s,runningTime,6200/s.massKg*c.throttle*c.gear);move(s,dt-runningTime,0);
        for(const[name,p]of Object.entries(s.parts)){
          if(p.locked||(Math.max(Math.abs(initialSpeed),Math.abs(s.speed))>.5&&p.target>p.fraction))continue;
          const before=p.fraction;p.fraction+=clamp(p.target-p.fraction,-dt*1.4,dt*1.4);if(p.fraction!==before)emit('vehicle:part',{id:s.id,part:name,fraction:p.fraction});
        }
        s.rpm = s.running ? Math.min(6500, 800 + Math.abs(s.speed) * 105 + c.throttle * 1400) : 0;
      }
    },
    remove(id) { alive(); return store.remove(id); },
    capture(){
      alive();const vehicles=[];for(const s of store.entries.values()){
        if(!s.owned&&s.adapterKey===null)throw new Error('External vehicle adapters need a registered key for checkpoint');
        const state=api.state(s.id);state.controls={gear:s.controls.gear,handbrake:s.controls.handbrake};
        const settings=Object.fromEntries(['fuelKind','massKg','wheelbase','idleLps','driveLps','starterWh','alternatorW'].map(k=>[k,s[k]]));
        vehicles.push({...state,settings,owned:s.owned,...(s.owned?{resources:{fuel:s.fuel.capture(),power:s.power.capture()}}:{})});
      }return jsonState({schema:'gamesystems.vehicle.v1',vehicles});
    },
    prepareRestore(raw,{resourceStates={}}={}){
      alive();const d=jsonState(raw);if(d.schema!=='gamesystems.vehicle.v1'||!Array.isArray(d.vehicles)||d.vehicles.length!==store.entries.size)throw new Error('Vehicle topology differs');const staged=new Map();
      for(const saved of d.vehicles){const s=store.get(saved.id);booleanState(saved.owned);if(staged.has(saved.id)||(saved.owned&&!s.inlineStores))throw new Error('Vehicle ownership differs');
        for(const k of ['fuelKind','massKg','wheelbase','idleLps','driveLps','starterWh','alternatorW'])if(saved.settings?.[k]!==s[k])throw new Error('Vehicle settings differ');
        let pair,plans=[],future;
        if(saved.owned){if(saved.adapterKey!==null)throw new Error('Owned stores cannot name external binding');const f=s.inlineStores.fuel.prepareRestore(saved.resources.fuel),p=s.inlineStores.power.prepareRestore(saved.resources.power);pair=s.inlineStores;plans=[f,p];future={fuel:f.state(),power:p.state()};}
        else{stateId(saved.adapterKey);pair=bindings.get(saved.adapterKey);if(!pair)throw new Error('Unknown saved adapter key');future=resourceStates[saved.adapterKey];if(!future)throw new Error('External vehicle resource state must be staged by its owner');}
        for(const[type,keys]of [['fuel',['amountL','capacityL','kind']],['power',['energyWh','capacityWh','voltage','enabled']]])for(const k of keys){const a=saved[type]?.[k]??null,b=future[type]?.[k]??null;if(typeof a==='number'?(!Number.isFinite(a)||typeof b!=='number'||!Number.isFinite(b)||Math.abs(a-b)>1e-7):a!==b)throw new Error('Vehicle resource snapshot disagrees with owner');}
        if(!saved.modes||Object.keys(saved.modes).length!==2||!Object.hasOwn(saved.modes,'fuel')||!Object.hasOwn(saved.modes,'power'))throw new Error('Invalid saved resource modes');
        const next={position:vector(saved.position),heading:finite(saved.heading),wheelAngle:finite(saved.wheelAngle),running:booleanState(saved.running),lights:booleanState(saved.lights),electrics:booleanState(saved.electrics),modes:modes({fuel:'adapter',power:'adapter'},saved.modes),adapterKey:saved.adapterKey,owned:saved.owned};
        next.speed=finite(saved.speed);if(next.speed< -12||next.speed>58)throw new RangeError('Invalid saved speed');next.rpm=positive(saved.rpm,'rpm',true);if(next.rpm>6500)throw new RangeError('Invalid rpm');
        for(const k of ['distanceM','consumedL','drawnWh','chargedWh'])next[k]=positive(saved[k],k,true);
        next.spilledL=positive(saved.spilledL??0,'spilledL',true);
        if(saved.lastStop!==null)stateId(saved.lastStop);next.lastStop=saved.lastStop;
        if(![-1,0,1].includes(saved.controls?.gear))throw new Error('Invalid gear');next.controls={throttle:0,brake:0,steer:0,gear:saved.controls.gear,handbrake:booleanState(saved.controls.handbrake)};
        if(!saved.parts||Object.keys(saved.parts).length!==Object.keys(VEHICLE_PARTS).length)throw new Error('Vehicle panels differ');next.parts={};
        for(const name of Object.keys(VEHICLE_PARTS)){const p=saved.parts[name];if(!p)throw new Error('Missing panel');const fraction=finite(p.fraction),target=finite(p.target);if(fraction<0||fraction>1||target<0||target>1)throw new RangeError('Invalid panel fraction');next.parts[name]={fraction,target,locked:booleanState(p.locked)};}
        staged.set(s.id,{s,next,pair,plans,future:jsonState(future)});
      }
      return {state(id){const e=staged.get(id);if(!e)throw new Error('Unknown staged vehicle');return jsonState({...e.next,fuel:e.future.fuel,power:e.future.power});},
        commit(){alive();for(const[id,e]of staged){if(store.get(id)!==e.s)throw new Error('Vehicle replaced after staging');}for(const e of staged.values()){for(const p of e.plans)p.commit();Object.assign(e.s,e.next,e.pair);}},
        notify(){for(const id of staged.keys())emit('vehicle:restored',api.state(id));}};
    },
    restore(data,options){const p=api.prepareRestore(data,options);p.commit();p.notify();},
    dispose() { if(disposed)return;disposed = true; store.dispose();bindings.clear(); },
  };
  return api;
}
export default options => extension('vehicle', createVehicleSystem, options);
