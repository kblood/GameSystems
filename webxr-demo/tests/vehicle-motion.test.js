import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleSystem,createFuelStore,createBatteryStore} from '../../extensions/vehicle/index.js';
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function car(){const s=createVehicleSystem();s.add('c',{resourceModes:{fuel:'disabled',power:'disabled'}});s.start('c');s.setControls('c',{throttle:.8,steer:.3,handbrake:false});return s;}
test('engaging lock freezes an existing panel animation and unlock resumes its target',()=>{
  const s=createVehicleSystem();s.add('c');s.setPart('c','hood',1);s.step(.2);const fraction=s.state('c').parts.hood.fraction;s.setLocked('c','hood',true);s.step(1);near(s.state('c').parts.hood.fraction,fraction);assert.equal(s.setPart('c','hood',0),false);s.setLocked('c','hood',false);s.step(1);near(s.state('c').parts.hood.fraction,1);
});
test('opening target pauses during travel while closing remains available',()=>{
  const s=car();s.setPart('c','door_fl',1);s.step(.5);const before=s.state('c').parts.door_fl.fraction;assert.ok(s.state('c').speed>.5);s.step(.5);near(s.state('c').parts.door_fl.fraction,before);s.setPart('c','door_fl',0);s.step(1);near(s.state('c').parts.door_fl.fraction,0);
});
test('30/60/90 fps produce the same curved path within integration tolerance',()=>{
  const states=[30,60,90].map(fps=>{const s=car();for(let i=0;i<fps*5;i++)s.step(1/fps);return s.state('c');});
  for(const s of states.slice(1)){near(s.speed,states[0].speed,1e-6);near(s.heading,states[0].heading,1e-6);for(let i=0;i<3;i++)near(s.position[i],states[0].position[i],1e-5);near(s.distanceM,states[0].distanceM,1e-5);}
});
test('wheelbase rejects invalid curvature inputs and the smallest supported vehicle stays finite',()=>{
  const s=createVehicleSystem();
  assert.throws(()=>s.add('invalid',{wheelbase:Number.MIN_VALUE}),/wheelbase must be at least 0\.1 m/);
  assert.throws(()=>s.state('invalid'),/Unknown id/);
  s.add('cart',{wheelbase:.1,resourceModes:{fuel:'disabled',power:'disabled'}});
  s.start('cart');s.setControls('cart',{throttle:1,steer:1,handbrake:false});s.step(1);
  const state=s.state('cart');
  assert.ok(state.position.every(Number.isFinite));assert.ok(Number.isFinite(state.heading));
});
test('braking reaches rest without backwards jitter and reversing starts only after stopping',()=>{
  const s=car();s.step(2);s.setControls('c',{throttle:0,brake:1});s.step(2);near(s.state('c').speed,0);const position=s.state('c').position;s.step(2);assert.deepEqual(s.state('c').position,position);
  s.setControls('c',{brake:0,throttle:1,gear:-1});s.step(1);assert.ok(s.state('c').speed<0);
});
test('exact fuel boundary stops once at interval end without leaving running flag behind',()=>{
  const events=[],s=createVehicleSystem({emit:(name,data)=>events.push([name,data])});s.add('c',{fuel:createFuelStore({amountL:.00022})});s.start('c');s.step(1);assert.equal(s.state('c').running,false);near(s.state('c').fuel.amountL,0);s.step(1);assert.equal(events.filter(([name])=>name==='vehicle:stopped').length,1);
});
test('step observer failures finish powered motion and later vehicles before rethrowing',()=>{
  const failure=new Error('stop observer failed');let throwOnce=true;
  const s=createVehicleSystem({emit:event=>{if(event==='vehicle:stopped'&&throwOnce){throwOnce=false;throw failure;}}});
  s.add('low',{fuel:createFuelStore({amountL:.00022})});s.add('second',{resourceModes:{fuel:'disabled',power:'disabled'}});
  s.start('low');s.start('second');for(const id of ['low','second'])s.setControls(id,{throttle:1,handbrake:false});
  assert.throws(()=>s.step(1),error=>error===failure);assert.equal(s.state('low').running,false);near(s.state('low').fuel.amountL,0);
  assert.ok(s.state('low').distanceM>0);assert.ok(s.state('second').distanceM>0);
  const before=s.state('second').position;s.step(.1);assert.notDeepEqual(s.state('second').position,before);
});
test('power exhaustion limits torque and fuel to the powered portion of an interval',()=>{
  const s=createVehicleSystem();s.add('c',{alternatorW:0,power:createBatteryStore({energyWh:.351})});s.start('c');s.setControls('c',{throttle:1,handbrake:false});s.step(1);assert.equal(s.state('c').lastStop,'power-loss');near(s.state('c').consumedL,(.00022+.0022*.25)*(.001*3600/88));assert.ok(s.state('c').speed<.2);assert.equal(s.state('c').electrics,false);
});
test('large parked intervals preserve whole resource accounting and invalid huge time is atomic',()=>{
  const s=createVehicleSystem();s.add('c');s.setLights('c',true);s.step(3600);near(s.state('c').power.energyWh,442);near(s.state('c').distanceM,0);const saved=s.capture();assert.throws(()=>s.step(86401));assert.deepEqual(s.capture(),saved);
});
test('checkpoint keeps interrupted lock state and trajectory continues under neutral controls',()=>{
  const s=car();s.setPart('c','trunk',1);s.step(.1);s.setLocked('c','trunk',true);const saved=s.capture();s.setLocked('c','trunk',false);s.step(1);s.restore(saved);assert.equal(s.state('c').parts.trunk.locked,true);const fraction=s.state('c').parts.trunk.fraction;s.step(.1);near(s.state('c').parts.trunk.fraction,fraction);near(s.state('c').controls.throttle,0);
});
test('opening cannot complete during a large interval that accelerates through safety threshold',()=>{
  const s=car();s.setPart('c','hood',1);s.step(1);assert.ok(s.state('c').speed>.5);near(s.state('c').parts.hood.fraction,0);
});
