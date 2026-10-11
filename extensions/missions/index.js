import {positive,tierState,SYSTEM_TIERS} from '../host/system.js';
import {jsonState,booleanState} from '../host/state.js';

// One reusable timed objective. Gameplay evaluation is injected; simulation/storage stay with their owners.
export function createMissionSystem({evaluate,emit=()=>{},quality='high',clearSeconds=3}={}){
  if(typeof evaluate!=='function')throw new TypeError('Mission needs an evaluator');positive(clearSeconds);if(clearSeconds>60)throw new RangeError('Clear hold exceeds budget');
  const tiers=tierState(quality),empty=()=>({status:'idle',elapsed:0,clearElapsed:0,timeLimit:0,data:null,reason:null,failureKind:null});let run=empty(),disposed=false,busy=false,notifying=false,starting=false;
  const live=()=>{if(disposed)throw new Error('Mission is disposed');};
  const clone=s=>({...s,data:jsonState(s.data,{maxBytes:16384})});
  const publish=s=>{if(!disposed&&run===s)emit('missions:changed',clone(s));};
  const limit=value=>{positive(value,'timeLimit',true);if(value>86400)throw new RangeError('Mission time exceeds budget');return value;};
  const reason=value=>{if(typeof value!=='string'||!value.trim()||value.length>256)throw new TypeError('Invalid mission failure reason');return value;};
  const api={get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    state(){live();return clone(run);},
    start({timeLimit=120,data=null}={}){live();if(starting)throw new Error('Mission start is reentrant');starting=true;try{const s={...empty(),status:'active',timeLimit:limit(timeLimit),data:jsonState(data,{maxBytes:16384})};run=s;emit('missions:started',clone(s));publish(s);return clone(s);}finally{starting=false;}},
    reset(){live();run=empty();publish(run);},
    step(dt){live();if(busy||notifying)throw new Error('Mission update is reentrant');positive(dt,'dt',true);if(dt>10)throw new RangeError('Mission update exceeds budget');if(run.status!=='active')return;
      busy=true;try{const s=run,result=evaluate(clone(s)),clear=booleanState(result.clear),failed=booleanState(result.failed===undefined?false:result.failed),failureReason=failed?reason(result.reason??'condition'):null;
        if(disposed||run!==s)return;
        const remaining=s.timeLimit?s.timeLimit-s.elapsed:Infinity,toClear=clear?Math.max(0,clearSeconds-s.clearElapsed):Infinity;
        if(failed){s.elapsed+=Math.min(dt,remaining);s.status='failed';s.reason=failureReason;s.failureKind='condition';}
        else if(toClear<=dt+1e-9&&toClear<=remaining+1e-9){s.elapsed+=Math.min(toClear,remaining);s.clearElapsed=clearSeconds;s.status='succeeded';}
        else{const seconds=Math.min(dt,remaining);s.elapsed+=seconds;s.clearElapsed=clear?s.clearElapsed+seconds:0;if(remaining<=dt){s.elapsed=s.timeLimit;s.status='failed';s.reason='timeout';s.failureKind='timeout';}}
        if(s.status!=='active')emit(s.status==='succeeded'?'missions:completed':'missions:failed',clone(s));publish(s);
      }finally{busy=false;}
    },
    capture(){live();return {schema:'gamesystems.missions.v1',config:{clearSeconds},run:clone(run)};},
    prepareRestore(raw){live();if(busy||notifying)throw new Error('Cannot restore during mission update');const data=jsonState(raw);if(data.schema!=='gamesystems.missions.v1'||data.config?.clearSeconds!==clearSeconds||!data.run)throw new Error('Mission configuration differs');const s=data.run;
      if(!['idle','active','succeeded','failed'].includes(s.status))throw new Error('Invalid mission status');positive(s.elapsed,'elapsed',true);positive(s.clearElapsed,'clearElapsed',true);limit(s.timeLimit);
      if(s.clearElapsed>clearSeconds||s.clearElapsed>s.elapsed+1e-8||s.timeLimit&&s.elapsed>s.timeLimit||s.status==='active'&&(s.clearElapsed>=clearSeconds||s.timeLimit&&s.elapsed>=s.timeLimit)||s.status==='succeeded'&&s.clearElapsed!==clearSeconds)throw new Error('Invalid mission timers');
      if(s.status==='failed'){reason(s.reason);if(!['condition','timeout'].includes(s.failureKind)||s.failureKind==='timeout'&&(!s.timeLimit||s.elapsed!==s.timeLimit))throw new Error('Invalid mission failure');}
      else if(s.reason!==null||s.failureKind!==null)throw new Error('Failure outside failed mission');
      if(s.status==='idle'&&(s.elapsed||s.clearElapsed||s.timeLimit||s.data!==null))throw new Error('Invalid idle mission');
      const staged={...empty(),status:s.status,elapsed:s.elapsed,clearElapsed:s.clearElapsed,timeLimit:s.timeLimit,data:jsonState(s.data,{maxBytes:16384}),reason:s.reason,failureKind:s.failureKind};
      return {state:()=>clone(staged),commit(){live();if(busy||notifying)throw new Error('Cannot commit during mission update');run=clone(staged);},notify(){if(disposed)return;if(busy||notifying)throw new Error('Mission notification is reentrant');notifying=true;try{publish(run);}finally{notifying=false;}}};
    },
    restore(raw){const plan=api.prepareRestore(raw);plan.commit();plan.notify();},
    dispose(){disposed=true;run=empty();},
  };return api;
}
export default function missionExtension(options={}){let api;return {id:'missions',quality:SYSTEM_TIERS,init(ctx){api=createMissionSystem({...options,emit:ctx.emit,quality:ctx.quality});return api;},update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();}};}
