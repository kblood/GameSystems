import test from 'node:test';
import assert from 'node:assert/strict';
import {createElectricitySystem} from '../../extensions/electricity/index.js';
import {createSupplySystem} from '../../extensions/supply/index.js';
import {createSprinklerSystem} from '../../extensions/sprinklers/index.js';
import {createNetworkPump} from '../../extensions/sprinklers/power.js';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createCheckpointSystem} from '../../extensions/checkpoint/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function world({energyWh=1,waterMl=100,heads=1}={}){
  const net=createElectricitySystem();net.add('battery',{kind:'battery',a:'p',b:'g',capacityWh:1,energyWh,voltage:12,resistance:1});net.add('pump',{a:'p',b:'g',resistance:11});
  const pump=createNetworkPump({network:net,loadId:'pump',ratedW:11}),supply=createSupplySystem(),heat=createThermalSystem();supply.add('tank',{components:{water:waterMl}});
  const sprinklers=createSprinklerSystem({supply,thermal:heat,powerFraction:pump.powerFraction});
  for(let i=0;i<heads;i++){sprinklers.add(`h${i}`,{tankId:'tank',rateMlPerSecond:100});sprinklers.trigger(`h${i}`);}return {net,pump,supply,heat,sprinklers};
}
test('powered sprinkler integrates partial battery interval instead of testing final voltage',()=>{
  const w=world({energyWh:.6/3600});w.sprinklers.step(.1);near(w.sprinklers.state('h0').deliveredMl,5);near(w.supply.state('tank').ml,95);near(w.net.state('battery').energyWh,0);near(w.pump.state().lastFraction,.5);
  w.sprinklers.step(.1);near(w.sprinklers.state('h0').deliveredMl,5);near(w.sprinklers.state('h0').flowMlPerSecond,0);
});
test('powered heads share reduced available water fairly and pump does not run on empty tank',()=>{
  const w=world({waterMl:15,heads:2});w.sprinklers.step(.1);near(w.sprinklers.state('h0').deliveredMl,7.5);near(w.sprinklers.state('h1').deliveredMl,7.5);
  const energy=w.net.state('battery').energyWh;w.sprinklers.step(1);near(w.net.state('battery').energyWh,energy);near(w.pump.state().lastEnergyJ,0);assert.equal(w.net.state('pump').enabled,false);
});
test('closing every head stops pump consumption while heat sensing keeps its fixed clock',()=>{
  const w=world();w.sprinklers.setOpen('h0',false);w.sprinklers.step(1);near(w.net.state('battery').energyWh,1);near(w.supply.state('tank').ml,100);near(w.pump.state().requestMl,0);
});
test('disabled supply source stops fluid; recharging and re-enabling restores it',()=>{
  const w=world({energyWh:0});w.sprinklers.step(.1);near(w.supply.state('tank').ml,100);w.net.charge('battery',1);w.net.setEnabled('battery',false);w.sprinklers.step(.1);near(w.supply.state('tank').ml,100);
  w.net.setEnabled('battery',true);w.sprinklers.step(.1);near(w.supply.state('tank').ml,90);
});
test('fractional render updates and quality preserve pump energy and water use',()=>{
  const a=world({energyWh:.6/3600}),b=world({energyWh:.6/3600});b.sprinklers.setQuality('minimal');a.sprinklers.step(1);for(let i=0;i<100;i++)b.sprinklers.step(.01);
  near(a.supply.state('tank').ml,b.supply.state('tank').ml);near(a.pump.state().totalJ,b.pump.state().totalJ);
});
test('pump receipt checkpoint restores cumulative energy and rejects inconsistent fractions',()=>{
  const w=world();w.sprinklers.step(.1);const saved=w.pump.capture();w.sprinklers.step(.1);w.pump.restore(saved);assert.deepEqual(w.pump.capture(),saved);
  const bad={...saved,lastFraction:.5};assert.throws(()=>w.pump.restore(bad));assert.deepEqual(w.pump.capture(),saved);w.pump.dispose();assert.throws(()=>w.pump.powerFraction([],1));
});
test('invalid external power fractions cannot withdraw liquid',()=>{
  for(const value of [-1,2,NaN]){const w=world(),s=createSprinklerSystem({supply:w.supply,thermal:w.heat,powerFraction:()=>value});s.add('h',{tankId:'tank'});s.trigger('h');assert.throws(()=>s.step(.1));near(w.supply.state('tank').ml,100);}
});
test('undervoltage pump empties the last small volume without an energy-draining asymptotic tail',()=>{
  const w=world({waterMl:1});w.net.configure('pump',{resistance:22});w.sprinklers.step(.1);near(w.supply.state('tank').ml,0);near(w.sprinklers.state('h0').deliveredMl,1);near(w.pump.state().totalJ,.11);
  const energy=w.net.state('battery').energyWh;w.sprinklers.step(5);near(w.net.state('battery').energyWh,energy);
});
test('joint checkpoint preserves fractional sprinkler phase and resumes identical pump work',()=>{
  const w=world(),cp=createCheckpointSystem({sceneId:'pump'});for(const [id,owner]of [['net',w.net],['supply',w.supply],['heads',w.sprinklers],['pump',w.pump]])cp.register(id,owner);
  w.sprinklers.step(.05);const saved=cp.capture();w.sprinklers.step(.1);const expected=cp.capture();cp.restore(saved);w.sprinklers.step(.1);assert.deepEqual(cp.capture(),expected);
  const bad=cp.capture();bad.state.pump.lastRequiredJ+=1;const before=cp.capture();assert.throws(()=>cp.restore(bad));assert.deepEqual(cp.capture(),before);
});
