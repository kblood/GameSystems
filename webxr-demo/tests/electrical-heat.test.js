import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem,createElectricalHeatAdapter} from '../../extensions/thermal/index.js';
import {createElectricitySystem} from '../../extensions/electricity/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function circuit(energyWh=1){const network=createElectricitySystem();network.add('battery',{kind:'battery',a:'p',b:'g',capacityWh:1,energyWh,voltage:12,resistance:.08});network.add('wire',{kind:'wire',a:'p',b:'w',resistance:1});network.add('load',{a:'w',b:'g',resistance:4});const thermal=createThermalSystem();thermal.add('wood',{material:'wood',heatCapacity:1,cooling:0,airConductance:0});return {network,thermal};}
test('electrical heat: wire-loss receipts heat fuel and can ignite it without advancing the circuit twice',()=>{
  const {network,thermal}=circuit(),bridge=createElectricalHeatAdapter({network,thermal,bindings:[{componentId:'wire',thermalId:'wood'}]});
  const receipt=network.step(10),before=network.capture(),out=bridge.consume(receipt);near(thermal.state('wood').temperature,20+receipt.energyJ.wire);assert.deepEqual(network.capture(),before);near(out.deliveredJ,receipt.energyJ.wire);
  for(let i=0;i<3;i++)bridge.consume(network.step(10));thermal.step(.05);assert.equal(thermal.state('wood').burning,true);
});
test('electrical heat: partial battery exhaustion delivers only actual terminal heat, then stops',()=>{
  const {network,thermal}=circuit(.001),bridge=createElectricalHeatAdapter({network,thermal,bindings:[{componentId:'wire',thermalId:'wood'}]});
  const r=network.step(1);assert.equal(network.state('battery').energyWh,0);bridge.consume(r);near(thermal.state('wood').temperature,20+r.energyJ.wire);const temp=thermal.state('wood').temperature;
  bridge.consume(network.step(1));near(thermal.state('wood').temperature,temp);
});
test('electrical heat: disabled wires and blown fuses do not produce phantom heat',()=>{
  const {network,thermal}=circuit(),bridge=createElectricalHeatAdapter({network,thermal,bindings:[{componentId:'wire',thermalId:'wood'}]});network.setEnabled('wire',false);bridge.consume(network.step(1));near(thermal.state('wood').temperature,20);
  network.setEnabled('wire',true);network.add('fuse',{kind:'fuse',a:'w',b:'g',rating:.01,resistance:.01});bridge.consume(network.step(1));assert.equal(network.state('fuse').blown,true);
  // The original load remains a parallel powered branch; the fuse itself dissipates no heat after tripping.
  const fuseBridge=createElectricalHeatAdapter({network,thermal,bindings:[{componentId:'fuse',thermalId:'wood'}]});near(fuseBridge.consume(network.step(1)).deliveredJ,0);
});
test('electrical heat: split bindings conserve receipt energy and the same receipt object is consumed once',()=>{
  const {network,thermal}=circuit();thermal.add('metal',{material:'metal'});const bindings=[{componentId:'wire',thermalId:'wood',fraction:.3},{componentId:'wire',thermalId:'metal',fraction:.7}];
  const bridge=createElectricalHeatAdapter({network,thermal,bindings}),receipt=network.step(1),out=bridge.consume(receipt);near(out.deliveredJ,receipt.energyJ.wire);const state=thermal.capture();assert.equal(bridge.consume(receipt).duplicate,true);assert.deepEqual(thermal.capture(),state);
  bridge.bindings()[0].fraction=0;assert.equal(bridge.bindings()[0].fraction,.3);
});
test('electrical heat: invalid mappings and receipts fail before adding heat; sources are not heat loads',()=>{
  const {network,thermal}=circuit(),binding={componentId:'wire',thermalId:'wood'};thermal.add('metal',{material:'metal'});
  for(const bindings of [[{...binding,componentId:'battery'}],[{...binding,fraction:2}],[binding,binding],[{...binding,fraction:.8},{...binding,thermalId:'metal',fraction:.8}]])assert.throws(()=>createElectricalHeatAdapter({network,thermal,bindings}));
  const bridge=createElectricalHeatAdapter({network,thermal,bindings:[binding]}),before=thermal.capture();
  for(const receipt of [{seconds:0,energyJ:{wire:1}},{seconds:1,energyJ:{wire:-1}},{seconds:1,energyJ:{wire:10,battery:NaN}},{seconds:11,energyJ:{wire:1}}]){assert.throws(()=>bridge.consume(receipt));assert.deepEqual(thermal.capture(),before);}
});
test('electrical heat: removed targets skip heat, restored owners resume from their saved energy and temperature',()=>{
  const {network,thermal}=circuit(),bridge=createElectricalHeatAdapter({network,thermal,bindings:[{componentId:'wire',thermalId:'wood'}]});const power=network.capture(),heat=thermal.capture();
  const a=bridge.consume(network.step(1));const expected=thermal.capture();network.restore(power);thermal.restore(heat);const b=bridge.consume(network.step(1));assert.deepEqual(thermal.capture(),expected);near(a.deliveredJ,b.deliveredJ);
  thermal.remove('wood');assert.ok(bridge.consume(network.step(1)).skippedJ>0);bridge.dispose();assert.throws(()=>bridge.consume(network.step(1)));
});
