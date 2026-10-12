import {registry,positive,vector,tierState,SYSTEM_TIERS} from '../host/system.js';
import {jsonState,stateId} from '../host/state.js';

function targetState(raw){
  if(raw===null)return null;
  if(!raw||typeof raw!=='object')throw new TypeError('Flow target required');
  const surfaceId=stateId(raw.surfaceId,'surfaceId'),roomId=raw.roomId??null,targetId=raw.targetId??null,thermalId=raw.thermalId??null;
  if(roomId!==null)stateId(roomId,'roomId');if(targetId!==null)stateId(targetId,'targetId');if(thermalId!==null)stateId(thermalId,'thermalId');
  const unit=v=>{v=vector(v);const length=Math.hypot(...v);if(length<1e-9)throw new RangeError('Zero aim direction');return Math.abs(length-1)<1e-12?v:v.map(n=>n/length);};
  return {surfaceId,roomId,targetId,...(thermalId===null?{}:{thermalId}),position:vector(raw.position),impactPosition:vector(raw.impactPosition??raw.position),normal:unit(raw.normal??[0,1,0]),direction:unit(raw.direction??[0,-1,0])};
}

// Analytic flow from finite storage. Input owners are transient; volume and targets are persistent.
export function createFlowSystem({supply,emit=()=>{},resolveTarget=null,acceptTarget=()=>true,apply=()=>{},quality='high',maxEmitters=32}={}){
  if(!supply?.draw||!supply?.state)throw new TypeError('Flow requires supply public API');
  if(!Number.isSafeInteger(maxEmitters)||maxEmitters<1)throw new RangeError('Invalid emitter budget');
  if(resolveTarget!==null&&typeof resolveTarget!=='function')throw new TypeError('Invalid target resolver');
  if(typeof acceptTarget!=='function'||typeof apply!=='function')throw new TypeError('Flow callbacks must be functions');
  const store=registry(),tiers=tierState(quality);let disposed=false,stepping=false;
  function live(){if(disposed)throw new Error('Flow system is disposed');}
  function deliver(e,requested,pulse=false,explicitTarget=undefined){
    const raw=explicitTarget===undefined?(resolveTarget?resolveTarget(e.id):e.target):explicitTarget,target=targetState(raw);
    if(!target||!acceptTarget(target,e.id))return {ml:0,components:{}};
    const batchable=typeof supply.beginBatch==='function'&&typeof supply.flush==='function';
    const supplyBatch=batchable?supply.beginBatch():null;
    let out;
    try{out=supply.draw(e.tankId,requested);}
    catch(error){if(batchable)try{supply.flush(supplyBatch);}catch{}throw error;}
    let failure,failed=false;
    if(batchable)try{supply.flush(supplyBatch);}catch(error){failure=error;failed=true;}
    positive(out?.ml,'delivered ml',true);
    if(out.ml>requested+1e-7||!out.components||typeof out.components!=='object'||Array.isArray(out.components))throw new Error('Invalid source delivery');
    let sum=0;for(const[kind,ml]of Object.entries(out.components)){stateId(kind,'liquid kind');sum+=positive(ml,'component ml',true);}if(Math.abs(sum-out.ml)>1e-6)throw new Error('Source components disagree with delivered volume');
    e.target=target;e.emittedMl+=out.ml;if(pulse)e.pulsedMl+=out.ml;
    if(out.ml){const receipt=()=>({...targetState(target),emitterId:e.id,sourceKey:e.sourceKey,ml:out.ml,components:{...out.components}});
      try{apply(receipt());}catch(error){if(!failed){failure=error;failed=true;}}
      // The draw and history are already committed. Always deliver both receipts so a
      // failing effect callback or first event observer cannot orphan that liquid.
      for(const event of ['flow:deposit','liquid:deposit'])try{emit(event,receipt());}catch(error){if(!failed){failure=error;failed=true;}}
    }
    if(failed)throw failure;
    return out;
  }
  const api={
    get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    add(id,{tankId,sourceKey=`flow:${id}`,rateMlPerSecond=240,target=null}={}){
      live();if(store.entries.size>=maxEmitters)throw new RangeError('Emitter budget exceeded');supply.state(tankId);stateId(sourceKey,'sourceKey');positive(rateMlPerSecond,'rate');target=targetState(target);
      store.add(id,{id,tankId,sourceKey,rateMlPerSecond,target,emittedMl:0,pulsedMl:0,flowMlPerSecond:0,owners:new Set()});return api.state(id);
    },
    state(id){live();const e=store.get(id);return {id:e.id,tankId:e.tankId,sourceKey:e.sourceKey,rateMlPerSecond:e.rateMlPerSecond,target:e.target?targetState(e.target):null,emittedMl:e.emittedMl,pulsedMl:e.pulsedMl,flowMlPerSecond:e.flowMlPerSecond,active:!!e.owners.size,owners:[...e.owners]};},
    start(id,owner='default'){live();stateId(owner,'owner');store.get(id).owners.add(owner);},
    stop(id,owner='default'){live();const e=store.get(id);e.owners.delete(owner);if(!e.owners.size)e.flowMlPerSecond=0;},
    stopAll(){live();for(const e of store.entries.values()){e.owners.clear();e.flowMlPerSecond=0;}},
    setTarget(id,target){live();store.get(id).target=targetState(target);},
    pulse(id,ml,target=undefined){live();positive(ml,'ml',true);return deliver(store.get(id),ml,true,target);},
    step(dt){live();positive(dt,'dt',true);if(dt>10)throw new RangeError('Flow update exceeds catch-up budget');
      if(stepping)throw new Error('Flow step is not reentrant');
      stepping=true;
      try{
        let failure,failed=false;
        for(const e of store.entries.values()){
          e.flowMlPerSecond=0;
          if(!e.owners.size||dt<=0)continue;
          const before=e.emittedMl,beforePulsed=e.pulsedMl;
          try{const out=deliver(e,e.rateMlPerSecond*dt);e.flowMlPerSecond=e.owners.size?out.ml/dt:0;}
          catch(error){if(!failed){failure=error;failed=true;}const committed=e.emittedMl-before-(e.pulsedMl-beforePulsed);e.flowMlPerSecond=e.owners.size?Math.max(0,committed)/dt:0;}
        }
        if(failed)throw failure;
      }finally{stepping=false;}
    },
    capture(){live();return {schema:'gamesystems.flow.v1',emitters:[...store.entries.keys()].map(id=>{const {active,owners,flowMlPerSecond,...saved}=api.state(id);return saved;})};},
    prepareRestore(raw,{supplyPlan=null}={}){
      live();const data=jsonState(raw);if(data.schema!=='gamesystems.flow.v1'||!Array.isArray(data.emitters)||data.emitters.length!==store.entries.size)throw new Error('Flow topology differs');const staged=new Map(),totals=new Map();
      for(const saved of data.emitters){const e=store.get(saved.id);if(staged.has(saved.id)||saved.tankId!==e.tankId||saved.sourceKey!==e.sourceKey||saved.rateMlPerSecond!==e.rateMlPerSecond)throw new Error('Flow topology differs');
        const emittedMl=positive(saved.emittedMl,'emittedMl',true),pulsedMl=positive(saved.pulsedMl,'pulsedMl',true);if(pulsedMl>emittedMl+1e-7)throw new Error('Pulsed volume exceeds emitted volume');
        staged.set(e.id,{target:targetState(saved.target),emittedMl,pulsedMl});totals.set(e.tankId,(totals.get(e.tankId)??0)+emittedMl);
      }
      if(supplyPlan)for(const[id,ml]of totals)if(ml>supplyPlan.state(id).drawnMl+1e-5)throw new Error('Emitted volume exceeds source ledger');
      return {sourceTotals(){const totals=Object.create(null);for(const[id,state]of staged){const key=store.get(id).sourceKey;totals[key]=(totals[key]??0)+state.emittedMl;}return {...totals};},commit(){live();for(const[id,state]of staged){const e=store.get(id);Object.assign(e,state,{target:state.target?targetState(state.target):null});e.owners.clear();e.flowMlPerSecond=0;}},notify(){for(const id of staged.keys())emit('flow:changed',api.state(id));}};
    },
    restore(data){const plan=api.prepareRestore(data);plan.commit();plan.notify();},
    dispose(){if(disposed)return;api.stopAll();disposed=true;store.dispose();},
  };return api;
}
export default function flowExtension(options={}){let api;return {id:'flow',requires:['supply'],quality:SYSTEM_TIERS,
  init(ctx){api=createFlowSystem({...options,supply:ctx.get('supply'),emit:ctx.emit,quality:ctx.quality});return api;},update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();}};}
