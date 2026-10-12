import { positive } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

// Finite energy adapter for vehicles/pumps. Network coupling is explicit: draw the solved load's Wh.
export function createEnergyStore({ capacityWh = 600, energyWh = capacityWh, voltage = 12, enabled = true, emit = () => {} } = {}) {
  positive(capacityWh, 'capacityWh'); positive(energyWh, 'energyWh', true); positive(voltage, 'voltage'); booleanState(enabled);
  if (energyWh > capacityWh) throw new RangeError('Initial energy exceeds capacity');
  const initialWh = energyWh; let chargedWh = 0, suppliedWh = 0, disposed = false;
  function live() { if (disposed) throw new Error('Battery is disposed'); }
  function publish() { emit('electricity:battery', api.state()); }
  const api = {
    reversible: true,
    state() { live(); return { capacityWh, energyWh, voltage, enabled, initialWh, chargedWh, suppliedWh, chargeFraction: energyWh / capacityWh }; },
    draw(wh) { live(); positive(wh, 'Wh', true); const actual = enabled ? Math.min(energyWh, wh) : 0; energyWh -= actual; suppliedWh += actual; publish(); return actual; },
    charge(wh) { live(); positive(wh, 'Wh', true); const actual = enabled ? Math.min(capacityWh - energyWh, wh) : 0; energyWh += actual; chargedWh += actual; publish(); return actual; },
    setEnabled(value) { live(); enabled = booleanState(value); publish(); },
    supplyWatts(watts, seconds) { positive(watts, 'watts', true); positive(seconds, 'seconds', true); return api.draw(watts * seconds / 3600) * 3600; },
    capture() { return { schema: 'gamesystems.battery.v1', ...api.state() }; },
    prepareRestore(raw) {
      live(); const data = jsonState(raw);
      if (data.schema !== 'gamesystems.battery.v1' || data.capacityWh !== capacityWh || data.voltage !== voltage || data.initialWh !== initialWh) throw new Error('Battery topology differs');
      positive(data.energyWh, 'energyWh', true); positive(data.chargedWh, 'chargedWh', true); positive(data.suppliedWh, 'suppliedWh', true); booleanState(data.enabled);
      if (data.energyWh > capacityWh || Math.abs(initialWh + data.chargedWh - data.suppliedWh - data.energyWh) > 1e-7) throw new Error('Battery ledger does not balance');
      return {state(){return {...data};}, commit() { live(); energyWh = data.energyWh; enabled = data.enabled; chargedWh = data.chargedWh; suppliedWh = data.suppliedWh; }, notify: publish };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    dispose() { disposed = true; },
  };
  return api;
}
