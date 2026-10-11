// Optional composition: only public APIs and host events. Each underlying system can run alone.
export const WORKSHOP_IDS = Object.freeze(['mechanics', 'electricity', 'materials', 'thermal', 'tools', 'acoustics']);
export default function workshopExtension({ onSurface = () => {}, onState = () => {} } = {}) {
  let instance;
  return { id: 'workshop', requires: WORKSHOP_IDS,
    dispose() { instance?.dispose(); instance = null; },
    init(ctx) {
      const systems = Object.fromEntries(WORKSHOP_IDS.map(id => [id, ctx.get(id)]));
      const { mechanics: m, electricity: e, materials: s, thermal: t, tools, acoustics: a } = systems;
      m.add('drawer', { origin: [-1.6, 0.65, -0.15], axis: [0, 0, 1], max: 0.5, inertia: 1, damping: 8 });
      m.add('switch', { kind: 'valve', origin: [-0.7, 1.72, 0], axis: [0, 0, 1], max: Math.PI / 2, resistance: 0.01 });
      m.add('door', { kind: 'hinge', origin: [1.85, 0, -0.25], axis: [0, 1, 0], max: Math.PI / 2, locked: true });
      m.add('valve', { kind: 'valve', origin: [-0.15, 1.1, 0], axis: [0, 0, 1], max: Math.PI / 2 });
      e.add('battery', { kind: 'source', a: 'positive', b: 'ground', voltage: 12 });
      e.add('fuse', { kind: 'fuse', a: 'positive', b: 'fused', resistance: 0.05, rating: 2, enabled: false });
      e.add('switch', { kind: 'switch', a: 'fused', b: 'live', resistance: 0.05, enabled: false });
      e.add('lamp', { kind: 'load', a: 'live', b: 'ground', resistance: 12 });
      e.add('short', { kind: 'wire', a: 'live', b: 'ground', resistance: 0.1, enabled: false });
      s.add('bench', { material: 'metal' });
      t.add('rag', { position: [1.2, 1, 0], heatCapacity: 60, ignition: 160, fuelJ: 18000, burnPower: 700 });
      t.add('wood', { position: [1.5, 1, 0], heatCapacity: 90, ignition: 180, fuelJ: 20000 });
      t.connect('rag', 'wood', 4);
      tools.add('fuseSocket', { kind: 'socket', position: [-0.7, 1.3, 0], axis: [0, 0, -1], partType: 'fuse', radius: 0.08 });
      tools.add('screw', { kind: 'screw', position: [0.4, 1, 0], axis: [0, 1, 0], requiredWork: 2 });
      tools.add('nail', { kind: 'nail', position: [0.7, 1, 0], axis: [0, -1, 0], requiredWork: 3 });
      a.addRoom('workshop'); a.addRoom('corridor');
      a.addPortal('door', { a: 'workshop', b: 'corridor', position: [2, 1, 0], closedLossDb: 38, openLossDb: 2 });
      let lastHeard = null, disposed = false;
      a.addListener('guard', { room: 'corridor', position: [4, 1, 0], thresholdDb: 35, receive(event) { lastHeard = event; onState(api.state()); } });
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
        takeFuse(owner = 'desktop') { if (m.state('drawer').fraction < 0.5 || tools.state('fuseSocket').installed) return false; return tools.hold('spareFuse', owner); },
        insertFuse(position, axis = [0, 0, -1], owner = 'desktop') {
          const ok = tools.insert('fuseSocket', { partId: 'spareFuse', partType: 'fuse', owner, position, axis });
          if (ok) { e.replaceFuse('fuse'); e.evaluate(); } return ok;
        },
        removeFuse(owner = 'desktop') { return tools.removePart('fuseSocket', owner); },
        liquid(ml, kind = 'water') { ctx.emit('liquid:deposit', { surfaceId: 'bench', thermalId: 'rag', ml, kind, stain: kind === 'water' ? 0 : 0.7 }); },
        sound(db = 80) { return a.sound({ room: 'workshop', position: [0, 1, 0], db, kind: 'test' }); },
        fault(value) { e.setEnabled('short', value); return e.evaluate(); },
        repairFuse() { if (!tools.state('fuseSocket').installed) return false; e.replaceFuse('fuse'); return e.evaluate(); },
        dispose() {
          if (disposed) return; disposed = true;
          const owned = { mechanics: ['drawer', 'switch', 'door', 'valve'], electricity: ['battery', 'fuse', 'switch', 'lamp', 'short'], materials: ['bench'], thermal: ['rag', 'wood'], tools: ['fuseSocket', 'screw', 'nail'] };
          for (const [system, ids] of Object.entries(owned)) { const live = ctx.get(system); if (live) for (const id of ids) live.remove(id); }
          ctx.get('tools')?.forgetPart('spareFuse');
          const sound = ctx.get('acoustics'); if (sound) { sound.removeRoom('workshop'); sound.removeRoom('corridor'); }
        },
      };
      instance = api; e.evaluate(); onState(api.state()); return api;
    },
  };
}
