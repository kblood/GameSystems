import { positive, finite, vector, distance, clamp, tierState, SYSTEM_TIERS } from '../host/system.js';
import { parsePoolSnapshot } from './snapshot.js';
import { addSource, copySources, sourceVolumes, burnSources } from './provenance.js';
import { jsonState } from '../host/state.js';
import {createPoolQueryIndex} from './query.js';
import {blendTemperature} from '../thermal/temperature-math.js';

// Tunable game values, not fuel specifications. Water/unknown/mixed do not invent combustible content.
export const LIQUID_FIRE_PRESETS = Object.freeze({
  water: { fuelJPerMl: 0, ignition: 1000, flammability: 0, smokeYield: 0 },
  foam: { fuelJPerMl: 0, ignition: 1000, flammability: 0, smokeYield: 0 },
  diesel: { fuelJPerMl: 400, ignition: 120, flammability: 0.75, smokeYield: 0.00009 },
  petrol: { fuelJPerMl: 450, ignition: 90, flammability: 0.9, smokeYield: 0.0001 },
  oil: { fuelJPerMl: 500, ignition: 180, flammability: 0.5, smokeYield: 0.00012 },
  unknown: { fuelJPerMl: 0, ignition: 1000, flammability: 0, smokeYield: 0 },
  mixed: { fuelJPerMl: 0, ignition: 1000, flammability: 0, smokeYield: 0 },
  wine: { fuelJPerMl: 0, ignition: 1000, flammability: 0, smokeYield: 0 },
});
const radiusOf = ml => Math.sqrt(ml * 1e-6 / (Math.PI * 0.0015));
const total = p => Object.values(p.components).reduce((a,b)=>a+b,0);
const fuel = p => Object.entries(p.components).reduce((n,[kind,ml])=>n+ml*LIQUID_FIRE_PRESETS[kind].fuelJPerMl,0);
function heatedTemperature(temperature,joules,heatCapacity){const next=temperature+joules/heatCapacity;if(!Number.isFinite(next))throw new RangeError('Dormant pool heat exceeds the finite temperature range');return next;}
function cooledState(temperature,wetMl,ml,heatCapacity,ambient){
  const nextWet=wetMl+ml;if(!Number.isFinite(nextWet))throw new RangeError('Dormant pool water exceeds the finite wetness range');
  const delta=temperature-ambient;let available;if(delta<=0)available={value:0,capped:false};else if(Number.isFinite(delta))available=cappedProduct(delta,heatCapacity);else{const hot=cappedProduct(temperature,heatCapacity),cold=cappedProduct(-ambient,heatCapacity),sum=cappedSum(hot.value,cold.value);available={value:sum.value,capped:hot.capped||cold.capped||sum.capped};}
  const water=cappedProduct(ml,2256);if(available.capped&&water.capped)throw new RangeError('Water cooling energy exceeds the finite range');
  const energy=Math.min(available.value,water.value),fullyCooled=available.value>0&&!available.capped&&water.value>=available.value,nextTemperature=fullyCooled?ambient:subtractHeat(temperature,energy,heatCapacity);
  if(!Number.isFinite(nextTemperature))throw new RangeError('Dormant pool cooling exceeds the finite temperature range');
  return {wetMl:nextWet,temperature:nextTemperature};
}
function cappedProduct(a,b){if(a===0||b===0)return {value:0,capped:false};if(a>Number.MAX_VALUE/b)return {value:Number.MAX_VALUE,capped:true};return {value:a*b,capped:false};}
function cappedSum(a,b){if(a>Number.MAX_VALUE-b)return {value:Number.MAX_VALUE,capped:true};return {value:a+b,capped:false};}
function subtractHeat(temperature,joules,heatCapacity){const drop=joules/heatCapacity;return Number.isFinite(drop)?temperature-drop:heatCapacity<1?(temperature*heatCapacity-joules)/heatCapacity:-Infinity;}

export function createPoolsSystem({ thermal, emit=()=>{}, quality='high', maxPools=128, mergeDistance=0.25, airConductance=0 }={}) {
  if(!thermal?.add||!thermal?.configure||!thermal?.replaceObjects)throw new TypeError('pools needs the thermal public API, including replaceObjects');
  positive(airConductance,'airConductance',true);positive(maxPools);if(!Number.isSafeInteger(maxPools))throw new RangeError('maxPools must be integer');positive(mergeDistance);const records=new Map(),nodeIndex=new Map(),tiers=tierState(quality);
  let nextId=1,initialMl=0,burnedMl=0,removedMl=0,remainingMl=0,disposed=false,notifying=false,clearing=false;
  const groups=new Map(),visibleRecords=new Map(),orders=new WeakMap(),cellSize=Math.max(1,mergeDistance);let sequence=0;
  const queryIndex=createPoolQueryIndex(cellSize);
  const pendingHot=new Map(),hotRooms=new Map();
  function removePending(p){if(!pendingHot.delete(p.id))return;const count=hotRooms.get(p.roomId)-1;if(count)hotRooms.set(p.roomId,count);else hotRooms.delete(p.roomId);}
  function updatePending(p){if(!p.active&&fuel(p)>0&&p.storedHeat.temperature>=profile(p).ignition){if(!pendingHot.has(p.id))hotRooms.set(p.roomId,(hotRooms.get(p.roomId)??0)+1);pendingHot.set(p.id,p);}else removePending(p);}
  const cell=position=>position.map(v=>Math.floor(v/cellSize));
  function index(p){
    queryIndex.put(p);
    updatePending(p);
    if(!orders.has(p))orders.set(p,sequence++);
    let rooms=groups.get(p.surfaceId);if(!rooms)groups.set(p.surfaceId,rooms=new Map());
    let group=rooms.get(p.roomId);if(!group)rooms.set(p.roomId,group={cells:new Map(),radius:mergeDistance});
    const key=cell(p.position).join(',');let entries=group.cells.get(key);if(!entries)group.cells.set(key,entries=new Set());entries.add(p);
    group.radius=Math.max(group.radius,radiusOf(total(p)));if(total(p)>.01)visibleRecords.set(p.id,p);else visibleRecords.delete(p.id);
  }
  function unindex(p){
    queryIndex.remove(p.id);
    removePending(p);
    visibleRecords.delete(p.id);const rooms=groups.get(p.surfaceId),group=rooms.get(p.roomId),key=cell(p.position).join(','),entries=group.cells.get(key);entries.delete(p);
    if(!entries.size)group.cells.delete(key);if(!group.cells.size){rooms.delete(p.roomId);if(!rooms.size)groups.delete(p.surfaceId);}
  }
  function merged(surfaceId,roomId,position){
    const group=groups.get(surfaceId)?.get(roomId);if(!group)return null;
    let match=null;const consider=p=>{if(distance(p.position,position)<=Math.max(mergeDistance,radiusOf(total(p)))&&(!match||orders.get(p)<orders.get(match)))match=p;};
    const origin=cell(position),extent=Math.ceil(group.radius/cellSize);
    if(extent>8){for(const entries of group.cells.values())for(const p of entries)consider(p);}
    else for(let x=-extent;x<=extent;x++)for(let y=-extent;y<=extent;y++)for(let z=-extent;z<=extent;z++)for(const p of group.cells.get([origin[0]+x,origin[1]+y,origin[2]+z].join(','))??[])consider(p);
    return match;
  }
  const thermalConfig=thermal.capture().config,ambient=thermalConfig.ambient,oxygenCutoff=thermalConfig.oxygenCutoff;
  function live() {if(disposed)throw new Error('System is disposed');}
  function mutable(){live();if(clearing)throw new Error('Cannot mutate pools during clear');}
  function get(id) {const p=records.get(id);if(!p)throw new Error(`Unknown pool: ${id}`);return p;}
  function profile(p) {
    const ml=total(p);let combustibleMl=0,ignition=0,smoke=0,flammability=0;
    for(const [kind,amount]of Object.entries(p.components)) {const s=LIQUID_FIRE_PRESETS[kind];if(!s.fuelJPerMl)continue;combustibleMl+=amount;ignition+=s.ignition*amount;smoke+=s.smokeYield*amount;flammability+=s.flammability*amount;}
    return {airConductance:p.airConductance,fuelJ:fuel(p),ignition:combustibleMl?ignition/combustibleMl:1000,flammability:ml?flammability/ml:0,
      smokeYield:combustibleMl?smoke/combustibleMl:0,heatCapacity:Math.max(10,ml*0.1),burnPower:800*clamp(radiusOf(ml)*3,0.2,2)};
  }
  function heatState(p){return p.active?thermal.state(p.thermalId):{...p.storedHeat,...profile(p)};}
  function sync(p) {if(p.active)thermal.configure(p.thermalId,profile(p));}
  function linked(p){return thermal.hasConnections?thermal.hasConnections(p.thermalId):thermal.capture().links.some(l=>l.a===p.thermalId||l.b===p.thermalId);}
  function suspendable(p){if(!p.active)return false;const s=thermal.state(p.thermalId),cfg=profile(p);return s.roomId===p.roomId&&distance(s.position,p.position)<=1e-8&&!s.burning&&!s.heaterW&&s.temperature<=ambient+.1&&!s.wetMl&&!s.blast&&s.cooling===.3&&s.extinctionAuto&&Object.entries(cfg).every(([key,value])=>Math.abs(s[key]-value)<1e-6)&&!linked(p);}
  function node(p){return {id:p.thermalId,position:p.position,roomId:p.roomId,...profile(p),...p.storedHeat};}
  function remember(p){const s=thermal.state(p.thermalId);p.storedHeat={temperature:s.temperature,burning:false,blanket:s.blanket,wetMl:s.wetMl,heaterW:0};}
  function publish(p) {updatePending(p);emit('pools:changed',api.state(p.id));}
  const api={
    get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    deposit(input={}) {
      let {id=null,surfaceId='ground',position=[0,0,0],ml,kind='unknown',roomId=null,components=null,sourceKey='external'}=input;
      mutable();positive(ml,'ml',true);position=vector(position);if(!ml)return null;
      const existing=id?records.get(id):null;
      if(existing) {
        if(Object.hasOwn(input,'surfaceId')&&surfaceId!==existing.surfaceId)throw new Error('Pool id belongs to another surface');
        if(Object.hasOwn(input,'roomId')&&roomId!==existing.roomId)throw new Error('Pool id belongs to another room');
        if(Object.hasOwn(input,'position')&&distance(position,existing.position)>Math.max(mergeDistance,radiusOf(total(existing))))throw new Error('Pool id belongs to another position');
        surfaceId=existing.surfaceId;roomId=existing.roomId;position=[...existing.position];
      }
      if(typeof surfaceId!=='string'||!surfaceId)throw new TypeError('Invalid surface id');
      if(typeof sourceKey!=='string'||!sourceKey)throw new TypeError('Invalid liquid source key');
      if(!Object.hasOwn(LIQUID_FIRE_PRESETS,kind))kind='unknown';if(roomId)thermal.roomState(roomId);
      const incoming={};for(const[k,amount]of Object.entries(components??{[kind]:ml})){positive(amount,'component ml',true);const liquid=Object.hasOwn(LIQUID_FIRE_PRESETS,k)?k:'unknown';incoming[liquid]=(incoming[liquid]??0)+amount;}
      if(Math.abs(Object.values(incoming).reduce((a,b)=>a+b,0)-ml)>1e-5)throw new Error('Liquid components must sum to ml');
      let p=id?records.get(id):merged(surfaceId,roomId,position),generatedId=false,nextGeneratedId=nextId;
      if(!p) {
        if(id===null) {generatedId=true;do{if(!Number.isSafeInteger(nextGeneratedId)||nextGeneratedId>=Number.MAX_SAFE_INTEGER)throw new RangeError('Generated pool ids exhausted');id=`puddle-${nextGeneratedId++}`;}while(records.has(id)||thermal.hasObject?.(`pool:${id}`));}
        if(typeof id!=='string'||!id)throw new Error('Invalid pool id');
        if(thermal.hasObject?.(`pool:${id}`))throw new Error('Thermal pool id is already owned');
        p={id,active:false,airConductance,thermalId:`pool:${id}`,surfaceId,roomId,position,components:{},sources:Object.create(null),sourceMl:0,storedHeat:{temperature:ambient,burning:false,blanket:0,wetMl:0,heaterW:0}};
      }
      const isNew=!records.has(p.id),old=heatState(p),previousMl=total(p),nextComponents={...p.components},sources=copySources(p.sources);
      for(const[k,amount]of Object.entries(incoming)){nextComponents[k]=(nextComponents[k]??0)+amount;if(!Number.isFinite(nextComponents[k]))throw new RangeError('Pool component volume exceeds the finite range');}
      addSource(sources,sourceKey,incoming);for(const parts of Object.values(sources))for(const amount of Object.values(parts))if(!Number.isFinite(amount))throw new RangeError('Pool source volume exceeds the finite range');
      const sourceMl=p.sourceMl+ml,nextInitial=initialMl+ml,nextRemaining=remainingMl+ml;if(!Number.isFinite(sourceMl)||!Number.isFinite(nextInitial)||!Number.isFinite(nextRemaining))throw new RangeError('Pool ledger exceeds the finite range');
      const staged={...p,components:nextComponents,sources,sourceMl},nextMl=total(staged),stagedProfile=profile(staged);if(!Number.isFinite(nextMl)||Object.values(stagedProfile).some(value=>typeof value==='number'&&!Number.isFinite(value)))throw new RangeError('Pool profile exceeds the finite range');
      const capacity=stagedProfile.heatCapacity,temperature=blendTemperature(ambient,old.temperature,old.heatCapacity/capacity);if(!Number.isFinite(temperature))throw new RangeError('Pool temperature exceeds the finite range');
      const waterMl=incoming.water??0,waterDose=fuel(staged)>0?waterMl:0,cooled=waterDose?cooledState(temperature,old.wetMl,waterDose,capacity,ambient):{temperature,wetMl:old.wetMl};
      if(!p.active&&thermal.hasObject?.(p.thermalId)&&!nodeIndex.has(p.thermalId))throw new Error('Thermal pool id is already owned');
      if(p.active)thermal.configure(p.thermalId,{...stagedProfile,temperature});
      p.components=nextComponents;p.sources=sources;p.sourceMl=sourceMl;p.storedHeat={...p.storedHeat,temperature:cooled.temperature,wetMl:cooled.wetMl};if(isNew)records.set(p.id,p);if(generatedId)nextId=nextGeneratedId;initialMl=nextInitial;remainingMl=nextRemaining;index(p);
      // Water carried by a deposited liquid is also a suppression dose. Stage its exact
      // cooling first so active pools can use the thermal API and dormant pools retain it.
      if(p.active&&waterDose)thermal.water(p.thermalId,waterDose);
      if(!p.active)api.activate(p.id,{evict:false});
      if(!p.active)emit('pools:budget',{maxPools,ml,id:p.id,retained:true});publish(p);
      emit('pools:deposited',{id:p.id,ml,components:{...incoming},sourceKey,previousMl,previousBlanket:old.blanket});return api.state(p.id);
    },
    state(id){const p=get(id),heat=heatState(p),{storedHeat,...visible}=p;return {...visible,position:[...p.position],components:{...p.components},sources:copySources(p.sources),ml:total(p),radius:radiusOf(total(p)),...profile(p),temperature:heat.temperature,burning:heat.burning,blanket:heat.blanket,wetMl:heat.wetMl,heaterW:heat.heaterW};},
    has(id){return records.has(id);},
    all(){return [...records.keys()].map(id=>api.state(id));},
    visible(limit=128){if(!Number.isSafeInteger(limit)||limit<0)throw new RangeError('Invalid render limit');const result=[];if(!limit)return result;
      for(const p of nodeIndex.values())if(total(p)>.01){result.push(api.state(p.id));if(result.length>=limit)return result;}
      for(const p of visibleRecords.values())if(!p.active){result.push(api.state(p.id));if(result.length>=limit)break;}return result;
    },
    nextDormant(){for(const p of visibleRecords.values())if(!p.active)return api.state(p.id);return null;},
    scanDormant({combustibleOnly=false,...options}={}){live();if(typeof combustibleOnly!=='boolean')throw new TypeError('Invalid combustible filter');const result=queryIndex.query({...options,filterKey:combustibleOnly?'fuel':'all',accept:p=>!combustibleOnly||fuel(p)>0});return {...result,items:result.items.map(p=>api.state(p.id))};},
    scanDormantRoom({coupledOnly=false,combustibleOnly=false,...options}={}){live();if(typeof coupledOnly!=='boolean'||typeof combustibleOnly!=='boolean')throw new TypeError('Invalid room filters');const result=queryIndex.queryRoom({...options,filterKey:`${coupledOnly}/${combustibleOnly}`,accept:p=>(!coupledOnly||p.airConductance>0)&&(!combustibleOnly||fuel(p)>0)});return {...result,items:result.items.map(p=>api.state(p.id))};},
    hotDormant(limit=1){if(!Number.isSafeInteger(limit)||limit<1)throw new RangeError('Invalid hot pool limit');const result=[];for(const p of pendingHot.values()){result.push(api.state(p.id));if(result.length>=limit)break;}return result;},
    hotDormantSummary(){live();return {count:pendingHot.size,rooms:[...hotRooms].sort(([a],[b])=>a===b?0:a===null?-1:b===null?1:a<b?-1:1).map(([roomId,count])=>({roomId,count}))};},
    stats(){return {records:records.size,active:nodeIndex.size,dormant:records.size-nodeIndex.size,maxActive:maxPools};},
    activate(id,{evict=true,protect=[]}={}){
      mutable();const p=get(id);if(p.active)return true;
      if(!Array.isArray(protect)||protect.some(id=>typeof id!=='string'||!id))throw new TypeError('Invalid protected pool ids');const protectedIds=new Set(protect);
      const pickCandidate=()=>[...nodeIndex.values()].find(p=>!protectedIds.has(p.id)&&suspendable(p));
      let candidate=nodeIndex.size>=maxPools&&evict?pickCandidate():null;
      if(nodeIndex.size>=maxPools&&!candidate)return false;
      if(candidate)remember(candidate);
      for(let attempt=0;attempt<2;attempt++){
        try{thermal.replaceObjects(candidate?[candidate.thermalId]:[],[node(p)]);break;}
        catch(error){if(!(error instanceof RangeError&&error.message==='Object budget exceeded'))throw error;
          if(attempt||!evict||candidate)return false;candidate=pickCandidate();if(!candidate)return false;remember(candidate);
        }
      }
      if(candidate){candidate.active=false;nodeIndex.delete(candidate.thermalId);}
      p.active=true;nodeIndex.set(p.thermalId,p);if(candidate)publish(candidate);publish(p);return true;
    },
    deactivate(id){mutable();const p=get(id);if(!p.active)return true;if(!suspendable(p))return false;remember(p);thermal.remove(p.thermalId);p.active=false;nodeIndex.delete(p.thermalId);publish(p);return true;},
    ignite(id){mutable();const p=get(id);if(p.active)return thermal.ignite(p.thermalId);const cfg=profile(p);if(!cfg.fuelJ||!cfg.flammability||p.storedHeat.wetMl>=1e-8||p.storedHeat.blanket>=.95)return false;if(p.roomId){let room;try{room=thermal.roomState(p.roomId);}catch{return false;}if(room.oxygen<=oxygenCutoff+.01)return false;}return api.activate(id)&&thermal.ignite(p.thermalId);},
    heat(id,joules){mutable();positive(joules,'joules',true);const p=get(id);if(p.active)thermal.addHeat(p.thermalId,joules);else{const temperature=heatedTemperature(p.storedHeat.temperature,joules,profile(p).heatCapacity);if(api.activate(id))thermal.addHeat(p.thermalId,joules);else p.storedHeat.temperature=temperature;}publish(p);},
    foam(id,coverage=1){mutable();coverage=clamp(finite(coverage),0,1);const p=get(id);if(p.active)thermal.suppress(p.thermalId,coverage);else p.storedHeat.blanket=coverage;publish(p);},
    cool(id,ml){mutable();positive(ml,'ml',true);const p=get(id);if(p.active)thermal.water(p.thermalId,ml);else Object.assign(p.storedHeat,cooledState(p.storedHeat.temperature,p.storedHeat.wetMl,ml,profile(p).heatCapacity,ambient));publish(p);},
    // Called from thermal:burned; only declared combustible millilitres are consumed, water persists.
    burned(thermalId,joules){
      const p=nodeIndex.get(thermalId);if(!p)return;positive(joules,'joules',true);
      const energy=fuel(p),fraction=energy?Math.min(1,joules/energy):0;let consumed=0;
      for(const kind of Object.keys(p.components))if(LIQUID_FIRE_PRESETS[kind].fuelJPerMl){const ml=p.components[kind]*fraction;p.components[kind]=Math.max(0,p.components[kind]-ml);consumed+=ml;}
      const origins=burnSources(p.sources,fraction,LIQUID_FIRE_PRESETS);
      burnedMl+=consumed;remainingMl=Math.max(0,remainingMl-consumed);index(p);sync(p);publish(p);
      if(consumed>0)emit('pools:consumed',{id:p.id,surfaceId:p.surfaceId,position:[...p.position],ml:consumed,sourceVolumes:origins,reason:'burn'});
    },
    ledger(){return {initialMl,remainingMl,burnedMl,removedMl};},
    remove(id){mutable();const p=get(id);removedMl+=total(p);remainingMl=records.size===1?0:Math.max(0,remainingMl-total(p));if(p.active)thermal.remove(p.thermalId);unindex(p);records.delete(id);nodeIndex.delete(p.thermalId);emit('pools:removed',{id,ml:total(p),surfaceId:p.surfaceId,position:[...p.position],sourceVolumes:sourceVolumes(p.sources)});},
    removeSource(sourceKey){
      mutable();if(typeof sourceKey!=='string'||!sourceKey)throw new TypeError('Invalid liquid source key');
      clearing=true;
      try{for(const p of [...records.values()]){
        const contribution=p.sources[sourceKey];if(!contribution)continue;
        const removed=Object.values(contribution).reduce((sum,ml)=>sum+ml,0);if(!removed)continue;
        const old=heatState(p),nextComponents={...p.components},nextSources=copySources(p.sources);delete nextSources[sourceKey];
        for(const[k,ml]of Object.entries(contribution)){nextComponents[k]=Math.max(0,(nextComponents[k]??0)-ml);if(nextComponents[k]===0)delete nextComponents[k];}
        const nextTotal=Object.values(nextComponents).reduce((sum,ml)=>sum+ml,0);
        unindex(p);removedMl+=removed;remainingMl=Math.max(0,remainingMl-removed);
        const event={id:p.id,ml:removed,surfaceId:p.surfaceId,position:[...p.position],sourceVolumes:{[sourceKey]:removed}};
        if(nextTotal===0){if(p.active)thermal.remove(p.thermalId);nodeIndex.delete(p.thermalId);records.delete(p.id);emit('pools:removed',event);continue;}
        p.components=nextComponents;p.sources=nextSources;p.sourceMl=Math.max(nextTotal,p.sourceMl-removed);p.storedHeat.temperature=old.temperature;
        if(p.active)thermal.configure(p.thermalId,{...profile(p),temperature:old.temperature});
        index(p);publish(p);emit('pools:removed',event);
      }}finally{clearing=false;}
    },
    clear({account=true}={}){live();if(clearing)throw new Error('Pool clear is reentrant');clearing=true;const removed=account?[...records.values()].map(p=>({id:p.id,ml:total(p),surfaceId:p.surfaceId,position:[...p.position],sourceVolumes:sourceVolumes(p.sources)})):[];try{for(const p of records.values())if(p.active)thermal.remove(p.thermalId);records.clear();nodeIndex.clear();groups.clear();visibleRecords.clear();queryIndex.clear();pendingHot.clear();hotRooms.clear();initialMl=burnedMl=removedMl=remainingMl=0;nextId=1;for(const event of removed)emit('pools:removed',event);}finally{clearing=false;}},
    save(){return {schema:'gamesystems.pools.v1',nextId,activeOrder:[...nodeIndex.values()].map(p=>p.id),hotOrder:[...pendingHot.keys()],ledger:api.ledger(),pools:api.all()};},
    prepareRestore(data,{thermalPlan=null}={}){
      mutable();if(notifying)throw new Error('Cannot restore during pool notification');const prepared=parsePoolSnapshot(jsonState(data),{maxPools,presets:LIQUID_FIRE_PRESETS,roomExists:id=>thermalPlan?thermalPlan.roomState(id):thermal.roomState(id)});
      for(const p of prepared.pools){const ml=total(p),cfg=profile(p);if(!Number.isFinite(ml)||Object.values(cfg).some(value=>typeof value==='number'&&!Number.isFinite(value)))throw new RangeError('Pool profile exceeds the finite range');}
      if(!thermalPlan)for(const p of prepared.pools)if(!p.active&&thermal.hasObject(p.thermalId)&&!nodeIndex.has(p.thermalId))throw new Error('Dormant pool id is already owned by thermal');
      if(thermalPlan){
        const savedIds=new Set(prepared.pools.filter(p=>p.active).map(p=>p.thermalId));
        for(const id of thermalPlan.objectIds())if(id.startsWith('pool:')&&!savedIds.has(id))throw new Error('Saved thermal pool has no liquid owner');
        for(const p of prepared.pools.filter(p=>p.active)){
          const s=thermalPlan.objectState(p.thermalId);
          if(s.roomId!==p.roomId||s.airConductance!==p.airConductance||distance(s.position,p.position)>1e-8||Math.abs(s.fuelJ-fuel(p))>1e-5||Math.abs(s.temperature-p.temperature)>1e-8||s.burning!==p.burning||s.blanket!==p.blanket||s.wetMl!==p.wetMl||s.heaterW!==p.heaterW)throw new Error('Saved pool and thermal states disagree');
        }
      }
      const states=prepared.pools.filter(p=>p.active).map(p=>({id:p.thermalId,position:p.position,roomId:p.roomId,...profile(p),temperature:p.temperature,burning:p.burning,blanket:p.blanket,wetMl:p.wetMl,heaterW:p.heaterW}));
      return {
        records(){return prepared.pools.map(p=>({...p,position:[...p.position],components:{...p.components},sources:copySources(p.sources)}));},
        commit(){
          mutable();if(notifying)throw new Error('Cannot restore during pool notification');if(!thermalPlan)thermal.replaceObjects([...nodeIndex.keys()],states);
          records.clear();nodeIndex.clear();groups.clear();visibleRecords.clear();queryIndex.clear();pendingHot.clear();hotRooms.clear();
          for(const {ml,temperature,burning,blanket,wetMl,heaterW,...p}of prepared.pools){const own={...p,position:[...p.position],components:{...p.components},sources:Object.assign(Object.create(null),copySources(p.sources)),storedHeat:{temperature,burning,blanket,wetMl,heaterW}};records.set(own.id,own);index(own);}
          for(const id of prepared.activeOrder){const p=records.get(id);nodeIndex.set(p.thermalId,p);}
          pendingHot.clear();for(const id of prepared.hotOrder)pendingHot.set(id,records.get(id));
          initialMl=prepared.ledger.initialMl;burnedMl=prepared.ledger.burnedMl;removedMl=prepared.ledger.removedMl;remainingMl=prepared.ledger.remainingMl;nextId=prepared.nextId;
        },
        notify(){if(disposed)return;if(notifying)throw new Error('Pool notification is reentrant');const batch=[...records.values()];notifying=true;
          try{for(const p of batch){if(disposed)return;if(records.get(p.id)===p)publish(p);}}finally{notifying=false;}
        },
      };
    },
    restore(data){
      const plan=api.prepareRestore(data);plan.commit();plan.notify();
    },
    dispose(){if(disposed)return;api.clear({account:false});disposed=true;},
  };
  return api;
}
export default function poolsExtension(options={}) {
  let api;
  return {id:'pools',requires:['thermal'],quality:SYSTEM_TIERS,
    init(ctx){api=createPoolsSystem({...options,thermal:ctx.get('thermal'),emit:ctx.emit,quality:ctx.quality});
      ctx.on('thermal:burned',({id,joules})=>api.burned(id,joules));
      ctx.on('liquid:deposit',event=>{if(options.accept&&!options.accept(event))return;api.deposit({...event,roomId:options.roomFor?.(event)??event.roomId??null});});
      return api;
    },setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();},
  };
}
