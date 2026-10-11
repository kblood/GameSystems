import { extension } from '../host/system.js';
import { createThermalSystem } from './fire.js';
export { createThermalSystem, FIRE_PRESETS } from './fire.js';
export { assessFireHazards } from './hazards.js';
export { createElectricalHeatAdapter } from './electrical-heat.js';
export default options => extension('thermal', createThermalSystem, options, (ctx, api) => {
  ctx.on('liquid:deposit', ({ thermalId, ml, kind }) => { if (thermalId && kind === 'water') { try { api.state(thermalId); } catch { return; } api.water(thermalId, ml); } });
});
