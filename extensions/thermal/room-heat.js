import {positive,finite} from '../host/system.js';

// Effective gameplay capacity includes the room's heat storage; not an airflow/material model.
export function roomHeatProfile({volume=1,heatCapacityPerVolume=1200,heatFraction=.08,coolingRate=.005}={}){
  positive(heatCapacityPerVolume,'heatCapacityPerVolume');positive(coolingRate,'coolingRate',true);finite(heatFraction);
  if(heatFraction<0||heatFraction>1)throw new RangeError('heatFraction must be 0..1');
  positive(volume*heatCapacityPerVolume,'room heat capacity');
  return {heatCapacityPerVolume,heatFraction,coolingRate};
}
