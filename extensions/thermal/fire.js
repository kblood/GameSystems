import { registry, positive, finite, vector, distance, clamp, tierState } from '../host/system.js';
import { prepareThermalState } from './state.js';
import {roomHeatProfile} from './room-heat.js';
import {portalBounds,portalDistance} from './portal.js';
import {blendTemperature,rateRatio,implicitExchange,exchangeTemperatures} from './temperature-math.js';

function addHeatToTemperature(temperature,joules,heatCapacity){
  const rise=joules/heatCapacity;
  return Number.isFinite(rise)?temperature+rise:heatCapacity<1?(temperature*heatCapacity+joules)/heatCapacity:Infinity;
}
function addPowerToTemperature(temperature,watts,seconds,heatCapacity){
  const rise=(watts/heatCapacity)*seconds;
  if(Number.isFinite(rise)){const next=temperature+rise;if(Number.isFinite(next))return next;return next>0?Infinity:temperature+rise;}
  const alternate=watts*(seconds/heatCapacity);
  if(Number.isFinite(alternate))return temperature+alternate;
  if(!watts||!seconds)return temperature;
  const logRise=Math.log2(watts)+Math.log2(seconds)-Math.log2(heatCapacity),normalized=2**(logRise-Math.log2(Number.MAX_VALUE));
  if(!Number.isFinite(normalized)||normalized>2)return Infinity;
  const result=(temperature/Number.MAX_VALUE+normalized)*Number.MAX_VALUE;
  return Number.isFinite(result)?result:Infinity;
}
function subtractHeatFromTemperature(temperature,joules,heatCapacity){
  const drop=joules/heatCapacity;
  return Number.isFinite(drop)?temperature-drop:heatCapacity<1?(temperature*heatCapacity-joules)/heatCapacity:-Infinity;
}
function cappedProduct(a,b){if(a===0||b===0)return {value:0,capped:false};if(a>Number.MAX_VALUE/b)return {value:Number.MAX_VALUE,capped:true};return {value:a*b,capped:false};}
function cappedSum(a,b){if(a>Number.MAX_VALUE-b)return {value:Number.MAX_VALUE,capped:true};return {value:a+b,capped:false};}
function availableCoolingEnergy(temperature,ambient,heatCapacity){
  const delta=temperature-ambient;
  if(delta<=0)return {value:0,capped:false};
  if(Number.isFinite(delta))return cappedProduct(delta,heatCapacity);
  const hot=cappedProduct(temperature,heatCapacity),cold=cappedProduct(-ambient,heatCapacity),sum=cappedSum(hot.value,cold.value);
  return {value:sum.value,capped:hot.capped||cold.capped||sum.capped};
}

// Deliberately game-tuned; these are not real material or explosive specifications.
export const FIRE_PRESETS = Object.freeze({
  wood: { flammability: 0.65, ignition: 180, fuelJ: 30000, burnPower: 1000, smokeYield: 0.00004 },
  fabric: { flammability: 0.9, ignition: 150, fuelJ: 18000, burnPower: 1200, smokeYield: 0.00006 },
  metal: { flammability: 0, ignition: 1000, fuelJ: 0, burnPower: 0, smokeYield: 0 },
  powder: { flammability: 1, ignition: 100, fuelJ: 3000, burnPower: 3000, smokeYield: 0.00008 },
});

export function createThermalSystem({ emit = () => {}, quality = 'high', ambient = 20, fixedStep = 0.05,
  maxObjects = 512, maxRooms = 64, autoSpread = false, spreadRadius = 0.7, spreadConductance = 2,
  maxNeighbours = 6, oxygenCost = 0.001, oxygenCutoff = 0.12, maxStepsPerUpdate = 2000,maxVents=4096,maxLinks=8192 } = {}) {
  finite(ambient); positive(fixedStep); positive(maxObjects); positive(maxRooms); positive(spreadRadius);
  positive(spreadConductance); positive(maxNeighbours); positive(oxygenCost, 'oxygenCost', true);
  finite(oxygenCutoff);
  for(const [name,value]of Object.entries({maxObjects,maxRooms,maxNeighbours,maxVents,maxLinks}))if(!Number.isSafeInteger(value)||value<(['maxVents','maxLinks'].includes(name)?0:1))throw new RangeError(`Invalid ${name} budget`);
  if (oxygenCutoff < 0 || oxygenCutoff >= 1) throw new RangeError('Invalid oxygen cutoff');
  if(!Number.isSafeInteger(maxStepsPerUpdate)||maxStepsPerUpdate<1)throw new RangeError('Invalid step budget');
  const objects = registry(), rooms = registry(), links = new Map(), vents = new Map(), tiers = tierState(quality);
  const linkIndex=new Map();
  function indexLink(key,link){for(const id of [link.a,link.b]){if(!linkIndex.has(id))linkIndex.set(id,new Set());linkIndex.get(id).add(key);}}
  function unindexLink(key,link){for(const id of [link.a,link.b]){const keys=linkIndex.get(id);keys?.delete(key);if(keys&&!keys.size)linkIndex.delete(id);}}
  function removeLinks(id){for(const key of linkIndex.get(id)??[]){const link=links.get(key);links.delete(key);unindexLink(key,link);}}
  function rebuildLinkIndex(){linkIndex.clear();for(const [key,link]of links)indexLink(key,link);}
  let dirty = true, nearby = [], pending = 0, clock = 0, disposed = false, stepping=false, notifying=false, observerError, observerFailed=false, stats = emptyStats();
  let airDirty=true,objectDirty=true,airGroups=[],objectList=[];const awakeAir=new Set();
  let portalDirty=true,openingCache=new Map();const roomPair=(a,b)=>JSON.stringify([a,b].sort());
  function openings(){if(portalDirty){openingCache=new Map();for(const v of vents.values())if(v.b!==null&&v.open>0){const key=roomPair(v.a,v.b);if(!openingCache.has(key))openingCache.set(key,[]);openingCache.get(key).push(v);}portalDirty=false;}return openingCache;}
  function passage(a,b,radius){
    const direct=distance(a.position,b.position);if(direct>radius)return null;if(a.roomId===b.roomId)return {distance:direct,open:1};if(!a.roomId||!b.roomId)return null;
    let best=null,strength=-1;for(const v of openings().get(roomPair(a.roomId,b.roomId))??[]){const d=portalDistance(a.position,b.position,v.portal);if(d>radius)continue;const value=v.open*(1-d/(radius*1.1));if(value>strength){strength=value;best={distance:d,open:v.open};}}return best;
  }
  function emptyStats(){return {objectSteps:0,linkSteps:0,airNodeChecks:0,airExchanges:0,airRebuilds:0};}
  function wakeAir(roomId){if(roomId)awakeAir.add(roomId);}
  function membersChanged(){objectDirty=airDirty=true;}
  function objectSnapshot(){if(objectDirty){objectList=[...objects.entries.values()];objectDirty=false;}return objectList;}
  function notify(event,payload,onObserverError=null){if(onObserverError){try{emit(event,payload);}catch(error){onObserverError(error);}return;}if(!stepping){emit(event,payload);return;}try{emit(event,payload);}catch(error){if(!observerFailed){observerError=error;observerFailed=true;}}}
  function rebuildAir(){
    const groups=new Map();awakeAir.clear();
    for(const s of objectSnapshot())if(s.roomId&&s.airConductance){const r=rooms.get(s.roomId),{beta,fraction}=implicitExchange(s.airConductance,fixedStep,s.heatCapacity);let group=groups.get(r.id);if(!group){const capacity=r.volume*r.heatCapacityPerVolume;group={r,baseCapacity:capacity,scale:capacity,nodes:[]};groups.set(r.id,group);}group.scale=Math.max(group.scale,beta);group.nodes.push({s,beta,fraction});}
    for(const group of groups.values()){group.baseWeight=group.baseCapacity/group.scale;for(const node of group.nodes)node.weight=node.beta?node.beta/group.scale:node.fraction/(group.scale/node.s.heatCapacity);}
    airGroups=[...groups.values()];for(const group of airGroups)wakeAir(group.r.id);airDirty=false;stats.airRebuilds++;
  }
  function preflightHeaters(count){
    const list=objectSnapshot(),hasHeater=list.some(s=>s.heaterW>0);if(!hasHeater)return;
    const extreme=list.some(s=>Math.abs(s.temperature)>Number.MAX_VALUE*.25)||[...rooms.entries.values()].some(r=>Math.abs(r.temperature)>Number.MAX_VALUE*.25);
    const directRisk=list.some(s=>s.heaterW&&!Number.isFinite(addPowerToTemperature(s.temperature,s.heaterW,fixedStep*count,s.heatCapacity)));
    if(!extreme&&!directRisk)return;
    if(autoSpread&&dirty)rebuild();
    const related=new Set(list.filter(s=>s.heaterW).map(s=>s.id)),roomAir=new Map();for(const s of list)if(s.roomId&&s.airConductance){if(!roomAir.has(s.roomId))roomAir.set(s.roomId,[]);roomAir.get(s.roomId).push(s);}
    let expanded=true;while(expanded){expanded=false;const add=id=>{if(id&&!related.has(id)){related.add(id);expanded=true;}};for(const l of [...links.values(),...nearby]){if(related.has(l.a))add(l.b);if(related.has(l.b))add(l.a);}for(const members of roomAir.values())if(members.some(s=>related.has(s.id))){for(const s of members)add(s.id);for(const s of list)if(s.roomId===members[0].roomId&&(s.burning||s.fuelJ>0&&s.flammability>0))add(s.id);}for(const v of vents.values())if(v.open&&v.flow){if((roomAir.get(v.a)??[]).some(s=>related.has(s.id)))for(const s of roomAir.get(v.b)??[])add(s.id);if(v.b&&(roomAir.get(v.b)??[]).some(s=>related.has(s.id)))for(const s of roomAir.get(v.a)??[])add(s.id);}}
    const activeBlast=b=>b.blast&&!b.blast.spent&&(b.blast.armed||b.fuelJ>0&&b.flammability>0);
    const relatedBlast=list.some(b=>activeBlast(b)&&list.some(t=>related.has(t.id)&&t!==b&&(passage(b,t,b.blast.radius)?.distance??Infinity)<b.blast.radius));
    // The following full blast/combustion preview runs before mutation and models these
    // interactions. Skip this heater-only approximation instead of rejecting safe mixtures.
    if(relatedBlast||list.some(s=>related.has(s.id)&&(activeBlast(s)||s.roomId&&(s.burning||s.fuelJ>0&&s.flammability>0))))return;
    const objectTemperatures=new Map(list.map(s=>[s.id,s.temperature])),roomTemperatures=new Map([...rooms.entries.values()].map(r=>[r.id,r.temperature])),fuel=new Map(list.map(s=>[s.id,s.fuelJ])),wet=new Map(list.map(s=>[s.id,s.wetMl])),burning=new Map(list.map(s=>[s.id,s.burning]));
    const groups=new Map();
    for(const s of list)if(s.roomId&&s.airConductance){const r=rooms.get(s.roomId),{beta,fraction}=implicitExchange(s.airConductance,fixedStep,s.heatCapacity);let g=groups.get(r.id);if(!g){const capacity=r.volume*r.heatCapacityPerVolume;g={r,baseCapacity:capacity,scale:capacity,nodes:[]};groups.set(r.id,g);}g.scale=Math.max(g.scale,beta);g.nodes.push({s,beta,fraction});}
    const air=[...groups.values()];for(const g of air){g.baseWeight=g.baseCapacity/g.scale;for(const n of g.nodes)n.weight=n.beta? n.beta/g.scale:n.fraction/(g.scale/n.s.heatCapacity);}
    const awake=airDirty?new Set(air.map(g=>g.r.id)):new Set(awakeAir);
    for(let i=0;i<count;i++){
      for(const v of vents.values())if(v.open&&v.flow){const a=rooms.get(v.a),b=v.b?rooms.get(v.b):null,ta=roomTemperatures.get(a.id);if(b){const tb=roomTemperatures.get(b.id),[na,nb]=exchangeTemperatures(ta,tb,a.volume*a.heatCapacityPerVolume,b.volume*b.heatCapacityPerVolume,v.open*v.flow,fixedStep*1200);roomTemperatures.set(a.id,na);roomTemperatures.set(b.id,nb);if(na!==ta)awake.add(a.id);if(nb!==tb)awake.add(b.id);}else{const next=blendTemperature(ta,ambient,-Math.expm1(-rateRatio(v.open*v.flow,fixedStep*1200,a.volume*a.heatCapacityPerVolume)));roomTemperatures.set(a.id,next);if(next!==ta)awake.add(a.id);}}
      for(const l of [...links.values(),...nearby]){const a=objects.entries.get(l.a),b=objects.entries.get(l.b);if(!a||!b)continue;const oldA=objectTemperatures.get(a.id),oldB=objectTemperatures.get(b.id);if(Math.abs(oldA-oldB)<1e-8)continue;const[ta,tb]=exchangeTemperatures(oldA,oldB,a.heatCapacity,b.heatCapacity,l.conductance,fixedStep);objectTemperatures.set(a.id,ta);objectTemperatures.set(b.id,tb);if(a.roomId)awake.add(a.roomId);if(b.roomId)awake.add(b.roomId);}
      for(const g of air){if(!awake.has(g.r.id))continue;let t=roomTemperatures.get(g.r.id),weight=g.baseWeight,active=false;for(const n of g.nodes){const next=weight+n.weight;if(n.weight)t=blendTemperature(t,objectTemperatures.get(n.s.id),n.weight/next);weight=next;if(Math.abs(objectTemperatures.get(n.s.id)-roomTemperatures.get(g.r.id))>1e-8)active=true;}if(!active){awake.delete(g.r.id);continue;}roomTemperatures.set(g.r.id,t);for(const n of g.nodes)objectTemperatures.set(n.s.id,blendTemperature(objectTemperatures.get(n.s.id),t,n.fraction));}
      for(const s of list){const previous=objectTemperatures.get(s.id),wetMl=Math.max(0,wet.get(s.id)-.05*fixedStep);wet.set(s.id,wetMl);const simulateFire=!s.roomId||related.has(s.id);let isBurning=simulateFire&&burning.get(s.id),isEligible=simulateFire&&fuel.get(s.id)>0&&s.flammability>0&&wetMl<1e-8&&s.blanket<.95;if(!isBurning&&previous>=s.ignition&&isEligible)isBurning=true;if(isBurning&&!isEligible)isBurning=false;const airFactor=clamp((1-oxygenCutoff)/.3,0,1),energy=isBurning?Math.min(fuel.get(s.id),s.burnPower*s.flammability*airFactor*(1-s.blanket)*fixedStep):0,released=isBurning&&isEligible?energy:0;fuel.set(s.id,Math.max(0,fuel.get(s.id)-released));let t=addHeatToTemperature(previous,released,s.heatCapacity);if(s.heaterW)t=addPowerToTemperature(t,s.heaterW,fixedStep,s.heatCapacity);if(!Number.isFinite(t))throw new RangeError(`Thermal step exceeds the finite temperature range: ${s.id}`);const active=s.heaterW||wetMl||isBurning||Math.abs(previous-ambient)>=1e-8||s.ignition<=ambient;if(active){t=blendTemperature(t,ambient,-Math.expm1(-s.cooling/s.heatCapacity*fixedStep));objectTemperatures.set(s.id,t);if(t!==previous&&s.roomId)awake.add(s.roomId);}isEligible=simulateFire&&fuel.get(s.id)>0&&s.flammability>0&&wetMl<1e-8&&s.blanket<.95;if(isBurning&&(!isEligible||t<s.extinction))isBurning=false;burning.set(s.id,isBurning);}
      for(const r of rooms.entries.values())roomTemperatures.set(r.id,blendTemperature(roomTemperatures.get(r.id),ambient,-Math.expm1(-r.coolingRate*fixedStep)));
    }
  }
  function combustionOutputRisk(count){
    const horizon=fixedStep*count,roomAdj=new Map(),outsideVentRooms=new Set(),componentOf=new Map(),components=new Map(),linkedAdj=new Map(),linkedMax=new Map(),linkedRoot=new Map(),linkedCapacity=new Map(),linkedHeat=new Map();let risk=false;
    for(const v of vents.values())if(v.open>0&&v.flow>0){if(v.b===null)outsideVentRooms.add(v.a);else{if(!roomAdj.has(v.a))roomAdj.set(v.a,[]);if(!roomAdj.has(v.b))roomAdj.set(v.b,[]);roomAdj.get(v.a).push(v.b);roomAdj.get(v.b).push(v.a);}}
    for(const room of rooms.entries.values())if(!componentOf.has(room.id)){const id=room.id,queue=[id],component={smoke:0,emission:0,heat:0,maxTemperature:-Infinity,minCapacity:Number.MAX_VALUE};componentOf.set(id,id);for(let i=0;i<queue.length;i++){const r=rooms.get(queue[i]),capacity=r.volume*r.heatCapacityPerVolume;component.smoke+=r.smoke;component.maxTemperature=Math.max(component.maxTemperature,r.temperature);if(r.coolingRate>0||outsideVentRooms.has(r.id))component.maxTemperature=Math.max(component.maxTemperature,ambient);component.minCapacity=Math.min(component.minCapacity,capacity);for(const next of roomAdj.get(r.id)??[])if(!componentOf.has(next)){componentOf.set(next,id);queue.push(next);}}components.set(id,component);if(!Number.isFinite(component.smoke))risk=true;}
    for(const l of [...links.values(),...nearby])if(objects.entries.has(l.a)&&objects.entries.has(l.b)){if(!linkedAdj.has(l.a))linkedAdj.set(l.a,[]);if(!linkedAdj.has(l.b))linkedAdj.set(l.b,[]);linkedAdj.get(l.a).push(l.b);linkedAdj.get(l.b).push(l.a);}
    for(const id of linkedAdj.keys())if(!linkedMax.has(id)){const queue=[id],members=[];let maximum=-Infinity,capacity=Number.MAX_VALUE;linkedMax.set(id,-Infinity);for(let i=0;i<queue.length;i++){const current=queue[i],s=objects.entries.get(current);maximum=Math.max(maximum,s.temperature);capacity=Math.min(capacity,s.heatCapacity);members.push(current);for(const next of linkedAdj.get(current)??[])if(!linkedMax.has(next)){linkedMax.set(next,-Infinity);queue.push(next);}}for(const member of members){linkedMax.set(member,maximum);linkedRoot.set(member,id);}linkedCapacity.set(id,capacity);linkedHeat.set(id,0);}
    for(const s of objectSnapshot())if(s.fuelJ>0&&s.flammability>0){
      const power=s.burnPower*s.flammability,energy=power>s.fuelJ/horizon?s.fuelJ:power*horizon,linkedTemperature=linkedMax.get(s.id)??s.temperature,room=s.roomId?rooms.get(s.roomId):null,component=room?components.get(componentOf.get(room.id)):null,airTemperature=room&&s.airConductance?component.maxTemperature:s.temperature,ambientTemperature=s.cooling>0?Math.max(s.temperature,ambient):s.temperature;
      const projected=addHeatToTemperature(Math.max(s.temperature,linkedTemperature,airTemperature,ambientTemperature),energy,s.heatCapacity);
      if(!Number.isFinite(addPowerToTemperature(projected,s.heaterW,horizon,s.heatCapacity)))risk=true;
      if(room){const emission=energy*s.smokeYield,heat=energy*room.heatFraction;component.emission+=emission;component.heat+=heat;if(!Number.isFinite(emission)||!Number.isFinite(component.emission)||!Number.isFinite(component.heat))risk=true;const localSmoke=room.smoke+emission,localHeat=room.temperature+heat/(room.volume*room.heatCapacityPerVolume);if(!Number.isFinite(localSmoke)||!Number.isFinite(localHeat))risk=true;}
      const root=linkedRoot.get(s.id);if(root!==undefined){linkedHeat.set(root,linkedHeat.get(root)+energy);if(!Number.isFinite(linkedHeat.get(root)))risk=true;}
    }
    for(const s of objectSnapshot())if(s.heaterW){const heat=s.heaterW*horizon;const root=linkedRoot.get(s.id);if(root!==undefined){linkedHeat.set(root,linkedHeat.get(root)+heat);if(!Number.isFinite(heat)||!Number.isFinite(linkedHeat.get(root)))risk=true;}if(s.roomId){const component=components.get(componentOf.get(s.roomId));if(component){component.heat+=heat;if(!Number.isFinite(component.heat))risk=true;}}}
    for(const c of components.values())if(!Number.isFinite(c.smoke+c.emission)||!Number.isFinite(addHeatToTemperature(c.maxTemperature,c.heat,c.minCapacity)))risk=true;
    for(const [root,heat]of linkedHeat)if(!Number.isFinite(addHeatToTemperature(linkedMax.get(root),heat,linkedCapacity.get(root))))risk=true;
    let needsCrossNetworkBound=Math.abs(ambient)>1e150;
    for(const s of objectSnapshot()){const energy=(s.fuelJ>0&&s.flammability>0?Math.min(s.fuelJ,s.burnPower*s.flammability*horizon):0)+s.heaterW*horizon;if(Math.abs(s.temperature)>1e150||s.heatCapacity<1e-150||Math.abs(energy)>1e150){needsCrossNetworkBound=true;break;}}
    if(!needsCrossNetworkBound)for(const r of rooms.entries.values())if(Math.abs(r.temperature)>1e150||r.volume*r.heatCapacityPerVolume<1e-150){needsCrossNetworkBound=true;break;}
    if(!needsCrossNetworkBound)return risk;
    // Build a combined room/object graph for the fast gate. A heat path may cross room air,
    // vents, object links, then another room or object; separate per-network bounds miss that.
    const networkAdj=new Map(),networkTemperature=new Map(),networkCapacity=new Map(),networkAmbient=new Set(),networkHeat=new Map();
    const connectNetwork=(a,b)=>{if(!networkAdj.has(a))networkAdj.set(a,new Set());if(!networkAdj.has(b))networkAdj.set(b,new Set());networkAdj.get(a).add(b);networkAdj.get(b).add(a);};
    for(const s of objectSnapshot()){const id=`o:${s.id}`;networkAdj.set(id,new Set());networkTemperature.set(id,s.temperature);networkCapacity.set(id,s.heatCapacity);if(s.cooling>0)networkAmbient.add(id);}
    for(const r of rooms.entries.values()){const id=`r:${r.id}`;networkAdj.set(id,new Set());networkTemperature.set(id,r.temperature);networkCapacity.set(id,r.volume*r.heatCapacityPerVolume);if(r.coolingRate>0||outsideVentRooms.has(r.id))networkAmbient.add(id);}
    for(const l of [...links.values(),...nearby])if(objects.entries.has(l.a)&&objects.entries.has(l.b))connectNetwork(`o:${l.a}`,`o:${l.b}`);
    for(const s of objectSnapshot())if(s.roomId&&s.airConductance)connectNetwork(`o:${s.id}`,`r:${s.roomId}`);
    for(const v of vents.values())if(v.open>0&&v.flow>0&&v.b!==null)connectNetwork(`r:${v.a}`,`r:${v.b}`);
    for(const s of objectSnapshot())if((s.fuelJ>0&&s.flammability>0)||s.heaterW){const id=`o:${s.id}`,energy=(s.fuelJ>0&&s.flammability>0?Math.min(s.fuelJ,s.burnPower*s.flammability*horizon):0)+s.heaterW*horizon;networkHeat.set(id,(networkHeat.get(id)??0)+energy);if(!Number.isFinite(energy))risk=true;}
    const visited=new Set();for(const id of networkAdj.keys())if(!visited.has(id)){const queue=[id],members=[];let maximum=-Infinity,capacity=Number.MAX_VALUE,energy=0,reachesAmbient=false;visited.add(id);for(let i=0;i<queue.length;i++){const current=queue[i];members.push(current);maximum=Math.max(maximum,networkTemperature.get(current));capacity=Math.min(capacity,networkCapacity.get(current));if(networkAmbient.has(current))reachesAmbient=true;energy+=networkHeat.get(current)??0;for(const next of networkAdj.get(current))if(!visited.has(next)){visited.add(next);queue.push(next);}}if(reachesAmbient)maximum=Math.max(maximum,ambient);if(!Number.isFinite(energy)||!Number.isFinite(addHeatToTemperature(maximum,energy,capacity)))risk=true;}
    // Room combustion can preheat an air-coupled fuel before it ignites later in this batch.
    // Bound that input with the component's possible aggregate heat so the fast gate cannot skip
    // the exact multi-tick simulation when one fire primes another through room air.
    for(const s of objectSnapshot())if(s.fuelJ>0&&s.flammability>0){const component=s.roomId&&s.airConductance?components.get(componentOf.get(s.roomId)):null,roomTemperature=component?addHeatToTemperature(component.maxTemperature,component.heat,component.minCapacity):s.temperature,root=linkedRoot.get(s.id),linkedTemperature=root!==undefined?addHeatToTemperature(linkedMax.get(s.id),linkedHeat.get(root),linkedCapacity.get(root)):s.temperature,energy=Math.min(s.fuelJ,s.burnPower*s.flammability*horizon),ambientTemperature=s.cooling>0?Math.max(s.temperature,ambient):s.temperature,projected=addHeatToTemperature(Math.max(roomTemperature,linkedTemperature,ambientTemperature),energy,s.heatCapacity);if(!Number.isFinite(addPowerToTemperature(projected,s.heaterW,horizon,s.heatCapacity)))risk=true;}
    return risk;
  }
  function preflightBlasts(count){
    if(autoSpread&&dirty)rebuild();
    const list=objectSnapshot(),temperatures=new Map(list.map(s=>[s.id,s.temperature])),wetness=new Map(list.map(s=>[s.id,s.wetMl])),fuels=new Map(list.map(s=>[s.id,s.fuelJ])),oxygen=new Map([...rooms.entries.values()].map(r=>[r.id,r.oxygen])),roomTemperatures=new Map([...rooms.entries.values()].map(r=>[r.id,r.temperature])),roomSmokes=new Map([...rooms.entries.values()].map(r=>[r.id,r.smoke])),burningState=new Map(list.map(s=>[s.id,s.burning])),clocks=new Map(),airGroups=new Map();
    for(const s of list)if(s.roomId&&s.airConductance){const r=rooms.get(s.roomId),{beta,fraction}=implicitExchange(s.airConductance,fixedStep,s.heatCapacity);let g=airGroups.get(r.id);if(!g){const capacity=r.volume*r.heatCapacityPerVolume;g={r,baseCapacity:capacity,scale:capacity,nodes:[]};airGroups.set(r.id,g);}g.scale=Math.max(g.scale,beta);g.nodes.push({s,beta,fraction});}
    for(const g of airGroups.values()){g.baseWeight=g.baseCapacity/g.scale;for(const n of g.nodes)n.weight=n.beta?n.beta/g.scale:n.fraction/(g.scale/n.s.heatCapacity);}
    const predictedSpent=new Set();
    for(const bomb of list)if(bomb.blast&&!bomb.blast.spent&&bomb.blast.armed)clocks.set(bomb.id,bomb.blast.clock);
    const imminent=[...clocks.values()].some(clock=>clock<=count*fixedStep),mayIgnite=list.some(b=>b.blast&&!b.blast.spent&&!b.blast.armed&&b.fuelJ>0&&b.flammability>0&&(b.burning||b.temperature>=b.ignition||b.heaterW||b.roomId||ambient>=b.ignition&&b.cooling>0||[...links.values(),...nearby].some(l=>l.a===b.id||l.b===b.id)));
    if(!imminent&&!mayIgnite&&!combustionOutputRisk(count))return;
    for(let tick=0;tick<count;tick++){
      for(const v of vents.values()){if(!v.open||!v.flow)continue;const a=rooms.get(v.a),b=v.b?rooms.get(v.b):null,flow=v.open*v.flow;if(b){const[na,nb]=exchangeTemperatures(oxygen.get(a.id),oxygen.get(b.id),a.volume,b.volume,flow,fixedStep),[ta,tb]=exchangeTemperatures(roomTemperatures.get(a.id),roomTemperatures.get(b.id),a.volume*a.heatCapacityPerVolume,b.volume*b.heatCapacityPerVolume,flow,fixedStep*1200);oxygen.set(a.id,na);oxygen.set(b.id,nb);roomTemperatures.set(a.id,ta);roomTemperatures.set(b.id,tb);const scale=Math.max(a.volume,b.volume),aw=a.volume/scale,bw=b.volume/scale,total=aw+bw,fraction=-Math.expm1(-(rateRatio(flow,fixedStep,a.volume)+rateRatio(flow,fixedStep,b.volume)));let moved=fraction*(roomSmokes.get(a.id)*(bw/total)-roomSmokes.get(b.id)*(aw/total));moved=moved>=0?Math.min(moved,roomSmokes.get(a.id),Number.MAX_VALUE-roomSmokes.get(b.id)):-Math.min(-moved,roomSmokes.get(b.id),Number.MAX_VALUE-roomSmokes.get(a.id));roomSmokes.set(a.id,Math.max(0,roomSmokes.get(a.id)-moved));roomSmokes.set(b.id,Math.max(0,roomSmokes.get(b.id)+moved));}else{oxygen.set(a.id,blendTemperature(oxygen.get(a.id),1,-Math.expm1(-rateRatio(flow,fixedStep,a.volume))));roomTemperatures.set(a.id,blendTemperature(roomTemperatures.get(a.id),ambient,-Math.expm1(-rateRatio(flow,fixedStep*1200,a.volume*a.heatCapacityPerVolume))));roomSmokes.set(a.id,roomSmokes.get(a.id)*(1+Math.expm1(-rateRatio(flow,fixedStep,a.volume))));}}
      for(const l of [...links.values(),...nearby]){const a=objects.entries.get(l.a),b=objects.entries.get(l.b);if(!a||!b)continue;const ta=temperatures.get(a.id),tb=temperatures.get(b.id);if(Math.abs(ta-tb)<1e-8)continue;const[na,nb]=exchangeTemperatures(ta,tb,a.heatCapacity,b.heatCapacity,l.conductance,fixedStep);temperatures.set(a.id,na);temperatures.set(b.id,nb);}
      for(const g of airGroups.values()){let t=roomTemperatures.get(g.r.id),weight=g.baseWeight;for(const n of g.nodes){const next=weight+n.weight;if(n.weight)t=blendTemperature(t,temperatures.get(n.s.id),n.weight/next);weight=next;}roomTemperatures.set(g.r.id,t);for(const n of g.nodes)temperatures.set(n.s.id,blendTemperature(temperatures.get(n.s.id),t,n.fraction));}
      const wetAtStart=new Map(wetness);for(const s of list)wetness.set(s.id,Math.max(0,wetness.get(s.id)-.05*fixedStep));
      const burning=new Set(),requested=new Map(),demand=new Map();for(const s of list){const roomOxygen=s.roomId?oxygen.get(s.roomId):1,eligible=fuels.get(s.id)>0&&s.flammability>0&&wetness.get(s.id)<1e-8&&s.blanket<.95&&roomOxygen>oxygenCutoff+.01,idleSkip=!burningState.get(s.id)&&!s.heaterW&&!wetAtStart.get(s.id)&&!s.blast?.armed&&Math.abs(temperatures.get(s.id)-ambient)<1e-8&&s.ignition>ambient,isBurning=!idleSkip&&(burningState.get(s.id)||temperatures.get(s.id)>=s.ignition)&&eligible;if(isBurning){burning.add(s.id);const energy=Math.min(fuels.get(s.id),s.burnPower*s.flammability*clamp((roomOxygen-oxygenCutoff)/.3,0,1)*(1-s.blanket)*fixedStep);requested.set(s.id,energy);if(s.roomId)demand.set(s.roomId,(demand.get(s.roomId)??0)+energy);}else burningState.set(s.id,false);}
      const ratios=new Map();for(const [id,energy]of demand){const r=rooms.get(id),need=energy*oxygenCost;ratios.set(id,need?Math.min(1,Math.max(0,oxygen.get(id)-oxygenCutoff)*r.volume/need):1);}
      for(const s of list){const released=burning.has(s.id)?requested.get(s.id)*(s.roomId?ratios.get(s.roomId):1):0;fuels.set(s.id,Math.max(0,fuels.get(s.id)-released));let temperature=addHeatToTemperature(temperatures.get(s.id),released,s.heatCapacity);temperature=addPowerToTemperature(temperature,s.heaterW,fixedStep,s.heatCapacity);if(!Number.isFinite(temperature))throw new RangeError(`Thermal step exceeds the finite temperature range: ${s.id}`);temperature=blendTemperature(temperature,ambient,-Math.expm1(-s.cooling/s.heatCapacity*fixedStep));temperatures.set(s.id,temperature);
        const roomOxygen=s.roomId?oxygen.get(s.roomId):1,stillEligible=fuels.get(s.id)>0&&s.flammability>0&&wetness.get(s.id)<1e-8&&s.blanket<.95&&roomOxygen>oxygenCutoff+.01;burningState.set(s.id,burning.has(s.id)&&stillEligible&&temperature>=s.extinction);
        if(!s.blast||s.blast.spent||predictedSpent.has(s.id))continue;
        if(!clocks.has(s.id)&&burningState.get(s.id))clocks.set(s.id,s.blast.fuseSeconds);
        if(!clocks.has(s.id))continue;const clock=clocks.get(s.id);if(clock>fixedStep){clocks.set(s.id,clock-fixedStep);continue;}clocks.delete(s.id);predictedSpent.add(s.id);fuels.set(s.id,0);burningState.set(s.id,false);
        for(const target of list){if(target===s)continue;const route=passage(s,target,s.blast.radius);if(!route||route.distance>=s.blast.radius)continue;const strength=s.blast.strength*(1-route.distance/s.blast.radius)*route.open,next=addPowerToTemperature(temperatures.get(target.id),strength,50,target.heatCapacity);if(!Number.isFinite(next))throw new RangeError(`Blast exceeds the finite temperature range: ${target.id}`);temperatures.set(target.id,next);}
      }
      const releasedByRoom=new Map();for(const s of list){if(!requested.has(s.id)||!s.roomId)continue;const released=requested.get(s.id)*(ratios.get(s.roomId)??1);releasedByRoom.set(s.roomId,(releasedByRoom.get(s.roomId)??0)+released);const r=rooms.get(s.roomId),smoke=roomSmokes.get(s.roomId)+released*s.smokeYield;if(!Number.isFinite(smoke))throw new RangeError(`Combustion smoke exceeds the finite room range: ${s.roomId}`);roomSmokes.set(s.roomId,smoke);if(released&&r.heatFraction){const temperature=roomTemperatures.get(s.roomId)+released*r.heatFraction/(r.volume*r.heatCapacityPerVolume);if(!Number.isFinite(temperature))throw new RangeError(`Combustion heat exceeds the finite room range: ${s.roomId}`);roomTemperatures.set(s.roomId,temperature);}}
      for(const [id,released]of releasedByRoom){const r=rooms.get(id);if(r)oxygen.set(id,clamp(oxygen.get(id)-released*oxygenCost/r.volume,0,1));}
      for(const r of rooms.entries.values())roomTemperatures.set(r.id,blendTemperature(roomTemperatures.get(r.id),ambient,-Math.expm1(-r.coolingRate*fixedStep)));
    }
  }
  const air = s => s.roomId ? rooms.get(s.roomId).oxygen : 1;
  const eligible = s => s.fuelJ > 0 && s.flammability > 0 && s.wetMl < 1e-8 && s.blanket < 0.95 && air(s) > oxygenCutoff + 0.01;
  const intensity = s => s.burning ? s.burnPower * s.flammability * clamp((air(s) - oxygenCutoff) / 0.3, 0, 1) * (1 - s.blanket) : 0;
  function burn(s, value, onObserverError=null) { if (s.burning !== value) { s.burning = value; notify(value ? 'thermal:ignited' : 'thermal:extinguished', api.state(s.id),onObserverError); } }
  function makeObject(id, options = {}, roomLookup = id => rooms.get(id)) {
    if(typeof id!=='string'||!id)throw new Error('Invalid thermal object id');
    const preset = options.material ? FIRE_PRESETS[options.material] : null;
    if(options.material&&!Object.hasOwn(FIRE_PRESETS,options.material))throw new RangeError('Unknown fire material');
    const { position=[0,0,0], temperature=ambient, heatCapacity=100, fuelJ=30000, ignition=180, burnPower=1000,
      cooling=.3, airConductance=0, flammability=1, roomId=null, smokeYield=.00004, blast=null, extinction=null }={...preset,...options};
    if(roomId)roomLookup(roomId);
    const threshold=extinction===null?Math.min(ignition,ambient+(ignition-ambient)*.6):finite(extinction);
    finite(ignition);if(threshold>ignition)throw new RangeError('extinction must not exceed ignition');
    const charge=blast?{radius:positive(blast.radius??2),strength:positive(blast.strength??10),fuseSeconds:positive(blast.fuseSeconds??1,'fuseSeconds',true),armed:false,clock:0,spent:false}:null;
    return {id,position:vector(position),roomId,temperature:finite(temperature),heatCapacity:positive(heatCapacity),fuelJ:positive(fuelJ,'fuelJ',true),
      ignition,extinction:threshold,extinctionAuto:extinction===null,burnPower:positive(burnPower,'burnPower',true),cooling:positive(cooling,'cooling',true),airConductance:positive(airConductance,'airConductance',true),flammability:clamp(finite(flammability),0,1),
      smokeYield:positive(smokeYield,'smokeYield',true),burning:false,wetMl:0,heaterW:0,blanket:0,blast:charge};
  }
  function rebuild() {
    dirty = false; nearby = []; if (!autoSpread) return;
    openings();
    const grid = new Map(), counts = new Map(), cell = p => p.map(v => Math.floor(v / spreadRadius));
    for (const s of objects.entries.values()) { const key = cell(s.position).join(','); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(s); }
    const ordered=[...objects.entries.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    for (const s of ordered) {
      const c = cell(s.position), candidates = [];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const b of grid.get([c[0]+x,c[1]+y,c[2]+z].join(',')) ?? []) {
        if (s.id >= b.id) continue;
        const route=passage(s,b,spreadRadius);if(route)candidates.push({b,d:route.distance,opening:route.open});
      }
      candidates.sort((a,b) => a.d-b.d || (a.b.id<b.b.id?-1:a.b.id>b.b.id?1:0));
      for (const { b, d, opening } of candidates) {
        if ((counts.get(s.id) ?? 0) >= maxNeighbours || (counts.get(b.id) ?? 0) >= maxNeighbours) continue;
        nearby.push({ a: s.id, b: b.id, conductance: spreadConductance * opening * (1-d/(spreadRadius*1.1)) });
        counts.set(s.id, (counts.get(s.id) ?? 0)+1); counts.set(b.id, (counts.get(b.id) ?? 0)+1);
      }
    }
  }
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    capture() {
      if(disposed)throw new Error('System is disposed');
      return {schema:'gamesystems.thermal.v1',config:{ambient,fixedStep,autoSpread,spreadRadius,spreadConductance,maxNeighbours,oxygenCost,oxygenCutoff},
        rooms:[...rooms.entries.values()].map(r=>({...r})),objects:api.objects().map(({intensity,...s})=>s),
        vents:[...vents.values()].map(v=>({...v,portal:portalBounds(v.portal)})),links:[...links.values()].map(l=>({...l})),pending,clock};
    },
    prepareRestore(raw) {
      if(disposed)throw new Error('System is disposed');
      if(stepping||notifying)throw new Error('Cannot restore during a thermal step or notification');
      const prepared=prepareThermalState(raw,{config:api.capture().config,maxObjects,maxRooms,maxVents,maxLinks,makeObject});
      return {
        roomState(id){const r=prepared.rooms.get(id);if(!r)throw new Error(`Unknown saved room: ${id}`);return {...r};},
        roomIds(){return [...prepared.rooms.keys()];},
        objectState(id){const s=prepared.objects.get(id);if(!s)throw new Error(`Unknown saved object: ${id}`);return {...s,position:[...s.position],blast:s.blast?{...s.blast}:null};},
        objectIds(){return [...prepared.objects.keys()];},
        ventState(id){const v=prepared.vents.get(id);if(!v)throw new Error(`Unknown saved vent: ${id}`);return {...v,portal:portalBounds(v.portal)};},
        commit(){
          if(disposed)throw new Error('System is disposed');
          if(stepping||notifying)throw new Error('Cannot restore during a thermal step or notification');
          rooms.entries.clear();objects.entries.clear();vents.clear();links.clear();linkIndex.clear();
          for(const[id,r]of prepared.rooms)rooms.entries.set(id,{...r});
          for(const[id,s]of prepared.objects)objects.entries.set(id,{...s,position:[...s.position],blast:s.blast?{...s.blast}:null});
          for(const[id,v]of prepared.vents)vents.set(id,{...v,portal:portalBounds(v.portal)});for(const[key,l]of prepared.links)links.set(key,{...l});rebuildLinkIndex();portalDirty=true;
          pending=prepared.pending;clock=prepared.clock;dirty=true;nearby=[];membersChanged();awakeAir.clear();stats=emptyStats();
        },
        notify(){
          if(disposed)return;if(notifying||stepping)throw new Error('Thermal notification is reentrant');
          const objectBatch=[...objects.entries.values()],roomBatch=[...rooms.entries.values()];notifying=true;
          try{
            for(const s of objectBatch){if(disposed)return;if(objects.entries.get(s.id)===s)notify('thermal:changed',api.state(s.id));}
            for(const r of roomBatch){if(disposed)return;if(rooms.entries.get(r.id)===r)notify('thermal:room',api.roomState(r.id));}
          }finally{notifying=false;}
        },
      };
    },
    restore(raw){const plan=api.prepareRestore(raw);plan.commit();plan.notify();},
    addRoom(id, { volume = 20, oxygen = 1, smoke = 0, temperature = ambient, floor = 0, ceiling = 3, ...heatOptions } = {}) {
      if (rooms.entries.size >= maxRooms) throw new RangeError('Room budget exceeded');
      if (finite(ceiling) <= finite(floor)) throw new RangeError('Invalid ceiling');
      rooms.add(id, { id, volume: positive(volume), oxygen: clamp(finite(oxygen),0,1), smoke: positive(smoke,'smoke',true), temperature: finite(temperature), floor, ceiling,...roomHeatProfile({volume,...heatOptions}) }); return api.roomState(id);
    },
    configureRoom(id,values={}){
      const r=rooms.get(id),candidate={...r},allowed=new Set(['temperature','oxygen','smoke','heatCapacityPerVolume','heatFraction','coolingRate']);
      for(const [key,value]of Object.entries(values)){if(!allowed.has(key))throw new Error(`Unknown room setting: ${key}`);if(value!==undefined)candidate[key]=value;}
      finite(candidate.temperature);positive(candidate.smoke,'smoke',true);finite(candidate.oxygen);if(candidate.oxygen<0||candidate.oxygen>1)throw new RangeError('oxygen must be normalized');
      Object.assign(candidate,roomHeatProfile(candidate));if(candidate.heatCapacityPerVolume!==r.heatCapacityPerVolume)airDirty=true;if(candidate.temperature!==r.temperature)wakeAir(id);Object.assign(r,candidate);
      for(const s of objects.entries.values())if(s.roomId===id&&s.burning&&!eligible(s))burn(s,false);
      notify('thermal:room',api.roomState(id));return api.roomState(id);
    },
    roomState(id) { const r = rooms.get(id), density = Math.min(Number.MAX_VALUE,r.smoke / r.volume); return { ...r, smokeDensity: density, visibility: Math.exp(-density*8), smokeLayerBottom: blendTemperature(r.ceiling,r.floor,clamp(density*3,0,1)) }; },
    roomStates() { return [...rooms.entries.keys()].map(id => api.roomState(id)); },
    hasRoom(id){return rooms.entries.has(id);},
    connectedRooms(roomId){if(roomId!==null)rooms.get(roomId);const connected=new Set([roomId]);if(roomId!==null)for(const v of vents.values())if(v.open>0){if(v.a===roomId&&v.b!==null)connected.add(v.b);if(v.b===roomId)connected.add(v.a);}return [...connected];},
    addVent(id, { a, b = null, open = 1, flow = 1, portal=null } = {}) { if(vents.size>=maxVents)throw new RangeError('Vent budget exceeded');if(typeof id!=='string'||!id)throw new TypeError('Invalid vent id');rooms.get(a); if (b!==null) rooms.get(b); if (a===b || vents.has(id)) throw new Error('Invalid/duplicate vent'); vents.set(id,{id,a,b,open:clamp(finite(open),0,1),flow:positive(flow,'flow',true),portal:portalBounds(portal)}); dirty=portalDirty=true; },
    setVent(id, open) { const v=vents.get(id); if (!v) throw new Error(`Unknown vent: ${id}`); v.open=clamp(finite(open),0,1); dirty=portalDirty=true; },
    setVentPortal(id,portal){const v=vents.get(id);if(!v)throw new Error(`Unknown vent: ${id}`);v.portal=portalBounds(portal);dirty=portalDirty=true;},
    ventState(id) { const v=vents.get(id); if (!v) throw new Error(`Unknown vent: ${id}`); return {...v,portal:portalBounds(v.portal)}; },
    heatPath(a,b,radius=spreadRadius){positive(radius);const points=[a,b].map(s=>{const roomId=s.roomId??null;if(roomId!==null)rooms.get(roomId);return {roomId,position:vector(s.position)};});return passage(points[0],points[1],radius)?.distance??null;},
    removeVent(id) { dirty=portalDirty=true; return vents.delete(id); },
    removeRoom(id) { if ([...objects.entries.values()].some(s=>s.roomId===id)) throw new Error('Remove room objects first'); for (const [key,v] of vents) if (v.a===id || v.b===id) vents.delete(key); dirty=portalDirty=true;airDirty=true;awakeAir.delete(id); return rooms.remove(id); },
    add(id, options = {}) {
      if (objects.entries.size >= maxObjects) throw new RangeError('Object budget exceeded');
      objects.add(id,makeObject(id,options));dirty=true;membersChanged();return api.state(id);
    },
    // Atomic scoped replacement for owners restoring saved state. Validate everything before committing.
    replaceObjects(removeIds, states) {
      if(disposed)throw new Error('System is disposed');
      if(!Array.isArray(removeIds)||!Array.isArray(states))throw new TypeError('replaceObjects needs arrays');
      const removed=new Set(removeIds),replacement=new Map();
      for(const id of removed)if(typeof id!=='string'||!id)throw new Error('Invalid replacement scope');
      for(const state of states) {
        const s=makeObject(state.id,state);
        if(replacement.has(s.id)||(objects.entries.has(s.id)&&!removed.has(s.id)))throw new Error(`Thermal id is already owned: ${s.id}`);
        for(const key of ['wetMl','heaterW'])s[key]=positive(state[key]??0,key,true);
        s.blanket=finite(state.blanket??0);if(s.blanket<0||s.blanket>1)throw new RangeError('Invalid blanket');
        if(state.burning!==undefined&&typeof state.burning!=='boolean')throw new TypeError('Invalid burning state');
        s.burning=!!state.burning&&eligible(s)&&s.temperature>=s.extinction;
        replacement.set(s.id,s);
      }
      const remaining=[...objects.entries.keys()].filter(id=>!removed.has(id)).length;
      if(remaining+replacement.size>maxObjects)throw new RangeError('Object budget exceeded');
      for(const id of removed)objects.entries.delete(id);
      for(const [id,s]of replacement)objects.entries.set(id,s);
      for(const [key,l]of links)if(!objects.entries.has(l.a)||!objects.entries.has(l.b)){links.delete(key);unindexLink(key,l);}
      dirty=true;membersChanged();
    },
    state(id) { const s=objects.get(id); return {...s,position:[...s.position],blast:s.blast?{...s.blast}:null,intensity:intensity(s)}; },
    hasObject(id) { return objects.entries.has(id); },
    hasConnections(id){return (linkIndex.get(id)?.size??0)>0;},
    objects() { return [...objects.entries.keys()].map(id=>api.state(id)); },
    burningObjects() { return [...objects.entries.values()].filter(s=>s.burning).map(s=>api.state(s.id)); },
    setPosition(id, position, roomId=objects.get(id).roomId) {
      const s=objects.get(id),nextPosition=vector(position);if(roomId!==null)rooms.get(roomId);
      if(s.roomId!==roomId)airDirty=true;s.position=nextPosition;s.roomId=roomId;dirty=true;
      if(s.burning&&!eligible(s))burn(s,false);
      notify('thermal:changed',api.state(id));
    },
    configure(id, values={}) {
      const s=objects.get(id),candidate={...s};
      for(const key of ['flammability','ignition','burnPower','fuelJ','temperature','smokeYield','heatCapacity','airConductance','wetMl']) {
        if(values[key]===undefined)continue;
        candidate[key]=key==='flammability'?clamp(finite(values[key]),0,1):['ignition','temperature'].includes(key)?finite(values[key]):positive(values[key],key,key!=='heatCapacity');
      }
      if(values.ignition!==undefined&&candidate.extinctionAuto)candidate.extinction=Math.min(candidate.ignition,ambient+(candidate.ignition-ambient)*.6);
      if(candidate.extinction>candidate.ignition)throw new RangeError('extinction must not exceed ignition');
      if(candidate.heatCapacity!==s.heatCapacity||candidate.airConductance!==s.airConductance)airDirty=true;if(candidate.temperature!==s.temperature)wakeAir(s.roomId);
      Object.assign(s,candidate);
      if(!eligible(s)||s.temperature<s.extinction)burn(s,false);
    },
    connect(a,b,conductance=1) { objects.get(a);objects.get(b);if(a===b)throw new Error('Self connection');positive(conductance);const key=roomPair(a,b);if(!links.has(key)&&links.size>=maxLinks)throw new RangeError('Connection budget exceeded');const link={a,b,conductance};links.set(key,link);indexLink(key,link); },
    connectNearby(radius=0.5,conductance=1) {
      positive(radius);positive(conductance);const all=[...objects.entries.values()],staged=new Map(links);
      for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(passage(all[i],all[j],radius)){const a=all[i].id,b=all[j].id,key=roomPair(a,b);if(!staged.has(key)&&staged.size>=maxLinks)throw new RangeError('Connection budget exceeded');staged.set(key,{a,b,conductance});}
      links.clear();for(const [key,link]of staged)links.set(key,link);rebuildLinkIndex();
    },
    ignite(id) { const s=objects.get(id);if(!eligible(s))return false;s.temperature=Math.max(s.temperature,s.ignition);wakeAir(s.roomId);burn(s,true);return true; },
    addHeat(id,joules) { const s=objects.get(id),amount=positive(joules,'joules',true),temperature=addHeatToTemperature(s.temperature,amount,s.heatCapacity);if(!Number.isFinite(temperature))throw new RangeError('Heat addition exceeds the finite temperature range');s.temperature=temperature;if(amount)wakeAir(s.roomId); },
    addFuel(id,joules) { const s=objects.get(id),fuel= s.fuelJ+positive(joules,'joules',true);if(!Number.isFinite(fuel))throw new RangeError('Fuel addition exceeds the finite fuel range');s.fuelJ=fuel; },
    setHeater(id,watts) { objects.get(id).heaterW=positive(watts,'watts',true); },
    // A coordinating system can retain notification errors until its delivery
    // receipt is complete. Validation and simulation errors still throw here.
    water(id,ml,{onObserverError=null}={}) { if(onObserverError!==null&&typeof onObserverError!=='function')throw new TypeError('onObserverError must be a function');const s=objects.get(id),amount=positive(ml,'ml',true),wetMl=s.wetMl+amount,available=availableCoolingEnergy(s.temperature,ambient,s.heatCapacity),waterEnergy=cappedProduct(amount,2256);if(available.capped&&waterEnergy.capped)throw new RangeError('Water cooling energy exceeds the finite range');const energy=Math.min(available.value,waterEnergy.value),fullyCooled=available.value>0&&!available.capped&&waterEnergy.value>=available.value,temperature=fullyCooled?ambient:subtractHeatFromTemperature(s.temperature,energy,s.heatCapacity);if(!Number.isFinite(wetMl)||!Number.isFinite(energy)||!Number.isFinite(temperature))throw new RangeError('Water addition exceeds the finite thermal state range');s.wetMl=wetMl;s.temperature=temperature;if(energy)wakeAir(s.roomId);if(!eligible(s)||s.temperature<s.ignition)burn(s,false,onObserverError);notify('thermal:cooled',{id,ml:amount,joules:energy},onObserverError); },
    suppress(id,coverage=1) { const s=objects.get(id);s.blanket=clamp(finite(coverage),0,1);if(!eligible(s))burn(s,false); },
    arm(id,seconds) { const s=objects.get(id);if(!s.blast||s.blast.spent)return false;s.blast.armed=true;s.blast.clock=positive(seconds??s.blast.fuseSeconds,'seconds',true);notify('thermal:armed',{id,seconds:s.blast.clock});return true; },
    step(dt) {
      if(disposed)throw new Error('System is disposed');if(stepping||notifying)throw new Error('Thermal step or notification is already running');
      stepping=true;observerError=undefined;observerFailed=false;let simulationFailed=false;try{
      positive(dt,'dt',true);if(dt>10)throw new RangeError('dt exceeds 10 seconds');
      const nextPending=pending+dt,count=Math.floor((nextPending+1e-10)/fixedStep);
      if(!Number.isSafeInteger(count)||count>maxStepsPerUpdate)throw new RangeError('Thermal step budget exceeded');
      if(count){preflightHeaters(count);preflightBlasts(count);}
      pending=nextPending;if(!count)return;pending=Math.max(0,pending-count*fixedStep);
      if(dirty)rebuild();stats=emptyStats();const h=fixedStep,changed=new Map();
      for(let i=0;i<count;i++) {
        if(disposed)return;if(dirty)rebuild();if(airDirty)rebuildAir();clock+=h;
        for(const v of vents.values()) {
          if(!v.open||!v.flow)continue;const a=rooms.get(v.a),b=v.b?rooms.get(v.b):null;
          const flow=v.open*v.flow;
          if(b){
            [a.oxygen,b.oxygen]=exchangeTemperatures(a.oxygen,b.oxygen,a.volume,b.volume,flow,h);
            const scale=Math.max(a.volume,b.volume),aw=a.volume/scale,bw=b.volume/scale,total=aw+bw,fraction=-Math.expm1(-(rateRatio(flow,h,a.volume)+rateRatio(flow,h,b.volume)));
            let moved=fraction*(a.smoke*(bw/total)-b.smoke*(aw/total));moved=moved>=0?Math.min(moved,a.smoke,Number.MAX_VALUE-b.smoke):-Math.min(-moved,b.smoke,Number.MAX_VALUE-a.smoke);
            a.smoke=Math.max(0,a.smoke-moved);b.smoke=Math.max(0,b.smoke+moved);
          }else{const fraction=-Math.expm1(-rateRatio(flow,h,a.volume));a.oxygen=blendTemperature(a.oxygen,1,fraction);a.smoke*=1-fraction;}
          const ac=a.volume*a.heatCapacityPerVolume,previousA=a.temperature,previousB=b?.temperature;
          if(b){[a.temperature,b.temperature]=exchangeTemperatures(a.temperature,b.temperature,ac,b.volume*b.heatCapacityPerVolume,flow,h*1200);}
          else a.temperature=blendTemperature(a.temperature,ambient,-Math.expm1(-rateRatio(flow,h*1200,ac)));
          if(a.temperature!==previousA)wakeAir(a.id);if(b&&b.temperature!==previousB)wakeAir(b.id);
        }
        for(const l of [...links.values(),...nearby]) {
          const a=objects.entries.get(l.a),b=objects.entries.get(l.b);if(!a||!b)continue;
          if(Math.abs(a.temperature-b.temperature)<1e-8)continue;
          [a.temperature,b.temperature]=exchangeTemperatures(a.temperature,b.temperature,a.heatCapacity,b.heatCapacity,l.conductance,h);stats.linkSteps++;wakeAir(a.roomId);wakeAir(b.roomId);
          changed.set(a.id,a);changed.set(b.id,b);
        }
        // Simultaneous implicit room/object exchange: bounded temperatures and conserved thermal energy.
        // Air capacity follows the room profile used for combustion heating.
        for(const group of airGroups){
          if(!awakeAir.has(group.r.id))continue;let temperature=group.r.temperature,weight=group.baseWeight,active=false;
          for(const node of group.nodes){const next=weight+node.weight;if(node.weight)temperature=blendTemperature(temperature,node.s.temperature,node.weight/next);weight=next;stats.airNodeChecks++;if(Math.abs(node.s.temperature-group.r.temperature)>1e-8)active=true;}
          if(!active){awakeAir.delete(group.r.id);continue;}
          group.r.temperature=temperature;
          for(const {s,fraction}of group.nodes){s.temperature=blendTemperature(s.temperature,temperature,fraction);changed.set(s.id,s);stats.airExchanges++;}
        }
        const requests=[],demand=new Map();
        for(const s of objectSnapshot()) {
          if(objects.entries.get(s.id)!==s)continue;
          if(!s.burning&&!s.heaterW&&!s.wetMl&&!s.blast?.armed&&Math.abs(s.temperature-ambient)<1e-8&&s.ignition>ambient)continue;
          changed.set(s.id,s);
          s.wetMl=Math.max(0,s.wetMl-0.05*h);if(!s.burning&&s.temperature>=s.ignition&&eligible(s))burn(s,true);if(objects.entries.get(s.id)!==s||disposed)continue;if(s.burning&&!eligible(s))burn(s,false);
          if(objects.entries.get(s.id)!==s||disposed)continue;
          const energy=s.burning?Math.min(s.fuelJ,intensity(s)*h):0;requests.push({s,energy,roomId:s.roomId});
        }
        if(disposed)return;for(const {s,energy,roomId}of requests)if(objects.entries.get(s.id)===s&&s.roomId===roomId&&roomId)demand.set(roomId,(demand.get(roomId)??0)+energy);
        const ratios=new Map(),consumedAir=new Map();
        for(const [id,energy] of demand) { const r=rooms.get(id),need=energy*oxygenCost;ratios.set(id,need?Math.min(1,Math.max(0,r.oxygen-oxygenCutoff)*r.volume/need):1); }
        for(const {s,energy,roomId} of requests) {
          if(disposed)return;if(objects.entries.get(s.id)!==s||s.roomId!==roomId)continue;
          const previousTemperature=s.temperature,released=(s.burning&&eligible(s)?Math.min(s.fuelJ,energy):0)*(s.roomId?ratios.get(s.roomId):1),heated=addHeatToTemperature(s.temperature,released,s.heatCapacity),nextTemperature=addPowerToTemperature(heated,s.heaterW,h,s.heatCapacity);if(!Number.isFinite(nextTemperature))throw new RangeError(`Thermal step exceeds the finite temperature range: ${s.id}`);s.fuelJ=Math.max(0,s.fuelJ-released);s.temperature=nextTemperature;
          if(s.roomId) { const r=rooms.get(s.roomId);r.smoke+=released*s.smokeYield;r.temperature+=released*r.heatFraction/(r.volume*r.heatCapacityPerVolume);consumedAir.set(r,(consumedAir.get(r)??0)+released);if(released&&r.heatFraction)wakeAir(r.id); }
          s.temperature=blendTemperature(s.temperature,ambient,-Math.expm1(-s.cooling/s.heatCapacity*h));
          if(s.temperature!==previousTemperature)wakeAir(s.roomId);
          // The event is consumed by systems such as liquid pools to debit their own
          // fuel ledgers. Keep observers from changing the amount seen by later listeners.
          if(released>0)notify('thermal:burned',Object.freeze({id:s.id,joules:released,roomId:s.roomId}));
          stats.objectSteps++;if(disposed)return;if(objects.entries.get(s.id)!==s)continue;
          if(s.burning&&(!eligible(s)||s.temperature<s.extinction))burn(s,false);
          if(disposed)return;if(objects.entries.get(s.id)!==s)continue;
          if(s.blast&&!s.blast.spent) { if(!s.blast.armed&&s.burning)api.arm(s.id);if(disposed)return;if(objects.entries.get(s.id)!==s)continue;if(s.blast.armed) {const nextClock=s.blast.clock-h;if(nextClock<=0)detonate(s,nextClock);else s.blast.clock=nextClock;} }
        }
        if(disposed)return;
        for(const [r,energy] of consumedAir) {if(rooms.entries.get(r.id)!==r)continue;r.oxygen=clamp(r.oxygen-energy*oxygenCost/r.volume,0,1);}
        for(const r of rooms.entries.values()){const temperature=blendTemperature(r.temperature,ambient,-Math.expm1(-r.coolingRate*h));if(temperature!==r.temperature)wakeAir(r.id);r.temperature=temperature;}
      }
      for(const [id,s] of changed) {if(disposed)return;if(objects.entries.get(id)!==s)continue;if(s.burning&&!eligible(s))burn(s,false);if(objects.entries.get(id)===s)notify('thermal:changed',api.state(id));}
      for(const r of [...rooms.entries.values()])if(!disposed&&rooms.entries.get(r.id)===r)notify('thermal:room',api.roomState(r.id));
      }catch(error){simulationFailed=true;throw error;}finally{stepping=false;const error=observerError,failed=observerFailed;observerError=undefined;observerFailed=false;if(!simulationFailed&&failed)throw error;}
    },
    stats() { return {...stats,objects:objects.entries.size,rooms:rooms.entries.size,vents:vents.size,connections:links.size,maxVents,maxLinks,spreadLinks:nearby.length,clock}; },
    remove(id) {removeLinks(id);dirty=true;membersChanged();return objects.remove(id);},
    dispose() { disposed=true;links.clear();linkIndex.clear();vents.clear();nearby=[];airGroups=[];objectList=[];openingCache.clear();awakeAir.clear();rooms.dispose();objects.dispose(); },
  };
  function detonate(s,nextClock=s.blast.clock) {
    const {radius,strength}=s.blast,hits=[],updates=[];
    for(const target of objects.entries.values()) {if(target===s)continue;const route=passage(s,target,radius);if(!route||route.distance>=radius)continue;const value=strength*(1-route.distance/radius)*route.open,temperature=addPowerToTemperature(target.temperature,value,50,target.heatCapacity);if(!Number.isFinite(temperature))throw new RangeError(`Blast exceeds the finite temperature range: ${target.id}`);updates.push({target,temperature});hits.push({id:target.id,strength:value});}
    s.blast.spent=true;s.blast.armed=false;s.blast.clock=nextClock;s.fuelJ=0;burn(s,false);if(disposed)return;
    for(const {target,temperature}of updates){if(objects.entries.get(target.id)!==target)continue;target.temperature=temperature;wakeAir(target.roomId);}
    notify('thermal:blast',{id:s.id,position:[...s.position],roomId:s.roomId,radius,strength,hits});
  }
  return api;
}
