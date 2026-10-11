import {jsonState,stateId} from '../host/state.js';
import {createFuelAdapter} from '../supply/index.js';

// Registered resource providers own reserves, including stores not currently connected to the car.
export function createVehicleSceneProvider({vehicles,supply,sharedPower,standaloneFuel,standalonePower,tankId,fuelKind='petrol',sharedKey='shared',standaloneKey='standalone',application,thermal=null,pools=null,fuelFlow=null}){
  stateId(tankId);stateId(fuelKind);stateId(sharedKey);stateId(standaloneKey);if(sharedKey===standaloneKey)throw new Error('Vehicle resource binding keys must differ');
  if([thermal,pools,fuelFlow].filter(Boolean).length%3)throw new Error('Vehicle spill owners must be supplied together');
  return {
    capture(){return {schema:'gamesystems.vehicle-scene.v1',vehicles:vehicles.capture(),supply:supply.capture(),sharedPower:sharedPower.capture(),standaloneFuel:standaloneFuel.capture(),standalonePower:standalonePower.capture(),...(thermal?{spill:{thermal:thermal.capture(),pools:pools.save(),flow:fuelFlow.capture()}}:{}),application:application.capture()};},
    prepareRestore(raw){const d=jsonState(raw);if(d.schema!=='gamesystems.vehicle-scene.v1')throw new Error('Invalid vehicle scene');
      const tanks=supply.prepareRestore(d.supply),power=sharedPower.prepareRestore(d.sharedPower),fuel=standaloneFuel.prepareRestore(d.standaloneFuel),battery=standalonePower.prepareRestore(d.standalonePower);
      const futureFuel=createFuelAdapter({state:tanks.state},tankId,{kind:fuelKind}).state();
      const car=vehicles.prepareRestore(d.vehicles,{resourceStates:{[sharedKey]:{fuel:futureFuel,power:power.state()},[standaloneKey]:{fuel:fuel.state(),power:battery.state()}}});
      let spillPlans=[];
      if(thermal){const heat=thermal.prepareRestore(d.spill.thermal),liquid=pools.prepareRestore(d.spill.pools,{thermalPlan:heat}),stream=fuelFlow.prepareRestore(d.spill.flow,{supplyPlan:{state(id){return {drawnMl:car.state(id).spilledL*1000};}}});
        for(const[key,emitted]of Object.entries(stream.sourceTotals())){const remaining=liquid.records().reduce((n,p)=>n+Object.values(p.sources[key]??{}).reduce((sum,ml)=>sum+ml,0),0);if(remaining>emitted+1e-5)throw new Error('Spill source exceeds emitted fuel');}
        spillPlans=[heat,liquid,stream];
      }
      const app=application.prepareRestore(d.application,{vehiclePlan:car});const plans=[tanks,power,fuel,battery,car,...spillPlans,app];
      if(plans.some(p=>typeof p?.commit!=='function'||p.commit.constructor?.name==='AsyncFunction'))throw new TypeError('Vehicle scene plans must be synchronous');
      return {commit(){for(const p of plans)p.commit();},notify(){for(const p of plans)p.notify?.();}};
    },
  };
}
