import {positive,finite} from '../host/system.js';

// Receipt consumer only: the circuit owner advances electricity exactly once.
export function createElectricalHeatAdapter({network,thermal,bindings=[],maxBindings=64}={}){
  if(!network?.state||!thermal?.hasObject||!thermal?.addHeat)throw new TypeError('Electrical heat needs network and thermal APIs');
  if(!Number.isSafeInteger(maxBindings)||maxBindings<1||!Array.isArray(bindings)||bindings.length>maxBindings)throw new RangeError('Invalid electrical heat budget');
  const fractions=new Map(),pairs=new Set(),links=bindings.map(({componentId,thermalId,fraction=1})=>{
    if(typeof componentId!=='string'||!componentId||typeof thermalId!=='string'||!thermalId)throw new TypeError('Invalid heat binding ids');
    if(!['wire','switch','fuse','load'].includes(network.state(componentId).kind)||!thermal.hasObject(thermalId))throw new Error('Heat bindings need passive components and existing thermal objects');
    finite(fraction);if(fraction<0||fraction>1)throw new RangeError('Invalid heat fraction');
    const pair=JSON.stringify([componentId,thermalId]);if(pairs.has(pair))throw new Error('Duplicate heat binding');pairs.add(pair);
    const sum=(fractions.get(componentId)??0)+fraction;if(sum>1+1e-10)throw new Error('Heat bindings exceed delivered energy');fractions.set(componentId,sum);
    return {componentId,thermalId,fraction};
  });
  const consumed=new WeakSet();let disposed=false;
  return {
    consume(receipt){
      if(disposed)throw new Error('Electrical heat adapter is disposed');
      if(!receipt||typeof receipt!=='object'||!receipt.energyJ||typeof receipt.energyJ!=='object'||Array.isArray(receipt.energyJ))throw new TypeError('Invalid energy receipt');
      positive(receipt.seconds,'receipt seconds',true);if(receipt.seconds>10)throw new RangeError('Receipt exceeds step budget');
      for(const energy of Object.values(receipt.energyJ)){finite(energy);if(!receipt.seconds&&energy!==0)throw new Error('Energy without elapsed time');}
      const remaining=new Map(),transfers=links.map(link=>{const energy=positive(Object.hasOwn(receipt.energyJ,link.componentId)?receipt.energyJ[link.componentId]:0,'passive energy',true);const available=remaining.get(link.componentId)??energy,joules=Math.min(available,energy*link.fraction);remaining.set(link.componentId,available-joules);return {...link,joules};});
      if(consumed.has(receipt))return {duplicate:true,deliveredJ:0,skippedJ:0,transfers:[]};
      consumed.add(receipt);let deliveredJ=0,skippedJ=0;
      for(const transfer of transfers){if(thermal.hasObject(transfer.thermalId)){thermal.addHeat(transfer.thermalId,transfer.joules);deliveredJ+=transfer.joules;}else skippedJ+=transfer.joules;}
      return {duplicate:false,deliveredJ,skippedJ,transfers};
    },
    bindings:()=>links.map(link=>({...link})),
    dispose(){disposed=true;},
  };
}
