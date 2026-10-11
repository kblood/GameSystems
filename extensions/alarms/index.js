import {registry,positive,finite,tierState,SYSTEM_TIERS} from '../host/system.js';
import {jsonState,booleanState,stateId} from '../host/state.js';

// Gameplay detectors, not a real-world fire-safety device model. No audio or electricity ownership.
export function createAlarmSystem({thermal,emit=()=>{},isPowered=()=>true,quality='high',maxDetectors=64}={}){
  if(!thermal?.roomState||typeof isPowered!=='function')throw new TypeError('Alarms need thermal and a power gate');
  if(!Number.isSafeInteger(maxDetectors)||maxDetectors<1||maxDetectors>1024)throw new RangeError('Invalid detector budget');
  const detectors=registry(),tiers=tierState(quality);let pending=0,disposed=false,busy=false,notifying=false;
  const live=()=>{if(disposed)throw new Error('Alarm system is disposed');};
  const clear=(d,r)=>(d.mode==='smoke'||r.temperature<=d.clearHeat)&&(d.mode==='heat'||r.smokeDensity<=d.clearSmoke);
  const publish=(d,dispatch=emit)=>{if(!disposed&&detectors.entries.get(d.id)===d)dispatch('alarms:changed',api.state(d.id));};
  function sample(){
    const rooms=new Map(),batch=[];
    for(const d of [...detectors.entries.values()]){
      if(detectors.entries.get(d.id)!==d)continue;const missing=thermal.hasRoom&&!thermal.hasRoom(d.roomId);
      if(!missing&&!rooms.has(d.roomId)){const raw=thermal.roomState(d.roomId);rooms.set(d.roomId,{temperature:finite(raw.temperature),smokeDensity:positive(raw.smokeDensity,'smokeDensity',true)});}
      const powered=!missing&&d.enabled&&booleanState(isPowered(d.id),'powered');batch.push({d,r:rooms.get(d.roomId),powered,fault:missing?'room-missing':null});
    }
    return batch;
  }
  const api={
    get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    add(id,{roomId,mode='either',heatThreshold=60,smokeThreshold=.02,clearHeat=heatThreshold-10,clearSmoke=smokeThreshold*.5,delaySeconds=.5,enabled=true}={}){
      live();if(detectors.entries.size>=maxDetectors)throw new RangeError('Detector budget exceeded');stateId(roomId);thermal.roomState(roomId);
      if(!['heat','smoke','either'].includes(mode))throw new RangeError('Unknown detector mode');finite(heatThreshold);positive(smokeThreshold);finite(clearHeat);positive(clearSmoke,'clearSmoke',true);positive(delaySeconds,'delaySeconds',true);
      if(clearHeat>=heatThreshold||clearSmoke>=smokeThreshold||delaySeconds>60)throw new RangeError('Invalid detector hysteresis/delay');
      detectors.add(id,{id,roomId,mode,heatThreshold,smokeThreshold,clearHeat,clearSmoke,delaySeconds,enabled:booleanState(enabled),powered:booleanState(enabled),triggered:false,silenced:false,dwellSeconds:0,reason:null,fault:null});return api.state(id);
    },
    state(id){live();const d=detectors.get(id);return {...d,audible:d.enabled&&d.powered&&d.triggered&&!d.silenced};},
    all(){live();return [...detectors.entries.keys()].map(id=>api.state(id));},
    remove(id){live();return detectors.remove(id);},
    setEnabled(id,value){live();const d=detectors.get(id);d.enabled=booleanState(value);if(!d.enabled){d.powered=false;d.dwellSeconds=0;}publish(d);},
    silence(id){live();const d=detectors.get(id);if(!d.triggered)return false;d.silenced=true;emit('alarms:silenced',api.state(id));publish(d);return true;},
    reset(id){live();const d=detectors.get(id);if(thermal.hasRoom&&!thermal.hasRoom(d.roomId))return false;const raw=thermal.roomState(d.roomId),r={temperature:finite(raw.temperature),smokeDensity:positive(raw.smokeDensity,'smokeDensity',true)};if(!clear(d,r))return false;const powered=d.enabled&&booleanState(isPowered(d.id),'powered');d.fault=null;d.powered=powered;d.triggered=false;d.silenced=false;d.dwellSeconds=0;d.reason=null;emit('alarms:reset',api.state(id));publish(d);return true;},
    step(dt){
      live();if(busy||notifying)throw new Error('Alarm update is reentrant');positive(dt,'dt',true);if(dt>10)throw new RangeError('Alarm catch-up budget exceeded');
      const next=pending+dt,count=Math.floor((next+1e-9)/.1);if(!count){pending=next;return;}busy=true;
      let observerError,observerFailed=false;const report=(event,payload)=>{try{emit(event,payload);}catch(error){if(!observerFailed){observerError=error;observerFailed=true;}}};
      try{let batch=sample();pending=Math.max(0,next-count*.1);for(let i=0;i<count;i++){
        if(disposed)break;if(i)batch=sample();
        for(const {d,r,powered,fault}of batch){if(disposed)break;if(detectors.entries.get(d.id)!==d)continue;d.powered=d.enabled&&powered;d.fault=fault;
          const heat=!!r&&d.mode!=='smoke'&&r.temperature>=d.heatThreshold,smoke=!!r&&d.mode!=='heat'&&r.smokeDensity>=d.smokeThreshold;
          d.dwellSeconds=d.powered&&(heat||smoke)?Math.min(d.delaySeconds,d.dwellSeconds+.1):0;
          if(d.powered&&!d.triggered&&(heat||smoke)&&d.dwellSeconds+1e-9>=d.delaySeconds){d.triggered=true;d.reason=heat&&smoke?'heat+smoke':heat?'heat':'smoke';report('alarms:triggered',api.state(d.id));}
          publish(d,report);
        }
      }}finally{busy=false;}
      if(observerFailed)throw observerError;
    },
    capture(){live();return {schema:'gamesystems.alarms.v1',pending,detectors:api.all()};},
    prepareRestore(raw,{roomExists=id=>thermal.roomState(id)}={}){
      live();if(busy||notifying)throw new Error('Cannot restore during alarm update');const data=jsonState(raw);
      if(data.schema!=='gamesystems.alarms.v1'||!Array.isArray(data.detectors)||data.detectors.length!==detectors.entries.size)throw new Error('Alarm topology differs');
      positive(data.pending,'pending',true);if(data.pending>=.1)throw new RangeError('Invalid alarm phase');const staged=new Map(),dynamic=new Set(['enabled','powered','triggered','silenced','dwellSeconds','reason','audible','fault']);
      for(const s of data.detectors){const current=api.state(s.id),fault=s.fault===undefined?null:s.fault;if(staged.has(s.id))throw new Error('Duplicate alarm');if(![null,'room-missing'].includes(fault)||fault&&(s.powered||s.dwellSeconds))throw new Error('Invalid alarm fault');if(!fault)roomExists(s.roomId);
        for(const key of Object.keys(current))if(!dynamic.has(key)&&s[key]!==current[key])throw new Error('Alarm topology differs');
        for(const key of ['enabled','powered','triggered','silenced'])booleanState(s[key],key);positive(s.dwellSeconds,'dwellSeconds',true);
        if(s.dwellSeconds>s.delaySeconds||s.silenced&&!s.triggered||!['heat','smoke','heat+smoke',null].includes(s.reason)||s.triggered!==(s.reason!==null)||s.audible!==(s.enabled&&s.powered&&s.triggered&&!s.silenced)||!s.enabled&&(s.powered||s.dwellSeconds))throw new Error('Inconsistent alarm state');
        const {audible,...base}=current;staged.set(s.id,{...base,enabled:s.enabled,powered:s.powered,triggered:s.triggered,silenced:s.silenced,dwellSeconds:s.dwellSeconds,reason:s.reason,fault});
      }
      return {commit(){live();if(busy||notifying)throw new Error('Cannot commit during alarm update');pending=data.pending;for(const [id,d]of staged)detectors.entries.set(id,{...d});},
        notify(){if(disposed)return;if(notifying||busy)throw new Error('Alarm notification is reentrant');const batch=[...detectors.entries.values()];notifying=true;try{for(const d of batch)publish(d);}finally{notifying=false;}}
      };
    },
    restore(data){const plan=api.prepareRestore(data);plan.commit();plan.notify();},
    dispose(){if(disposed)return;disposed=true;detectors.dispose();},
  };return api;
}
export default function alarmExtension(options={}){let api;return {id:'alarms',requires:['thermal'],quality:SYSTEM_TIERS,init(ctx){api=createAlarmSystem({...options,thermal:ctx.get('thermal'),emit:ctx.emit,quality:ctx.quality});return api;},update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();}};}
