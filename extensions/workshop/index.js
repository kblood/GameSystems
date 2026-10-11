// Optional composition: only public APIs and host events. Each underlying system can run alone.
export const WORKSHOP_IDS = Object.freeze(['mechanics', 'electricity', 'materials', 'thermal', 'tools', 'acoustics']);
export default function workshopExtension({ onSurface = () => {}, onState = () => {} } = {}) {
  let instance, cleanup;
  return { id: 'workshop', requires: WORKSHOP_IDS,
    dispose() { (instance?.dispose ?? cleanup)?.(); instance = null; cleanup = null; },
    init(ctx) {
      const systems = Object.fromEntries(WORKSHOP_IDS.map(id => [id, ctx.get(id)]));
      const { mechanics: m, electricity: e, materials: s, thermal: t, tools, acoustics: a } = systems;
      const owned = { mechanics: [], electricity: [], materials: [], thermal: [], tools: [], rooms: [], portals: [], listeners: [] };
      let cleaned = false, ownsSpareFuse = false;
      const ownerTokens = new Map(), tokenFor = owner => {
        if (!owner) return owner;
        if (!ownerTokens.has(owner)) ownerTokens.set(owner, { workshopOwner: owner });
        return ownerTokens.get(owner);
      };
      const present = (group, id) => {
        if (group === 'rooms') { try { a.path(id, id); return true; } catch { return false; } }
        if (!['mechanics', 'electricity', 'materials', 'thermal', 'tools'].includes(group)) return false;
        try { systems[group].state(id); return true; } catch { return false; }
      };
      const acquire = (group, id, create) => {
        const existed = present(group, id);
        try { const value = create(); owned[group].push(id); return value; }
        catch (error) { if (!existed && present(group, id)) owned[group].push(id); throw error; }
      };
      const cleanupOwned = () => {
        if (cleaned) return;
        cleaned = true;
        for (const id of owned.listeners.reverse()) a.removeListener(id);
        for (const id of owned.portals.reverse()) a.removePortal(id);
        for (const id of owned.rooms.reverse()) a.removeRoom(id);
        if (ownsSpareFuse && owned.tools.includes('fuseSocket')) {
          const cleanupOwner = {};
          const partId = tools.removePart('fuseSocket', cleanupOwner);
          if (partId) tools.release(partId, cleanupOwner);
          for (const token of ownerTokens.values()) tools.release('spareFuse', token);
        }
        for (const [system, ids] of Object.entries({ mechanics: owned.mechanics, electricity: owned.electricity,
          materials: owned.materials, thermal: owned.thermal, tools: owned.tools })) {
          for (const id of ids.reverse()) systems[system].remove(id);
        }
      };
      cleanup = cleanupOwned;
      try {
      acquire('mechanics', 'drawer', () => m.add('drawer', { origin: [-1.6, 0.65, -0.15], axis: [0, 0, 1], max: 0.5, inertia: 1, damping: 8 }));
      acquire('mechanics', 'switch', () => m.add('switch', { kind: 'valve', origin: [-0.7, 1.72, 0], axis: [0, 0, 1], max: Math.PI / 2, resistance: 0.01 }));
      acquire('mechanics', 'door', () => m.add('door', { kind: 'hinge', origin: [1.85, 0, -0.25], axis: [0, 1, 0], max: Math.PI / 2, locked: true }));
      acquire('mechanics', 'valve', () => m.add('valve', { kind: 'valve', origin: [-0.15, 1.1, 0], axis: [0, 0, 1], max: Math.PI / 2 }));
      acquire('electricity', 'battery', () => e.add('battery', { kind: 'source', a: 'positive', b: 'ground', voltage: 12 }));
      acquire('electricity', 'fuse', () => e.add('fuse', { kind: 'fuse', a: 'positive', b: 'fused', resistance: 0.05, rating: 2, enabled: false }));
      acquire('electricity', 'switch', () => e.add('switch', { kind: 'switch', a: 'fused', b: 'live', resistance: 0.05, enabled: false }));
      acquire('electricity', 'lamp', () => e.add('lamp', { kind: 'load', a: 'live', b: 'ground', resistance: 12 }));
      acquire('electricity', 'short', () => e.add('short', { kind: 'wire', a: 'live', b: 'ground', resistance: 0.1, enabled: false }));
      acquire('materials', 'bench', () => s.add('bench', { material: 'metal' }));
      acquire('thermal', 'rag', () => t.add('rag', { position: [1.2, 1, 0], heatCapacity: 60, ignition: 160, fuelJ: 18000, burnPower: 700 }));
      acquire('thermal', 'wood', () => t.add('wood', { position: [1.5, 1, 0], heatCapacity: 90, ignition: 180, fuelJ: 20000 }));
      t.connect('rag', 'wood', 4);
      acquire('tools', 'fuseSocket', () => tools.add('fuseSocket', { kind: 'socket', position: [-0.7, 1.3, 0], axis: [0, 0, -1], partType: 'fuse', radius: 0.08 }));
      acquire('tools', 'screw', () => tools.add('screw', { kind: 'screw', position: [0.4, 1, 0], axis: [0, 1, 0], requiredWork: 2 }));
      acquire('tools', 'nail', () => tools.add('nail', { kind: 'nail', position: [0.7, 1, 0], axis: [0, -1, 0], requiredWork: 3 }));
      acquire('rooms', 'workshop', () => a.addRoom('workshop')); acquire('rooms', 'corridor', () => a.addRoom('corridor'));
      acquire('portals', 'door', () => a.addPortal('door', { a: 'workshop', b: 'corridor', position: [2, 1, 0], closedLossDb: 38, openLossDb: 2 }));
      let lastHeard = null, disposed = false;
      acquire('listeners', 'guard', () => a.addListener('guard', { room: 'corridor', position: [4, 1, 0], thresholdDb: 35, receive(event) { lastHeard = event; onState(api.state()); } }));
      ctx.on('mechanics:changed', state => {
        if (state.id === 'switch') { e.setEnabled('switch', state.fraction > 0.5); e.evaluate(); }
        if (state.id === 'door') a.setPortal('door', state.fraction);
        onState(api.state());
      });
      ctx.on('electricity:changed', state => { if (state.id === 'lamp') { m.setLocked('door', state.power < 1); onState(api.state()); } });
      const assembly = state => { if (state.id === 'fuseSocket') { e.setEnabled('fuse', state.installed); e.evaluate(); } };
      ctx.on('tools:installed', assembly); ctx.on('tools:removed', assembly);
      ctx.on('materials:changed', state => { onSurface(state); onState(api.state()); });
      ctx.on('thermal:changed', () => onState(api.state()));
      for (const event of ['tools:impact', 'mechanics:stop']) ctx.on(event, data => a.sound({ room: 'workshop', position: data.position, db: 70 + 10 * Math.log10(Math.max(0.1, data.energy)), kind: event, sourceId: data.id }));
      const api = {
        ...systems,
        state() { return { powered: e.state('lamp').power > 1, fuseBlown: e.state('fuse').blown, fuseInstalled: tools.state('fuseSocket').installed,
          drawer: m.state('drawer').fraction, door: m.state('door').fraction, locked: m.state('door').locked,
          valve: m.state('valve').fraction, surface: s.state('bench'), fire: t.state('rag'), wood: t.state('wood'), lastHeard,
          screw: tools.state('screw').progress, nail: tools.state('nail').progress }; },
        takeFuse(owner = 'desktop') { if (m.state('drawer').fraction < 0.5 || tools.state('fuseSocket').installed) return false; const held = tools.hold('spareFuse', tokenFor(owner)); if (held) ownsSpareFuse = true; return held; },
        releaseFuse(owner = 'desktop') { return tools.release('spareFuse', tokenFor(owner)); },
        insertFuse(position, axis = [0, 0, -1], owner = 'desktop') {
          const ok = tools.insert('fuseSocket', { partId: 'spareFuse', partType: 'fuse', owner: tokenFor(owner), position, axis });
          if (ok) { e.replaceFuse('fuse'); e.evaluate(); } return ok;
        },
        removeFuse(owner = 'desktop') { return tools.removePart('fuseSocket', tokenFor(owner)); },
        liquid(ml, kind = 'water') { ctx.emit('liquid:deposit', { surfaceId: 'bench', thermalId: 'rag', ml, kind, stain: kind === 'water' ? 0 : 0.7 }); },
        sound(db = 80) { return a.sound({ room: 'workshop', position: [0, 1, 0], db, kind: 'test' }); },
        fault(value) { e.setEnabled('short', value); return e.evaluate(); },
        repairFuse() { if (!tools.state('fuseSocket').installed) return false; e.replaceFuse('fuse'); return e.evaluate(); },
        dispose() {
          if (disposed) return; disposed = true; cleanupOwned();
        },
      };
      instance = api; e.evaluate(); onState(api.state()); return api;
      } catch (error) { cleanupOwned(); instance = null; throw error; }
    },
  };
}
