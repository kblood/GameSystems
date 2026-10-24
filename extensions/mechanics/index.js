import { registry, finite, positive, clamp, vector, unit, dot, extension, tierState } from '../host/system.js';
import { jsonState, booleanState } from '../host/state.js';

// Analytic one-degree-of-freedom constraints. The host applies output poses to rendering/physics.
export function createMechanicsSystem({ emit = () => {}, quality = 'high', applyPose = () => {} } = {}) {
  const store = registry(), tiers = tierState(quality), holds = new Map();
  const holdKey = (id, owner) => JSON.stringify([id, owner]);
  const api = {
    get quality() { return tiers.quality; }, setQuality: tiers.setQuality,
    capture() {return {schema:'gamesystems.mechanics.v1',constraints:[...store.entries.values()].map(({forces,...m})=>({...m,origin:[...m.origin],axis:[...m.axis]}))};},
    prepareRestore(raw) {
      const data=jsonState(raw);
      if(data.schema!=='gamesystems.mechanics.v1'||!Array.isArray(data.constraints)||data.constraints.length!==store.entries.size)throw new Error('Mechanical checkpoint topology differs');
      const planned=new Map();
      for(const saved of data.constraints){
        const current=store.get(saved.id);if(planned.has(saved.id))throw new Error('Duplicate mechanical state');
        for(const key of ['kind','origin','axis','min','max','inertia','resistance','damping','spring','rest'])if(JSON.stringify(saved[key])!==JSON.stringify(current[key]))throw new Error(`Mechanical configuration differs: ${saved.id}`);
        const value=finite(saved.value),velocity=finite(saved.velocity),locked=booleanState(saved.locked,'locked');
        if(value<current.min||value>current.max||(locked&&velocity!==0))throw new Error('Invalid saved mechanical coordinate');
        planned.set(saved.id,{value,velocity,locked});
      }
      return {state(id){const s=planned.get(id),m=store.get(id);if(!s)throw new Error('Unknown saved mechanism');return {...s,id,fraction:(s.value-m.min)/(m.max-m.min)};},commit(){holds.clear();for(const[id,s]of planned){const m=store.get(id);Object.assign(m,s);m.forces.clear();}},notify(){for(const[id]of planned)publish(store.get(id));}};
    },
    restore(raw){const plan=api.prepareRestore(raw);plan.commit();plan.notify();},
    add(id, { kind = 'slider', origin = [0, 0, 0], axis = [1, 0, 0], min = 0, max = 1,
      value = min, inertia = 1, resistance = 0.1, damping = 4, spring = 0, rest = min, locked = false } = {}) {
      if (!['slider', 'hinge', 'valve'].includes(kind)) throw new RangeError('Unknown mechanism kind');
      finite(min); finite(max); if (max <= min) throw new RangeError('max must exceed min');
      const m = store.add(id, { id, kind, origin: vector(origin), axis: unit(axis), min, max,
        value: clamp(finite(value), min, max), velocity: 0, inertia: positive(inertia), resistance: positive(resistance, 'resistance', true),
        damping: positive(damping, 'damping', true), spring: positive(spring, 'spring', true), rest: clamp(finite(rest), min, max), locked: !!locked, forces: new Map() });
      publish(m); return api.state(id);
    },
    state(id) { const m = store.get(id); return { id, kind: m.kind, value: m.value, velocity: m.velocity, locked: m.locked, fraction: (m.value - m.min) / (m.max - m.min), pose: pose(m) }; },
    setLocked(id, locked) { const m = store.get(id); m.locked = !!locked; if (locked) m.velocity = 0; emit('mechanics:lock', { id, locked: m.locked }); },
    setValue(id, value) { const m = store.get(id); if (m.locked) return false; m.value = clamp(finite(value), m.min, m.max); m.velocity = 0; publish(m); return true; },
    // External force (N for slider, Nm for hinge/valve). Two hands add their forces.
    drive(id, owner, force) { const m = store.get(id); if (!owner) throw new Error('drive needs owner'); m.forces.set(owner, finite(force)); },
    release(id, owner) { store.get(id).forces.delete(owner); holds.delete(holdKey(id, owner)); },
    grab(id, owner, point) { const m = store.get(id); holds.set(holdKey(id, owner), { id, point: vector(point), value: m.value }); },
    // maxForce (optional, added for extensions/furniture): caps the hand's force (N / Nm) so one hand cannot move an arbitrarily heavy part; default unlimited = unchanged.
    moveHand(id, owner, point, stiffness = 80, maxForce = Infinity) {
      const m = store.get(id), h = holds.get(holdKey(id, owner)); if (!h) return false;
      point = vector(point); positive(stiffness); if (maxForce !== Infinity) positive(maxForce, 'maxForce');
      let target;
      if (m.kind === 'slider') target = h.value + dot(point.map((v, i) => v - h.point[i]), m.axis);
      else {
        const radial = p => { const r = p.map((v, i) => v - m.origin[i]); const along = dot(r, m.axis); return r.map((v, i) => v - along * m.axis[i]); };
        const a = radial(h.point), b = radial(point);
        if (Math.hypot(...a) < 0.01 || Math.hypot(...b) < 0.01) return false;
        const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
        target = h.value + Math.atan2(dot(m.axis, cross), dot(a, b));
      }
      api.drive(id, owner, clamp((clamp(target, m.min, m.max) - m.value) * stiffness, -maxForce, maxForce)); return true;
    },
    step(dt) {
      positive(dt, 'dt', true); if (!dt) return;
      const steps = Math.ceil(dt / (1 / 120)); if (steps > 1200) throw new RangeError('dt exceeds 10 seconds'); const h = dt / steps;
      for (const m of store.entries.values()) {
        if (m.locked) continue;
        const before = m.value;
        for (let i = 0; i < steps; i++) {
          let f = [...m.forces.values()].reduce((a, b) => a + b, 0) - m.spring * (m.value - m.rest);
          if (Math.abs(m.velocity) < 1e-5 && Math.abs(f) <= m.resistance) { m.velocity = 0; continue; }
          f -= Math.sign(m.velocity || f) * m.resistance;
          m.velocity = (m.velocity + f / m.inertia * h) * Math.exp(-m.damping * h);
          const raw = m.value + m.velocity * h;
          m.value = clamp(raw, m.min, m.max);
          if (raw !== m.value) {
            const speed = Math.abs(m.velocity); m.velocity = 0;
            if (speed > 0.05 && before !== m.value) emit('mechanics:stop', { id: m.id, position: pose(m).position, speed, energy: 0.5 * m.inertia * speed * speed });
          }
        }
        if (before !== m.value) publish(m);
      }
    },
    remove(id) { for (const [key, hold] of holds) if (hold.id === id) holds.delete(key); return store.remove(id); },
    releaseAll() { holds.clear(); for (const m of store.entries.values()) m.forces.clear(); },
    dispose() { holds.clear(); store.dispose(); },
  };
  function pose(m) {
    if (m.kind === 'slider') return { position: m.origin.map((v, i) => v + m.axis[i] * m.value), quaternion: [0, 0, 0, 1] };
    return { position: [...m.origin], quaternion: [...m.axis.map(v => v * Math.sin(m.value / 2)), Math.cos(m.value / 2)] };
  }
  function publish(m) { const s = api.state(m.id); applyPose(m.id, s.pose, s); emit('mechanics:changed', s); }
  return api;
}
export default options => extension('mechanics', createMechanicsSystem, options, (ctx, api) => {
  for (const event of ['xrEnd', 'disconnect']) ctx.on(event, () => api.releaseAll());
});
