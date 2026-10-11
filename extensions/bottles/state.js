import * as THREE from 'three';
import { finite, positive, vector } from '../host/system.js';
import { jsonState, stateId, booleanState } from '../host/state.js';
import { liquidAbsorbance, setBottleAbsorbance } from './liquid_color.js';
import { MAX_HOLE_RADIUS } from './breakage.js';

const keyFor=(b,i)=>b.checkpointId??`bottle-${i}`;
const MAX_SAVED_DAMAGE_MARKS=8;
const quaternion=q=>{
  if(!Array.isArray(q)||q.length!==4||!q.every(Number.isFinite)||Math.abs(Math.hypot(...q)-1)>.001)throw new Error('Invalid saved quaternion');
  return [...q];
};
const absorbance=a=>{a=vector(a,'absorbance');if(a.some(v=>v<0))throw new Error('Invalid absorbance');return a;};
const proportions=raw=>{
  if(raw===null)return null;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid liquid composition');
  const clean={};let sum=0;for(const[k,v]of Object.entries(raw)){stateId(k,'liquid kind');Object.defineProperty(clean,k,{value:positive(v,'composition',true),enumerable:true,writable:true});sum+=v;}
  if(Math.abs(sum-1)>1e-5)throw new Error('Liquid composition fractions must sum to one');return clean;
};
const millisecondsSince=t=>Number.isFinite(t)?Math.max(0,performance.now()-t):null;

// Same authored bottle topology, with logical liquid, airborne drops, VFX puddles and body state restored together.
export function createBottleStateOwner({factory,pour,bodies,physics,scene,breakage,sourceKey}) {
  let disposed=false;
  const live=()=>{if(disposed)throw new Error('Bottle state owner is disposed');};
  function inventory(){const list=[...factory.bottles],map=new Map();list.forEach((b,i)=>{const key=stateId(keyFor(b,i),'checkpointId');if(map.has(key))throw new Error('Duplicate bottle checkpoint id');map.set(key,b);});return map;}
  function reference(b,map){for(const[key,item]of map)if(item===b)return key;return null;}
  function surfaceKey(mesh){return mesh.userData?.materialId??mesh.uuid;}
  function capture(){
    live();
    const map=inventory();
    for(const b of map.values())if(b.broken||!bodies.has(b.entry))throw new Error('Bottle is being removed or broken');
    const streamKey=key=>{for(const[id,b]of map){if(key===b)return {source:id,hole:null};const hole=b.holes.indexOf(key);if(hole>=0)return {source:id,hole};}throw new Error('Stream has no checkpoint owner');};
    return {schema:'gamesystems.bottles.v1',sourceKey,ledger:pour.ledger(),bottles:[...map].map(([key,b])=>({key,id:b.id,design:b.design,capacity:b.capacity,
      fillMl:b.fillMl,open:b.open,kind:b.liquidKind??'unknown',composition:b.liquidComposition?{...b.liquidComposition}:null,absorbance:[...liquidAbsorbance(b)],
      pose:physics.pose(b.entry),velocity:physics.velocity(b.entry),held:physics.isHeld(b.entry),damage:b.damage,damageStage:b.damageStage,
      lastImpactAgo:millisecondsSince(b.lastImpact),lastPourAgo:millisecondsSince(b.lastPour),
      damageMarks:(b.damageMarks??[]).map(mark=>{const normal=new THREE.Vector3(0,0,1).applyQuaternion(mark.quaternion).normalize();return {point:mark.position.clone().addScaledVector(normal,-0.001).toArray(),normal:normal.toArray(),kind:mark.userData.damageKind};}),
      holes:(b.holes??[]).map(h=>({point:h.point.toArray(),normal:h.normal.toArray(),radius:h.radius,isExit:!!h.isExit}))})),
      flights:pour.flights.map(f=>({ml:f.ml,position:f.position.toArray(),velocity:f.velocity.toArray(),source:reference(f.source,map),kind:f.kind,components:{...f.components},absorbance:[...f.absorbance],age:f.age})),
      puddles:pour.puddles.map(p=>({ml:p.ml,radius:p.radius,targetRadius:p.targetRadius,age:p.age,absorbance:[...p.absorbance],surfaceId:surfaceKey(p.hit.object),point:p.hit.point.toArray(),normal:p.hit.normal.toArray(),localNormal:p.hit.localNormal.toArray()})),
      streams:[...pour.streams].map(([key,s])=>({...streamKey(key),point:s.point.toArray(),velocity:s.velocity.toArray(),timer:s.timer,
        points:s.mesh.geometry.parameters.path.points.map(p=>p.toArray()),radius:s.mesh.geometry.parameters.radius,segments:s.mesh.geometry.parameters.tubularSegments,absorbance:[...liquidAbsorbance(plannedBottleFor(key,map))]})),
      panes:breakage.capturePaneState()};
  }
  function plannedBottleFor(key,map){for(const b of map.values())if(key===b||b.holes.includes(key))return b;throw new Error('Unknown stream bottle');}
  function prepareRestore(raw){
    live();
    const data=jsonState(raw),map=inventory();
    if(data.schema!=='gamesystems.bottles.v1'||data.sourceKey!==sourceKey||!Array.isArray(data.bottles)||data.bottles.length!==map.size||!Array.isArray(data.flights)||data.flights.length>4096||!Array.isArray(data.puddles)||data.puddles.length>256)throw new Error('Bottle checkpoint topology/budget differs');
    if(data.panes===undefined&&breakage.panes.length)throw new Error('Legacy bottle checkpoint has no pane state');
    const panePlan=breakage.preparePaneRestore(data.panes??[]),planned=new Map();
    for(const saved of data.bottles){
      const b=map.get(saved.key);if(!b||planned.has(saved.key)||saved.id!==b.id||saved.design!==b.design||saved.capacity!==b.capacity)throw new Error('Saved bottle does not match authored model');
      const fillMl=positive(saved.fillMl,'fillMl',true);if(fillMl>b.capacity+1e-7)throw new Error('Saved bottle exceeds capacity');
      const pose={position:vector(saved.pose?.position),quaternion:quaternion(saved.pose?.quaternion)},velocity={linear:vector(saved.velocity?.linear),angular:vector(saved.velocity?.angular)};
      const damage=finite(saved.damage);if(damage<0||damage>1||typeof saved.damageStage!=='string')throw new Error('Invalid damage state');
      if(!Array.isArray(saved.holes)||saved.holes.length>3)throw new Error('Invalid saved holes');
      const holes=saved.holes.map(h=>{const normal=vector(h.normal),radius=positive(h.radius);if(Math.abs(Math.hypot(...normal)-1)>.001||radius>MAX_HOLE_RADIUS)throw new Error('Invalid saved hole geometry');return {point:vector(h.point),normal,radius,isExit:booleanState(h.isExit)};});
      const rawDamageMarks=saved.damageMarks??[];
      if(!Array.isArray(rawDamageMarks)||rawDamageMarks.length>MAX_SAVED_DAMAGE_MARKS)throw new Error('Invalid saved damage marks');
      const damageMarks=rawDamageMarks.map(mark=>{const normal=vector(mark.normal);if(Math.abs(Math.hypot(...normal)-1)>.001||!['crack','dent'].includes(mark.kind))throw new Error('Invalid saved damage mark');return {point:vector(mark.point),normal,kind:mark.kind};});
      const lastImpactAgo=saved.lastImpactAgo===null?null:positive(saved.lastImpactAgo,'lastImpactAgo',true),lastPourAgo=saved.lastPourAgo===null?null:positive(saved.lastPourAgo,'lastPourAgo',true);
      const held=booleanState(saved.held);if(held&&[...velocity.linear,...velocity.angular].some(v=>Math.abs(v)>1e-8))throw new Error('Held bottle has dynamic velocity');
      planned.set(saved.key,{b,fillMl,pose,velocity,held,open:booleanState(saved.open),kind:stateId(saved.kind),composition:proportions(saved.composition),absorbance:absorbance(saved.absorbance),damage,damageStage:saved.damageStage,holes,damageMarks,lastImpactAgo,lastPourAgo});
    }
    const flights=data.flights.map(f=>{
      const ml=positive(f.ml),components={};let amount=0;
      if(!f.components||typeof f.components!=='object'||Array.isArray(f.components))throw new Error('Invalid airborne components');
      for(const[k,v]of Object.entries(f.components??{})){stateId(k);Object.defineProperty(components,k,{value:positive(v,'flight component',true),enumerable:true,writable:true});amount+=v;}
      if(Math.abs(amount-ml)>1e-5||(f.source!==null&&!planned.has(f.source)))throw new Error('Invalid airborne liquid state');
      return {ml,components,position:vector(f.position),velocity:vector(f.velocity),source:f.source,kind:stateId(f.kind),absorbance:absorbance(f.absorbance),age:positive(f.age,'age',true)};
    });
    const surfaces=new Map(pour.surfaces.meshes.map(mesh=>[surfaceKey(mesh),mesh]));
    const puddles=data.puddles.map(p=>{
      const mesh=surfaces.get(p.surfaceId);if(!mesh)throw new Error('Saved puddle surface is not in this scene');
      const normal=vector(p.normal),localNormal=vector(p.localNormal);if(Math.abs(Math.hypot(...normal)-1)>.001||Math.abs(Math.hypot(...localNormal)-1)>.001)throw new Error('Invalid puddle normal');
      return {ml:positive(p.ml),radius:positive(p.radius),targetRadius:positive(p.targetRadius),age:positive(p.age,'age',true),absorbance:absorbance(p.absorbance),hit:{object:mesh,point:new THREE.Vector3(...vector(p.point)),normal:new THREE.Vector3(...normal),localNormal:new THREE.Vector3(...localNormal),key:`${mesh.uuid}:${localNormal.join(',')}`}};
    });
    if(!Array.isArray(data.streams)||data.streams.length>planned.size*4)throw new Error('Invalid saved streams');
    const streamIds=new Set(),streams=data.streams.map(s=>{
      const b=planned.get(s.source),key=`${s.source}:${s.hole}`;
      if(!b||streamIds.has(key)||(s.hole!==null&&(!Number.isInteger(s.hole)||s.hole<0||s.hole>=b.holes.length)))throw new Error('Invalid saved stream owner');streamIds.add(key);
      if(!Array.isArray(s.points)||s.points.length<2||s.points.length>49||!Number.isInteger(s.segments)||s.segments<1||s.segments>100)throw new Error('Invalid stream geometry');
      return {...s,points:s.points.map(p=>vector(p)),point:vector(s.point),velocity:vector(s.velocity),timer:positive(s.timer,'timer',true),radius:positive(s.radius),absorbance:absorbance(s.absorbance)};
    });
    const ledger={};for(const key of ['initialMl','puddleMl','lostMl','burnedMl','removedMl'])ledger[key]=positive(data.ledger?.[key],key,true);
    const fill=[...planned.values()].reduce((n,b)=>n+b.fillMl,0),air=flights.reduce((n,f)=>n+f.ml,0),visible=puddles.reduce((n,p)=>n+p.ml,0);
    const counted=fill+air+ledger.puddleMl+ledger.lostMl+ledger.burnedMl+ledger.removedMl;
    if(!Number.isFinite(counted)||!Number.isFinite(visible)||Math.abs(ledger.initialMl-counted)>1e-5||visible>ledger.puddleMl+1e-5)throw new Error('Saved bottle volume ledger does not balance');
    if(Math.abs((data.ledger.inBottlesMl??fill)-fill)>1e-5||Math.abs((data.ledger.inFlightMl??air)-air)>1e-5)throw new Error('Saved source subtotals disagree');
    return {ledger:()=>({...ledger,inBottlesMl:fill,inFlightMl:air}),
      commit(){
        live();
        const current=inventory();
        if(current.size!==planned.size||[...planned].some(([key,s])=>current.get(key)!==s.b||!bodies.has(s.b.entry)||s.b.broken))throw new Error('Bottle topology changed after preparing checkpoint');
        panePlan.commit();pour.clear();breakage.previous.clear();bodies.pending.clear();
        for(const saved of planned.values()){
          const b=saved.b;b.fillMl=saved.fillMl;b.open=saved.open;b.liquid.capOpen=saved.open;b.liquid.fill=b.fillMl/b.capacity;b.liquidKind=saved.kind;
          if(saved.composition)b.liquidComposition={...saved.composition};else delete b.liquidComposition;
          setBottleAbsorbance(b,saved.absorbance);b.damage=saved.damage;b.damageStage=saved.damageStage;
          b.root.traverse(o=>{if(o.name.startsWith('Cap'))o.visible=!b.open;});
          for(const h of b.holes??[]){b.root.remove(h.mark);h.mark?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}b.holes=[];
          for(const mark of b.damageMarks??[]){b.root.remove(mark);mark.geometry?.dispose();mark.material?.dispose();}b.damageMarks=[];
          physics.hold(b.entry,saved.pose);if(!saved.held)physics.release(b.entry,saved.velocity.linear,saved.velocity.angular);
          b.root.position.fromArray(saved.pose.position);b.root.quaternion.fromArray(saved.pose.quaternion);b.root.updateWorldMatrix(true,true);
          for(const h of saved.holes)breakage.addHoleLocal(b,new THREE.Vector3(...h.point),new THREE.Vector3(...h.normal),h.radius/(h.isExit?1.5:1),h.isExit);
          for(const mark of saved.damageMarks.slice(-factory.settings.damageMarks))breakage.addDamageMarkLocal(b,new THREE.Vector3(...mark.point),new THREE.Vector3(...mark.normal),mark.kind);
          b.lastImpact=saved.lastImpactAgo===null?-Infinity:performance.now()-saved.lastImpactAgo;b.lastPour=saved.lastPourAgo===null?0:performance.now()-saved.lastPourAgo;
          b.mass=b.profile.mass(b.fillMl/b.capacity);bodies.setMass(b.entry,b.mass);
        }
        for(const f of flights){pour.restoreFlight({...f,position:new THREE.Vector3(...f.position),velocity:new THREE.Vector3(...f.velocity),source:f.source===null?null:planned.get(f.source).b});}
        for(const p of puddles)pour.restoreVisualPuddle(p);
        for(const s of streams){const b=planned.get(s.source).b;pour.restoreStream(s.hole===null?b:b.holes[s.hole],s);}
        Object.assign(pour,ledger);bodies.sync();
      },
    };
  }
  return {capture,prepareRestore,dispose(){disposed=true;}};
}
