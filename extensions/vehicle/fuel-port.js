import {positive} from '../host/system.js';

// Supply-shaped port for the vehicle's active fuel adapter. Litres are converted only at this boundary.
export function createVehicleFuelPort(vehicles,vehicleId){
  vehicles.state(vehicleId);function known(id){if(id!==vehicleId)throw new Error('Unknown vehicle fuel port');return vehicles.state(id);}
  return {
    state(id){const s=known(id),kind=s.fuel.kind??'unknown',ml=s.fuel.amountL*1000;return {id,ml,capacityMl:s.fuel.capacityL*1000,components:{[kind]:ml},drawnMl:s.spilledL*1000};},
    draw(id,ml){const s=known(id);positive(ml,'ml',true);const actual=vehicles.withdrawFuel(id,ml/1000)*1000,kind=s.fuel.kind??'unknown';return {ml:actual,components:actual?{[kind]:actual}:{}};},
  };
}
