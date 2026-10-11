import { jsonState } from '../host/state.js';

// Composition: uses only each system's public checkpoint API; presentation/storage remain application-owned.
export function createFireSceneProvider({ thermal, pools, bottles, mechanics, application,supply=null,flow=null,coatings=null }) {
  if(!!supply!==!!flow)throw new TypeError('Fire scene supply and flow must be provided together');
  if(flow&&flow.capture().emitters.some(e=>e.sourceKey===bottles.sourceKey))throw new Error('Flow and bottle owners share a liquid source key');
  function capture(){return {schema:'gamesystems.fire-scene.v1',thermal:thermal.capture(),pools:pools.save(),bottles:bottles.capture(),mechanics:mechanics.capture(),...(supply?{supply:supply.capture(),flow:flow.capture()}:{}),...(coatings?{coatings:coatings.capture()}:{}),application:application.capture()};}
  function prepareRestore(raw){
    const data=jsonState(raw);if(data.schema!=='gamesystems.fire-scene.v1')throw new Error('Invalid fire-scene checkpoint');
    const fire=thermal.prepareRestore(data.thermal),liquid=pools.prepareRestore(data.pools,{thermalPlan:fire}),source=bottles.prepareRestore(data.bottles),joints=mechanics.prepareRestore(data.mechanics);
    const tanks=supply?supply.prepareRestore(data.supply):null,stream=flow?flow.prepareRestore(data.flow,{supplyPlan:tanks}):null;
    const coat=coatings?coatings.prepareRestore(data.coatings,{thermalPlan:fire}):null;
    const app=application.prepareRestore(data.application,{thermalPlan:fire,mechanicsPlan:joints,poolRecords:liquid.records(),supplyPlan:tanks,flowPlan:stream});
    const ledger=source.ledger(),sourceKey=bottles.sourceKey;
    const tracked=liquid.records().reduce((n,p)=>n+Object.values(p.sources[sourceKey]??{}).reduce((sum,ml)=>sum+ml,0),0);
    if(Math.abs(tracked-ledger.puddleMl)>1e-5)throw new Error('Pool source volume disagrees with source world ledger');
    if(stream)for(const[key,emitted]of Object.entries(stream.sourceTotals())){
      if(key===sourceKey)throw new Error('Flow and bottle owners share a liquid source key');
      const remaining=liquid.records().reduce((n,p)=>n+Object.values(p.sources[key]??{}).reduce((sum,ml)=>sum+ml,0),0);
      if(remaining>emitted+1e-5)throw new Error('Pool flow source exceeds emitted volume');
    }
    const plans=[fire,source,liquid,joints,...(tanks?[tanks,stream]:[]),...(coat?[coat]:[]),app];
    if(plans.some(plan=>typeof plan?.commit!=='function'||plan.commit.constructor?.name==='AsyncFunction'))throw new TypeError('Fire-scene commits must be synchronous');
    return {commit(){for(const plan of plans)plan.commit();},notify(){for(const plan of plans)plan.notify?.();},dispose(){for(const plan of plans)plan.dispose?.();}};
  }
  return {capture,prepareRestore};
}
