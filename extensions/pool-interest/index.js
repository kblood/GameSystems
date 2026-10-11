import { positive, distance, tierState, SYSTEM_TIERS } from '../host/system.js';
import { jsonState, stateId } from '../host/state.js';
import { validatePoolQueryCursor } from '../pools/query.js';

// Interest scheduling wakes metadata; thermal remains the sole owner of heat transfer and combustion.
export function createPoolInterestSystem({ pools, thermal, emit=()=>{}, quality='high', radius=null, minimumRise=40, interval=.25, maxChecks=64, maxCells=64, maxActivations=1 }={}){
  if(!pools?.scanDormant||!pools?.hotDormant||!thermal?.connectedRooms)throw new TypeError('Pool interest needs pools and thermal public APIs');
  if(radius===null)radius=thermal.capture().config.spreadRadius;
  positive(radius);positive(minimumRise);positive(interval);if(radius>8)throw new RangeError('Interest radius exceeds spatial budget');
  for(const n of [maxChecks,maxCells,maxActivations])if(!Number.isSafeInteger(n)||n<1||n>4096)throw new RangeError('Invalid interest budget');
  const settings={radius,minimumRise,interval,maxChecks,maxCells,maxActivations},tiers=tierState(quality),ambient=thermal.capture().config.ambient,cursors=new Map();
  let pending=0,sourceAfter=null,disposed=false,last={checks:0,cells:0,activated:0,blocked:0};
  function live(){if(disposed)throw new Error('Interest scheduler is disposed');}
  function scan(){
    last={checks:0,cells:0,activated:0,blocked:0};
    const objects=thermal.objects(),sources=objects.filter(s=>s.burning||s.heaterW>0||s.temperature>=ambient+minimumRise);
    if(pools.scanDormantRoom)for(const room of thermal.roomStates())if(room.temperature>=ambient+minimumRise){let id=`\0room:${room.id}`;while(objects.some(s=>s.id===id))id+='\0';sources.push({id,roomId:room.id,roomAir:true});}
    sources.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const sourceIds=new Set(sources.map(s=>s.id));for(const id of cursors.keys())if(!sourceIds.has(id))cursors.delete(id);
    const connected=new Map(sources.map(s=>[s.id,s.roomAir?[s.roomId]:thermal.connectedRooms(s.roomId)]));
    // Keep newly activated neighbours in simulation until thermal has had time to heat them.
    const protect=objects.filter(s=>s.id.startsWith('pool:')&&sources.some(h=>connected.get(h.id).includes(s.roomId)&&(h.roomAir?s.airConductance>0:thermal.heatPath?thermal.heatPath(h,s,radius)!==null:distance(s.position,h.position)<=radius))).map(s=>s.id.slice(5));
    for(const p of pools.hotDormant(maxActivations)){if(pools.activate(p.id,{protect})){last.activated++;emit('pool-interest:activated',{id:p.id,reason:'stored-heat'});}else last.blocked++;}
    if(last.activated>=maxActivations||!sources.length)return;
    const source=sources.find(s=>sourceAfter===null||s.id>sourceAfter)??sources[0];sourceAfter=source.id;
    const rooms=connected.get(source.id);let entry=cursors.get(source.id)??{room:0,cursor:null};if(entry.room>=rooms.length)entry={room:0,cursor:null};
    while(last.checks<maxChecks&&last.cells<maxCells&&last.activated<maxActivations){
      const options={roomId:rooms[entry.room],combustibleOnly:true,maxChecks:maxChecks-last.checks,limit:maxActivations-last.activated,cursor:entry.cursor};
      const result=source.roomAir?pools.scanDormantRoom({...options,coupledOnly:true}):pools.scanDormant({...options,position:source.position,radius,maxCells:maxCells-last.cells});
      last.checks+=result.checks;last.cells+=result.cells;entry.cursor=result.cursor;
      for(const p of result.items){if(p.ml<=.01||p.fuelJ<=0||!source.roomAir&&thermal.heatPath&&thermal.heatPath(source,p,radius)===null)continue;if(pools.activate(p.id,{protect})){protect.push(p.id);last.activated++;emit('pool-interest:activated',{id:p.id,sourceId:source.id,reason:source.roomAir?'room-heat':'near-heat'});}else last.blocked++;}
      if(!result.done)break;entry.room++;entry.cursor=null;if(entry.room>=rooms.length){entry.room=0;break;}
    }
    cursors.set(source.id,entry);
  }
  const api={
    get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    step(dt){live();positive(dt,'dt',true);if(dt>10)throw new RangeError('Interest update exceeds catch-up budget');pending+=dt;if(pending+1e-9>=interval){pending=Math.max(0,pending-interval);if(pending>=interval)pending%=interval;scan();}return {...last};},
    stats(){live();return {...last,sources:cursors.size};},
    capture(){live();return {schema:'gamesystems.pool-interest.v1',settings:{...settings},pending,sourceAfter,cursors:[...cursors].map(([id,e])=>({id,room:e.room,cursor:e.cursor?{...e.cursor}:null}))};},
    prepareRestore(raw){live();const data=jsonState(raw);if(data.schema!=='gamesystems.pool-interest.v1'||!data.settings||Object.keys(data.settings).length!==Object.keys(settings).length||Object.keys(settings).some(key=>data.settings[key]!==settings[key]))throw new Error('Interest settings differ');
      positive(data.pending,'pending',true);if(data.pending>=interval)throw new RangeError('Invalid interest phase');if(data.sourceAfter!==null)stateId(data.sourceAfter);
      if(!Array.isArray(data.cursors)||data.cursors.length>4096)throw new RangeError('Invalid interest cursors');const staged=new Map();
      for(const e of data.cursors){stateId(e.id);if(staged.has(e.id)||!Number.isSafeInteger(e.room)||e.room<0||e.room>4096)throw new Error('Invalid interest source cursor');validatePoolQueryCursor(e.cursor);staged.set(e.id,{room:e.room,cursor:e.cursor?{...e.cursor}:null});}
      return {commit(){live();pending=data.pending;sourceAfter=data.sourceAfter;cursors.clear();for(const[id,e]of staged)cursors.set(id,{room:e.room,cursor:e.cursor?{...e.cursor}:null});last={checks:0,cells:0,activated:0,blocked:0};}};
    },
    restore(data){api.prepareRestore(data).commit();},
    dispose(){if(disposed)return;disposed=true;cursors.clear();},
  };return api;
}
export default function poolInterestExtension(options={}){let api;return {id:'pool-interest',requires:['pools','thermal'],quality:SYSTEM_TIERS,
  init(ctx){api=createPoolInterestSystem({...options,pools:ctx.get('pools'),thermal:ctx.get('thermal'),emit:ctx.emit,quality:ctx.quality});return api;},
  update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();}};}
