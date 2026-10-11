import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../extensions/host/host.js';
import mechanics, { createMechanicsSystem } from '../../extensions/mechanics/index.js';
import electricity, { createElectricitySystem } from '../../extensions/electricity/index.js';
import materials, { createMaterialsSystem } from '../../extensions/materials/index.js';
import thermal, { createThermalSystem } from '../../extensions/thermal/index.js';
import tools, { createToolsSystem } from '../../extensions/tools/index.js';
import acoustics, { createAcousticsSystem } from '../../extensions/acoustics/index.js';
import workshop from '../../extensions/workshop/index.js';
import supply from '../../extensions/supply/index.js';
import flow from '../../extensions/flow/index.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
async function station(quality = 3) {
  const errors = [], host = createHost({ quality, onError: (e, id) => errors.push(`${id}: ${e.message}`) });
  for (const module of [mechanics, electricity, materials, thermal, tools, acoustics]) assert.ok(await host.load(module));
  const api = await host.load(workshop); assert.ok(api, errors.join('\n')); return { host, api, errors };
}

test('mechanics: lock, stops, resistance and opposing two-hand forces', () => {
  const s = createMechanicsSystem(); s.add('drawer', { max: 0.5, locked: true }); s.drive('drawer', 'left', 100); s.step(1); near(s.state('drawer').value, 0);
  assert.equal(s.setValue('drawer', 0.2), false); s.setLocked('drawer', false); s.drive('drawer', 'right', -100); s.step(1); near(s.state('drawer').value, 0);
  s.release('drawer', 'right'); s.step(1); near(s.state('drawer').value, 0.5); near(s.state('drawer').velocity, 0);
  s.releaseAll(); s.setValue('drawer', 0.2); s.drive('drawer', 'left', 0.05); s.step(1); near(s.state('drawer').value, 0.2);
});
test('mechanics: tracked slider and hinge movement uses object-space geometry', () => {
  const s = createMechanicsSystem(); s.add('drawer', { axis: [0, 0, 1], max: 1 }); s.grab('drawer', 'hand', [0, 0, 0]); s.moveHand('drawer', 'hand', [0, 0, 0.5]); s.step(0.5); assert.ok(s.state('drawer').value > 0.2);
  s.add('door', { kind: 'hinge', axis: [0, 1, 0], max: Math.PI / 2 }); s.grab('door', 'hand', [1, 0, 0]); s.moveHand('door', 'hand', [0, 0, -1]); s.step(0.5); assert.ok(s.state('door').value > 0.5);
});
test('electricity: series resistance, Kirchhoff current and power balance', () => {
  const s = createElectricitySystem(); s.add('battery', { kind: 'source', a: 'p', b: 'g', voltage: 12 }); s.add('wire', { kind: 'wire', a: 'p', b: 'l', resistance: 2 }); s.add('lamp', { a: 'l', b: 'g', resistance: 10 });
  const result = s.evaluate(); assert.equal(result.fault, null); near(s.state('lamp').current, 1); near(s.state('wire').current, 1); near(s.state('battery').current, -1);
  near(result.components.reduce((n, c) => n + c.power, 0), 0); s.setEnabled('wire', false); s.step(); near(s.state('lamp').power, 0);
});
test('electricity: parallel loads, floating islands, multiple sources', () => {
  const s = createElectricitySystem(); s.add('b1', { kind: 'source', a: 'p', b: 'g', voltage: 6 }); s.add('b2', { kind: 'source', a: 'q', b: 'p', voltage: 6 });
  s.add('l1', { a: 'q', b: 'g', resistance: 12 }); s.add('l2', { a: 'q', b: 'g', resistance: 6 }); s.add('floating', { a: 'x', b: 'y' });
  s.evaluate(); near(s.state('l1').current, 1); near(s.state('l2').current, 2); near(s.state('b1').current, -3); near(s.state('floating').power, 0);
});
test('electricity: fuse trips, opens load, persists until replaced', () => {
  const events = [], s = createElectricitySystem({ emit: (e, d) => events.push([e, d]) });
  s.add('b', { kind: 'source', a: 'p', b: 'g' }); s.add('f', { kind: 'fuse', a: 'p', b: 'l', resistance: 0.05, rating: 2 }); s.add('l', { a: 'l', b: 'g', resistance: 0.1 });
  s.evaluate(); assert.equal(s.state('f').blown, true); near(s.state('l').power, 0); assert.equal(events.filter(([e]) => e === 'electricity:fuse-blown').length, 1);
  s.replaceFuse('f'); s.evaluate(); assert.equal(s.state('f').blown, true);
});
test('electricity: incompatible ideal sources report fault without NaNs', () => {
  const s = createElectricitySystem(); s.add('a', { kind: 'source', a: 'p', b: 'g', voltage: 12 }); s.add('b', { kind: 'source', a: 'p', b: 'g', voltage: 6 });
  assert.ok(s.evaluate().fault); for (const id of ['a', 'b']) assert.ok(Number.isFinite(s.state(id).current));
});
test('materials: conservation, overflow, drying and wet friction', () => {
  const s = createMaterialsSystem(); s.add('bench', { material: 'metal', capacityMl: 40, dryRate: 2 }); const result = s.wet('bench', 100);
  near(result.retainedMl, 40); near(result.runoffMl, 60); near(s.state('bench').friction, 0.15); s.step(10); near(s.state('bench').liquidMl, 20);
  const l = s.ledger(); near(l.retainedMl + l.evaporatedMl + l.runoffMl, 100); s.step(100); near(s.state('bench').friction, 0.5);
});
test('materials: stain persists after drying and can be cleaned', () => {
  const s = createMaterialsSystem(); s.add('wood'); s.wet('wood', 100, { kind: 'wine', stain: 1 }); s.step(1000); assert.ok(s.state('wood').stain > 0); near(s.state('wood').waterMl, 0); s.clean('wood'); near(s.state('wood').stain, 0);
});
test('thermal: conductive exchange conserves energy and approaches equilibrium', () => {
  const s = createThermalSystem(); s.add('hot', { temperature: 100, heatCapacity: 50, fuelJ: 0, cooling: 0 }); s.add('cold', { temperature: 20, heatCapacity: 100, fuelJ: 0, cooling: 0 }); s.connect('hot', 'cold', 100);
  s.step(5); const hot = s.state('hot').temperature, cold = s.state('cold').temperature; near(hot * 50 + cold * 100, 7000, 1e-5); assert.ok(hot >= cold); near(hot, 7000 / 150, 0.01);
});
test('thermal: fuel is finite, water extinguishes, non-water events do not', async () => {
  const { host, api, errors } = await station(); api.thermal.ignite('rag'); host.update(1); assert.ok(api.state().fire.fuelJ < 18000); api.liquid(100, 'wine'); assert.equal(api.state().fire.burning, true);
  api.liquid(100, 'water'); assert.equal(api.state().fire.burning, false); assert.ok(api.state().fire.temperature <= 160); host.update(1); assert.equal(api.state().fire.burning, false); assert.deepEqual(errors, []); host.dispose();
});
test('thermal: heat ignites neighbour and exhausted fuel cannot reignite', () => {
  const s = createThermalSystem(); s.add('a', { heatCapacity: 10, fuelJ: 500, ignition: 30, burnPower: 100, cooling: 0 }); s.add('b', { heatCapacity: 10, fuelJ: 500, ignition: 30, burnPower: 100, cooling: 0 }); s.connect('a', 'b', 10); s.ignite('a'); s.step(10); near(s.state('a').fuelJ, 0); near(s.state('b').fuelJ, 0); assert.equal(s.ignite('a'), false);
});
test('tools: wrong tool, distance and angle rejected; screw can be undone', () => {
  const s = createToolsSystem(); s.add('screw', { axis: [0, 1, 0], requiredWork: 2 }); const pose = { position: [0, 0, 0], axis: [0, 1, 0], rotation: 4 * Math.PI };
  assert.equal(s.use('screw', { ...pose, tool: 'hammer' }).accepted, false); assert.equal(s.use('screw', { ...pose, tool: 'screwdriver', position: [1, 0, 0] }).accepted, false);
  assert.equal(s.use('screw', { ...pose, tool: 'screwdriver', axis: [0, -1, 0] }).accepted, false); s.use('screw', { ...pose, tool: 'screwdriver' }); assert.equal(s.state('screw').installed, true);
  s.use('screw', { ...pose, tool: 'screwdriver', rotation: -4 * Math.PI }); near(s.state('screw').progress, 0);
});
test('tools: ownership, part type and geometric insertion; one part cannot fill two sockets', () => {
  const s = createToolsSystem(); s.add('socket', { kind: 'socket' }); s.add('other', { kind: 'socket' }); assert.equal(s.hold('fuse', 'left'), true); assert.equal(s.hold('fuse', 'right'), false);
  const part = { partId: 'fuse', partType: 'fuse', owner: 'left', position: [0, 0, 0], axis: [0, 0, 1] };
  assert.equal(s.insert('socket', { ...part, partType: 'battery' }), false); assert.equal(s.insert('socket', part), true); assert.equal(s.hold('fuse', 'left'), false); assert.equal(s.insert('other', part), false);
  assert.equal(s.removePart('socket', 'right'), 'fuse'); assert.equal(s.hold('fuse', 'left'), false); s.release('fuse', 'right'); assert.equal(s.hold('fuse', 'left'), true);
});
test('tools: nail needs aligned hammer impact energy', () => {
  const events = [], s = createToolsSystem({ emit: (e, d) => events.push([e, d]) }); s.add('n', { kind: 'nail', requiredWork: 3 });
  s.use('n', { tool: 'hammer', position: [0, 0, 0], axis: [0, 0, 1], energyJ: 1 }); near(s.state('n').progress, 1 / 3); s.use('n', { tool: 'hammer', position: [0, 0, 0], axis: [0, 0, 1], energyJ: 2 }); assert.equal(s.state('n').installed, true); assert.equal(events.filter(([e]) => e === 'tools:impact').length, 2);
});
test('acoustics: door loss, distance, delayed AI stimulus and disconnected rooms', () => {
  const heard = [], s = createAcousticsSystem(); for (const id of ['a', 'b', 'c']) s.addRoom(id);
  s.addPortal('door', { a: 'a', b: 'b', position: [2, 0, 0], closedLossDb: 40, openLossDb: 0 }); s.addListener('guard', { room: 'b', position: [4, 0, 0], receive: e => heard.push(e) });
  near(s.sound({ room: 'a', db: 80 })[0].db, 80 - 40 - 20 * Math.log10(4)); assert.equal(heard.length, 0); s.step(0.001); assert.equal(heard.length, 0); s.step(0.02); assert.equal(heard.length, 1);
  s.setPortal('door', 1); near(s.sound({ room: 'a', db: 80 })[0].db, 80 - 20 * Math.log10(4)); assert.equal(s.path('a', 'c'), null);
});
test('acoustics: alternate portal path and bounded pending stimuli', () => {
  const s = createAcousticsSystem({ maxPending: 2 }); for (const id of ['a', 'b', 'c']) s.addRoom(id);
  s.addPortal('direct', { a: 'a', b: 'c', closedLossDb: 50 }); s.addPortal('one', { a: 'a', b: 'b', closedLossDb: 5 }); s.addPortal('two', { a: 'b', b: 'c', closedLossDb: 5 });
  assert.deepEqual(s.path('a', 'c').portals, ['one', 'two']); s.addListener('g', { room: 'c' }); for (let i = 0; i < 10; i++) s.sound({ room: 'a' }); assert.equal(s.pendingCount, 2); s.dispose(); assert.equal(s.pendingCount, 0);
});
test('acoustics: callback failures do not drop other due sounds or heard receipts',()=>{
  const receiveFailure=new Error('listener failed'),emitFailure=new Error('heard observer failed'),received=[],heard=[];let throwReceive=true,throwEmit=true,s;
  s=createAcousticsSystem({emit:(event,data)=>{if(event==='acoustics:heard'){heard.push(data);if(throwEmit){throwEmit=false;throw emitFailure;}}}});s.addRoom('r');
  s.addListener('a',{room:'r',receive:event=>received.push(event)});
  s.addListener('b',{room:'r',receive:event=>{received.push(event);if(throwReceive){throwReceive=false;throw receiveFailure;}}});
  s.sound({room:'r',sourceId:'first'});s.sound({room:'r',sourceId:'second'});
  assert.throws(()=>s.step(0),error=>error===receiveFailure);assert.equal(received.length,4);assert.equal(heard.length,4);
  assert.deepEqual(new Set(received.map(event=>event.sourceId)),new Set(['first','second']));assert.equal(s.pendingCount,0);
  s.sound({room:'r',sourceId:'recovery'});assert.doesNotThrow(()=>s.step(0));assert.equal(received.length,6);s.dispose();
});
test('integration: drawer → fuse → switch → lamp → door; overload relocks', async () => {
  const { host, api, errors } = await station(); assert.equal(api.takeFuse(), false); assert.equal(api.mechanics.setValue('door', 1), false);
  api.mechanics.setValue('drawer', 0.5); assert.equal(api.takeFuse(), true); assert.equal(api.insertFuse([1, 1, 1]), false); assert.equal(api.insertFuse([-0.7, 1.3, 0]), true);
  assert.equal(api.state().powered, false); api.mechanics.setValue('switch', Math.PI / 2); assert.equal(api.state().powered, true); assert.equal(api.mechanics.setValue('door', Math.PI / 2), true);
  assert.ok(api.sound()[0].db > 60); api.fault(true); assert.equal(api.state().fuseBlown, true); assert.equal(api.state().locked, true); api.fault(false); api.repairFuse(); assert.equal(api.state().powered, true);
  api.removeFuse(); assert.equal(api.state().powered, false); assert.deepEqual(errors, []); host.dispose();
});
test('integration: all quality levels keep puzzle and conservation behaviour', async () => {
  for (let level = 0; level <= 3; level++) { const { host, api, errors } = await station(level); api.mechanics.setValue('drawer', 0.5); api.takeFuse(); api.insertFuse([-0.7, 1.3, 0]); api.mechanics.setValue('switch', Math.PI / 2); api.liquid(100); host.update(1);
    assert.equal(api.state().powered, true); near(Object.values(api.materials.ledger()).reduce((a, b) => a + b, 0), 100); host.setQuality((level + 1) % 4); assert.equal(api.state().powered, true); assert.deepEqual(errors, []); host.dispose(); }
});
test('lifecycle: repeated stations dispose listeners and cancel held inputs', async () => {
  for (let i = 0; i < 5; i++) { const { host, api } = await station(); api.mechanics.drive('drawer', 'hand', 100); host.emit('disconnect', {}); host.update(1); near(api.state().drawer, 0);
    api.sound(); host.dispose(); assert.equal(host.ids.length, 0); assert.equal(host.events.count('liquid:deposit'), 0); assert.equal(api.acoustics.pendingCount, 0); assert.throws(() => api.mechanics.add('new')); }
});
test('input validation: no NaN state from invalid time, vectors or parameters', () => {
  for (const s of [createMechanicsSystem(), createElectricitySystem(), createMaterialsSystem(), createThermalSystem(), createAcousticsSystem()]) { assert.throws(() => s.step(NaN)); assert.throws(() => s.step(-1)); }
  assert.throws(() => createMechanicsSystem().add('bad', { axis: [0, 0, 0] })); assert.throws(() => createThermalSystem().add('bad', { heatCapacity: 0 })); assert.throws(() => createElectricitySystem().add('bad', { a: 'a', b: 'b', resistance: -1 }));
});

test('thermal: many strong conductive links stay bounded and conserve energy', () => {
  const s = createThermalSystem(); s.add('hot', { temperature: 1000, heatCapacity: 1, fuelJ: 0, cooling: 0 });
  for (let i = 0; i < 10; i++) { s.add(`cold${i}`, { temperature: 20, heatCapacity: 1, fuelJ: 0, cooling: 0 }); s.connect('hot', `cold${i}`, 100000); }
  s.step(1); let total = s.state('hot').temperature;
  for (let i = 0; i < 10; i++) { const value = s.state(`cold${i}`).temperature; assert.ok(value >= 20 && value <= 1000); total += value; }
  near(total, 1200, 1e-7);
});
test('materials: removing a wet surface keeps ledger balanced; reset starts fresh', () => {
  const s = createMaterialsSystem(); s.add('a'); s.wet('a', 100); s.remove('a'); near(s.ledger().runoffMl, 100); s.reset(); assert.deepEqual(s.ledger(), { retainedMl: 0, evaporatedMl: 0, runoffMl: 0 });
});
test('composition can unload and reload without disposing shared systems', async () => {
  const { host, api, errors } = await station(); api.mechanics.add('external', { max: 2 }); api.sound(); host.dispose('workshop');
  assert.equal(host.get('mechanics').state('external').value, 0); assert.equal(host.get('acoustics').pendingCount, 0); assert.throws(() => host.get('mechanics').state('drawer'));
  assert.ok(await host.load(workshop)); assert.deepEqual(errors, []); host.dispose();
});

test('disposing supply unloads flow before its captured dependency API becomes invalid', async () => {
  const errors = [], host = createHost({ onError: (e, id, phase) => errors.push([id, phase, e.message]) });
  const source = await host.load(supply); source.add('tank', { capacityMl: 1000, components: { water: 1000 } });
  const stream = await host.load(flow, { resolveTarget: () => ({ surfaceId: 'floor', position: [0, 0, 0] }) });
  stream.add('nozzle', { tankId: 'tank', rateMlPerSecond: 100 }); stream.start('nozzle'); host.update(0.5);
  assert.equal(source.state('tank').ml, 950);

  host.dispose('supply');

  assert.equal(host.state('flow'), 'absent');
  assert.equal(host.state('supply'), 'absent');
  assert.throws(() => stream.state('nozzle'), /Flow system is disposed/);
  assert.throws(() => source.state('tank'), /System is disposed/);
  host.update(0.5);
  assert.deepEqual(errors, []);
});
