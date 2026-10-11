import {finite,positive} from '../host/system.js';

// Gameplay clearance only; no physiological model or real-world safety assessment.
export function assessFireHazards({rooms=[],objects=[],hotDormant=[],hotDormantSummary=null}={}, {heatLimit=60,smokeLimit=.02,airLimit=.5}={}){
  finite(heatLimit);positive(smokeLimit,'smokeLimit',true);finite(airLimit);
  if(airLimit<0||airLimit>1)throw new RangeError('airLimit must be normalized');
  const make=id=>({id,fires:0,charges:0,hotFuel:0,hotDormant:0,hotAir:false,smoky:false,lowAir:false,reasons:[]});
  const reports=new Map(rooms.map(r=>[r.id,{...make(r.id),temperature:r.temperature,oxygen:r.oxygen,visibility:r.visibility,smokeDensity:r.smokeDensity,
    hotAir:r.temperature>=heatLimit,smoky:r.smokeDensity>smokeLimit,lowAir:r.oxygen<airLimit}]));
  const outside=make(null);
  const report=id=>{if(id===null||id===undefined)return outside;const r=reports.get(id);if(!r)throw new Error(`Unknown hazard room: ${id}`);return r;};
  for(const s of objects){const r=report(s.roomId);if(s.burning)r.fires++;if(s.blast?.armed&&!s.blast.spent)r.charges++;
    if(s.fuelJ>0&&s.flammability>0&&s.temperature>=s.ignition)r.hotFuel++;
  }
  if(hotDormantSummary!==null){
    if(hotDormant.length||!Array.isArray(hotDormantSummary.rooms)||!Number.isSafeInteger(hotDormantSummary.count)||hotDormantSummary.count<0)throw new Error('Invalid dormant hazard summary');
    const seen=new Set();let total=0;for(const r of hotDormantSummary.rooms){if(seen.has(r.roomId)||!Number.isSafeInteger(r.count)||r.count<1)throw new Error('Invalid dormant room count');seen.add(r.roomId);report(r.roomId).hotDormant=r.count;total+=r.count;}
    if(total!==hotDormantSummary.count)throw new Error('Dormant hazard counts disagree');
  }else for(const p of hotDormant)report(p.roomId).hotDormant++;
  const all=[...reports.values(),outside];
  for(const r of all){for(const [key,reason] of [['fires','fire'],['charges','charge'],['hotFuel','hot-fuel'],['hotDormant','dormant-fuel'],['hotAir','heat'],['smoky','smoke'],['lowAir','air']])if(r[key])r.reasons.push(reason);r.clear=r.reasons.length===0;}
  return {clear:all.every(r=>r.clear),reasons:[...new Set(all.flatMap(r=>r.reasons))],rooms:[...reports.values()],outside};
}
