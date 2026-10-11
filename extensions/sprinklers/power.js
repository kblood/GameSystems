import { positive, finite } from '../host/system.js';
import { jsonState } from '../host/state.js';

// One shared pump: delivered terminal energy proportionally scales this tick's requested liquid.
// This adapter owns advancing the network; do not also register that network's update in the host.
export function createNetworkPump({ network, loadId, ratedW = 36 } = {}) {
  if (!network?.step || !network?.evaluate || !network?.setEnabled || network.state(loadId).kind !== 'load') throw new TypeError('Pump needs a circuit load');
  positive(ratedW, 'ratedW'); let disposed=false;
  let totalJ=0,lastEnergyJ=0,lastFraction=0,lastSeconds=0,requestMl=0,nominalMl=0,lastRequiredJ=0;
  function live(){if(disposed)throw new Error('Pump is disposed');}
  const api={
    powerFraction(requests,dt){
      live();positive(dt,'dt',true);if(dt>10)throw new RangeError('Pump update exceeds catch-up budget');if(!Array.isArray(requests))throw new TypeError('Pump requests required');
      let ml=0,nominal=0;for(const r of requests){ml+=positive(r.ml,'requested ml',true);nominal+=positive(r.nominalMl??r.ml,'nominal ml',true);}finite(ml,'requested volume');finite(nominal,'nominal volume');
      if(ml>nominal+1e-7)throw new Error('Requested liquid exceeds nominal flow');
      network.setEnabled(loadId,ml>0);
      network.evaluate();const watts=Math.max(0,network.state(loadId).power),required=nominal?ratedW*dt*ml/nominal:0;
      const onSeconds=ml>0&&watts>0?Math.min(dt,required/watts):0;
      const result=network.step(onSeconds),joules=Math.max(0,result.energyJ[loadId]??0);
      if(onSeconds<dt){network.setEnabled(loadId,false);network.step(dt-onSeconds);}
      lastEnergyJ=joules;totalJ+=joules;lastSeconds=dt;requestMl=ml;nominalMl=nominal;lastRequiredJ=required;
      lastFraction=required>0?Math.min(1,joules/required):0;return lastFraction;
    },
    state(){live();return {loadId,ratedW,totalJ,lastEnergyJ,lastFraction,lastSeconds,requestMl,nominalMl,lastRequiredJ};},
    capture(){return {schema:'gamesystems.network-pump.v1',...api.state()};},
    prepareRestore(raw){
      live();const data=jsonState(raw);if(data.schema!=='gamesystems.network-pump.v1'||data.loadId!==loadId||data.ratedW!==ratedW)throw new Error('Pump topology differs');
      for(const key of ['totalJ','lastEnergyJ','lastFraction','lastSeconds','requestMl'])positive(data[key],key,true);
      const nominal=positive(data.nominalMl===undefined?data.requestMl:data.nominalMl,'nominalMl',true),required=nominal?ratedW*data.lastSeconds*data.requestMl/nominal:0;
      if(data.lastRequiredJ!==undefined)positive(data.lastRequiredJ,'lastRequiredJ',true);
      if(data.requestMl>nominal+1e-7||Math.abs((data.lastRequiredJ??required)-required)>1e-7)throw new Error('Invalid pump work requirement');
      if(data.lastFraction>1||data.lastSeconds>10||data.lastEnergyJ>data.totalJ+1e-7||(!data.lastSeconds&&data.lastEnergyJ))throw new Error('Invalid pump energy receipt');
      const expected=required>0?Math.min(1,data.lastEnergyJ/required):0;
      if(Math.abs(expected-data.lastFraction)>1e-8)throw new Error('Pump fraction disagrees with energy');
      return {commit(){live();totalJ=data.totalJ;lastEnergyJ=data.lastEnergyJ;lastFraction=data.lastFraction;lastSeconds=data.lastSeconds;requestMl=data.requestMl;nominalMl=nominal;lastRequiredJ=required;}};
    },
    restore(data){api.prepareRestore(data).commit();},
    dispose(){disposed=true;},
  };
  return api;
}
