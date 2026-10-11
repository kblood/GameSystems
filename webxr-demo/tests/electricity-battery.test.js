import test from 'node:test';
import assert from 'node:assert/strict';
import { createElectricitySystem } from '../../extensions/electricity/index.js';
import { createVehicleSystem } from '../../extensions/vehicle/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function circuit(energyWh=1){const s=createElectricitySystem();s.add('battery',{kind:'battery',a:'p',b:'g',voltage:12,resistance:1,capacityWh:1,energyWh});s.add('load',{a:'p',b:'g',resistance:11});return s;}
test('finite battery powers resistive loads with internal voltage drop and energy conservation',()=>{
  const s=circuit();s.evaluate();near(s.state('load').current,1);near(s.state('load').power,11);near(s.state('battery').volts,11);
  const step=s.step(1);near(step.energyJ.load,11);near(step.energyJ.battery,-11);near(s.state('battery').suppliedWh,12/3600);
  near(s.state('battery').energyWh+12/3600,1);
});
test('battery exhaustion integrates only until exact boundary and isolates depleted source',()=>{
  const s=circuit(.001),out=s.step(1);near(out.energyJ.load,3.3);near(s.state('battery').energyWh,0);near(s.state('load').power,0);
  near(s.state('battery').suppliedWh,.001);near(s.step(1).energyJ.load,0);
  s.charge('battery',.001);s.step(.1);near(s.state('load').power,11);assert.ok(s.state('battery').energyWh>0);
});
test('charger refills empty battery through network and stops accepting current at capacity',()=>{
  const s=createElectricitySystem();s.add('charger',{kind:'source',a:'p',b:'g',voltage:14});s.add('battery',{kind:'battery',a:'p',b:'g',voltage:12,resistance:1,capacityWh:.001,energyWh:0});
  const out=s.step(1);near(s.state('battery').energyWh,.001);near(s.state('battery').chargedWh,.001);near(out.energyJ.battery,4.2);near(out.energyJ.charger,-4.2);near(s.state('battery').current,0);
});
test('fuse and disconnected wire cut power without consuming battery energy',()=>{
  const s=createElectricitySystem();s.add('b',{kind:'battery',a:'p',b:'g',capacityWh:1});s.add('wire',{kind:'wire',a:'p',b:'f',resistance:.1});s.add('fuse',{kind:'fuse',a:'f',b:'l',resistance:.1,rating:1});s.add('load',{a:'l',b:'g',resistance:.1});
  s.step(1);assert.equal(s.state('fuse').blown,true);near(s.state('b').energyWh,1);
  s.configure('load',{resistance:12});s.replaceFuse('fuse');s.step(1);assert.ok(s.state('b').energyWh<1);
  s.setEnabled('wire',false);const before=s.state('b').energyWh;s.step(1);near(s.state('b').energyWh,before);near(s.state('load').power,0);
});
test('empty battery cannot trip fuse from hypothetical discharge current',()=>{
  const s=createElectricitySystem();s.add('b',{kind:'battery',a:'p',b:'g',energyWh:0});s.add('f',{kind:'fuse',a:'p',b:'l',rating:.1,resistance:.01});s.add('l',{a:'l',b:'g',resistance:.01});s.step(1);assert.equal(s.state('f').blown,false);
});
test('battery timestep partition keeps charge, depletion and delivered energy equal',()=>{
  const a=circuit(.001),b=circuit(.001);const once=a.step(1);let energy=0;for(let i=0;i<100;i++)energy+=b.step(.01).energyJ.load;
  near(once.energyJ.load,energy);near(a.state('battery').energyWh,b.state('battery').energyWh);near(a.state('battery').suppliedWh,b.state('battery').suppliedWh);
});
test('tiny remaining battery charge resolves without a boundary retry loop',()=>{
  const s=circuit(1e-15);s.step(1);near(s.state('battery').energyWh,0);near(s.state('load').power,0);
});
test('circuit configure and checkpoint reject bad data before mutation',()=>{
  const s=circuit();s.step(1);const saved=s.capture();assert.throws(()=>s.configure('load',{resistance:2,voltage:NaN}));assert.deepEqual(s.capture(),saved);
  s.draw('battery',.5);s.restore(saved);near(s.state('battery').energyWh,saved.components[0].energyWh);
  const bad=s.capture();bad.components[0].chargedWh=12;const before=s.capture();assert.throws(()=>s.restore(bad));assert.deepEqual(s.capture(),before);
  assert.throws(()=>s.step(11));assert.deepEqual(s.capture(),before);
});
test('battery adapter is finite and disabling it stops vehicle-style draws',()=>{
  const s=circuit(),a=s.batteryAdapter('battery');near(a.draw(2),1);near(a.state().voltage,0);near(a.charge(2),1);s.setEnabled('battery',false);near(a.draw(1),0);
  s.dispose();assert.throws(()=>a.draw(1));assert.throws(()=>s.configure('load',{resistance:1}));
});
test('circuit registry budgets reject allocations before changing topology',()=>{
  const s=createElectricitySystem({maxComponents:2,maxNodes:3});s.add('a',{a:'p',b:'g'});const before=s.capture();assert.throws(()=>s.add('b',{a:'x',b:'y'}));assert.deepEqual(s.capture(),before);
  s.add('b',{a:'p',b:'q'});assert.throws(()=>s.add('c',{a:'p',b:'g'}));
});
test('checkpoint commit restores solved voltages silently before observers run',()=>{
  const events=[],s=createElectricitySystem({emit:(name,data)=>events.push([name,data])});s.add('b',{kind:'battery',a:'p',b:'g',resistance:1});s.add('l',{a:'p',b:'g',resistance:11});s.evaluate();const saved=s.capture();
  s.setEnabled('l',false);s.evaluate();const plan=s.prepareRestore(saved);events.length=0;plan.commit();near(s.state('l').volts,11);assert.equal(events.length,0);plan.notify();assert.ok(events.length>0);
});
test('circuit solve observers cannot re-enter evaluation or mutate live topology',()=>{
  let armed=false,s;const refused=[];
  s=createElectricitySystem({emit:name=>{
    if(!armed||name!=='electricity:changed')return;
    armed=false;
    for(const action of [()=>s.evaluate(),()=>s.remove('load'),()=>s.configure('load',{resistance:22}),()=>s.setEnabled('battery',false)]){
      try{action();}catch(error){refused.push(error.message);}
    }
  }});
  s.add('battery',{kind:'battery',a:'p',b:'g',voltage:12,resistance:1,capacityWh:1,energyWh:1});
  s.add('load',{a:'p',b:'g',resistance:11});armed=true;
  const solved=s.evaluate();
  assert.equal(solved.components.length,2);assert.equal(refused.length,4);assert.ok(refused.every(message=>message.includes('during electricity evaluate')));
  near(s.state('load').current,1);assert.deepEqual(s.all().map(component=>component.id),['battery','load']);
  armed=false;s.configure('load',{resistance:22});s.evaluate();near(s.state('load').current,12/23);
});
test('energy receipt observers cannot nest steps or alter battery accounting',()=>{
  let s,armed=true,nestedStepError='',nestedEvaluateError='',mutationError='',restoreError='',observedEnergy=0;
  s=createElectricitySystem({emit:(name,receipt)=>{
    if(name!=='electricity:energy'||!armed)return;
    armed=false;observedEnergy=s.state('battery').energyWh;
    receipt.seconds=99;receipt.energyJ.load=999;
    for(const [action,key] of [[()=>s.step(1),'step'],[()=>s.evaluate(),'evaluate'],[()=>s.charge('battery',.1),'charge'],[()=>s.setEnabled('load',false),'mutation']]){
      try{action();}catch(error){if(key==='step')nestedStepError=error.message;else if(key==='evaluate')nestedEvaluateError=error.message;else mutationError=error.message;}
    }
    try{restorePlan.commit();}catch(error){restoreError=error.message;}
  }});
  s.add('battery',{kind:'battery',a:'p',b:'g',voltage:12,resistance:1,capacityWh:1,energyWh:1});
  s.add('load',{a:'p',b:'g',resistance:11});const restorePlan=s.prepareRestore(s.capture());
  const receipt=s.step(1);
  assert.equal(receipt.seconds,1);near(receipt.energyJ.load,11);assert.equal(observedEnergy,s.state('battery').energyWh);
  for(const message of [nestedStepError,nestedEvaluateError,mutationError,restoreError])assert.match(message,/during electricity step/);
  near(s.state('battery').suppliedWh,12/3600);near(s.state('battery').initialWh+s.state('battery').chargedWh-s.state('battery').suppliedWh,s.state('battery').energyWh);
  s.step(.1);assert.ok(s.state('battery').energyWh<1,'the step guard releases after the energy receipt callback');
});
test('vehicle starter and DC loads share one finite battery through public adapter',()=>{
  const net=circuit(),cars=createVehicleSystem();cars.add('car',{power:net.batteryAdapter('battery')});assert.equal(cars.start('car').started,true);
  near(net.state('battery').energyWh,.65);net.step(1);near(net.state('battery').energyWh,.65-12/3600);
  cars.stop('car');net.draw('battery',100);assert.equal(cars.start('car').reason,'battery-flat');
  net.charge('battery',1);assert.equal(cars.start('car').started,true);
  const b=net.state('battery');near(b.initialWh+b.chargedWh-b.suppliedWh,b.energyWh);
});
test('several batteries can fill and subsequently discharge in one bounded update',()=>{
  const s=createElectricitySystem();for(const [i,voltage]of [16,14,12,10].entries())s.add(`b${i}`,{kind:'battery',a:'p',b:'g',voltage,resistance:.1,capacityWh:i?.0005:.1,energyWh:i?0:.1});
  s.add('load',{a:'p',b:'g',resistance:1});s.step(10);near(s.state('load').power,0);
  for(const b of s.all().filter(c=>c.kind==='battery')){near(b.energyWh,0);near(b.initialWh+b.chargedWh-b.suppliedWh,b.energyWh);}
});
