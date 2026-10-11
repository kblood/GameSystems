import { positive, finite, vector } from '../host/system.js';
import { jsonState, stateId, booleanState } from '../host/state.js';
import {roomHeatProfile} from './room-heat.js';
import {portalBounds} from './portal.js';

export function prepareThermalState(raw, { config, maxObjects, maxRooms, maxVents=4096,maxLinks=8192,makeObject }) {
  const data = jsonState(raw);
  if (data.schema !== 'gamesystems.thermal.v1' || !data.config || Object.keys(data.config).length!==Object.keys(config).length || Object.keys(config).some(key=>data.config[key]!==config[key])) throw new Error('Thermal checkpoint configuration differs');
  if (!Array.isArray(data.rooms) || !Array.isArray(data.objects) || !Array.isArray(data.vents) || !Array.isArray(data.links)) throw new Error('Invalid thermal checkpoint');
  if (data.rooms.length > maxRooms || data.objects.length > maxObjects || data.vents.length > maxVents || data.links.length > maxLinks) throw new RangeError('Thermal checkpoint exceeds budget');
  const rooms = new Map(), objects = new Map(), vents = new Map(), links = new Map();
  const insert = (map, id, value) => { stateId(id); if (map.has(id)) throw new Error(`Duplicate state id: ${id}`); map.set(id, value); };
  for (const r of data.rooms) {
    const floor = finite(r.floor), ceiling = finite(r.ceiling), oxygen = finite(r.oxygen);
    if (ceiling <= floor || oxygen < 0 || oxygen > 1) throw new Error('Invalid saved room');
    insert(rooms, r.id, { id: r.id, volume: positive(r.volume), oxygen, smoke: positive(r.smoke, 'smoke', true), temperature: finite(r.temperature), floor, ceiling,...roomHeatProfile(r) });
  }
  const room = id => { const r = rooms.get(id); if (!r) throw new Error(`Unknown saved room: ${id}`); return r; };
  for (const rawObject of data.objects) {
    const s = makeObject(rawObject.id, rawObject, room);
    s.extinctionAuto = booleanState(rawObject.extinctionAuto, 'extinctionAuto');
    s.wetMl = positive(rawObject.wetMl, 'wetMl', true); s.heaterW = positive(rawObject.heaterW, 'heaterW', true);
    s.blanket = finite(rawObject.blanket); if (s.blanket < 0 || s.blanket > 1) throw new Error('Invalid saved blanket');
    s.burning = booleanState(rawObject.burning, 'burning');
    if (s.burning && (s.fuelJ <= 0 || s.flammability <= 0 || s.wetMl >= 1e-8 || s.blanket >= .95 || s.temperature < s.extinction || (s.roomId && room(s.roomId).oxygen <= config.oxygenCutoff + .01))) throw new Error('Saved burning state is inconsistent');
    if (s.blast) {
      const b = rawObject.blast;
      s.blast.armed = booleanState(b.armed, 'armed'); s.blast.spent = booleanState(b.spent, 'spent'); s.blast.clock = finite(b.clock);
      if ((b.armed && b.spent) || (!b.spent && b.clock < 0)) throw new Error('Invalid saved charge state');
    }
    insert(objects, s.id, s);
  }
  for (const v of data.vents) {
    room(v.a); if (v.b !== null) room(v.b);
    const open = finite(v.open); if (v.a === v.b || open < 0 || open > 1) throw new Error('Invalid saved vent');
    insert(vents, v.id, { id: v.id, a: v.a, b: v.b, open, flow: positive(v.flow, 'flow', true),portal:portalBounds(v.portal??null) });
  }
  for (const l of data.links) {
    if (!objects.has(l.a) || !objects.has(l.b) || l.a === l.b) throw new Error('Invalid saved heat connection');
    const key = JSON.stringify([l.a, l.b].sort()); if (links.has(key)) throw new Error('Duplicate saved heat connection');
    links.set(key, { a: l.a, b: l.b, conductance: positive(l.conductance) });
  }
  const pending = positive(data.pending, 'pending', true), clock = positive(data.clock, 'clock', true);
  if (pending >= config.fixedStep + 1e-10) throw new Error('Invalid saved fixed-step phase');
  return { rooms, objects, vents, links, pending, clock };
}
