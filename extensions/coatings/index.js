import {positive,finite,vector,dot,clamp,tierState,SYSTEM_TIERS} from '../host/system.js';
import {jsonState,stateId} from '../host/state.js';

function direction(v){v=vector(v);const length=Math.hypot(...v);if(length<1e-9)throw new RangeError('Zero surface direction');return Math.abs(length-1)<1e-12?v:v.map(n=>n/length);}

// Coverage is a gameplay surface effect; pools remain the owner of deposited liquid volume.
export function createCoatingSystem({thermal,pools,emit=()=>{},quality='high',doseMlPerM2=80,baseDecay=.0005,verticalDecay=.0015,heatDecay=.000002,maxSurfaces=256}={}){
  if(!thermal?.suppress||!pools?.foam)throw new TypeError('Coatings need thermal and pools public APIs');
  positive(doseMlPerM2);positive(baseDecay,'baseDecay',true);positive(verticalDecay,'verticalDecay',true);positive(heatDecay,'heatDecay',true);
  if(!Number.isSafeInteger(maxSurfaces)||maxSurfaces<1)throw new RangeError('Invalid surface budget');
  const settings={doseMlPerM2,baseDecay,verticalDecay,heatDecay},profiles=new Map(),tiers=tierState(quality),ambient=thermal.capture().config.ambient;let disposed=false;
  function live(){if(disposed)throw new Error('Coatings are disposed');}
  function reference(id){stateId(id);if(id.startsWith('pool:')){const poolId=id.slice(5);if(!pools.has(poolId))throw new Error('Unknown coated pool');const p=pools.state(poolId);return {id,poolId,state:p,profile:{areaM2:Math.max(.02,Math.PI*p.radius*p.radius),normal:[0,1,0],heightM:0}};}
    const profile=profiles.get(id);if(!profile)throw new Error('Unknown coating surface');return {id,poolId:null,state:thermal.state(id),profile};
  }
  function set(r,coverage){if(coverage===r.state.blanket)return;if(r.poolId!==null)pools.foam(r.poolId,coverage);else thermal.suppress(r.id,coverage);emit('coatings:changed',{id:r.id,coverage});}
  const api={
    get quality(){return tiers.quality;},setQuality:tiers.setQuality,
    add(id,{areaM2=1,normal=[0,1,0],heightM=0}={}){live();stateId(id);if(id.startsWith('pool:')||profiles.has(id))throw new Error('Invalid or duplicate surface');if(profiles.size>=maxSurfaces)throw new RangeError('Surface budget exceeded');thermal.state(id);
      profiles.set(id,{id,areaM2:positive(areaM2,'areaM2'),normal:direction(normal),heightM:positive(heightM,'heightM',true)});return api.state(id);
    },
    state(id){live();const r=reference(id);return {id,...r.profile,normal:[...r.profile.normal],coverage:r.state.blanket};},
    apply(id,ml,{normal=null,jetDirection=null}={}){
      live();positive(ml,'foam ml',true);const r=reference(id),n=direction(normal??r.profile.normal),jet=direction(jetDirection??n.map(x=>-x));
      const incidence=clamp(-dot(n,jet),0,1),retention=(n[1]>=0?.5+.5*n[1]:.1)*incidence;
      const coverage=clamp(r.state.blanket+ml*retention/(r.profile.areaM2*doseMlPerM2),0,1);set(r,coverage);
      const receipt={id,ml,coverage,areaM2:r.profile.areaM2,retention};emit('coatings:applied',receipt);return receipt;
    },
    deposited({id,components,previousMl,previousBlanket}){
      live();positive(previousMl,'previousMl',true);finite(previousBlanket,'previousBlanket');if(previousBlanket<0||previousBlanket>1)throw new RangeError('Invalid previous coverage');
      if(!components||typeof components!=='object'||Array.isArray(components))throw new TypeError('Deposited components required');const foamMl=positive(components.foam??0,'foam ml',true),r=reference(`pool:${id}`);
      // Growing a puddle spreads the existing blanket over its larger footprint.
      const coverage=clamp(previousBlanket*(r.state.ml?previousMl/r.state.ml:0)+foamMl/(r.profile.areaM2*doseMlPerM2),0,1);set(r,coverage);
      if(foamMl)emit('coatings:applied',{id:r.id,ml:foamMl,coverage,areaM2:r.profile.areaM2,retention:1});
    },
    step(dt){live();positive(dt,'dt',true);if(dt>10)throw new RangeError('Coating update exceeds catch-up budget');if(!dt)return;
      const ids=[...profiles.keys()].filter(id=>thermal.hasObject(id));for(const s of thermal.objects())if(s.blanket>0&&s.id.startsWith('pool:')&&pools.has(s.id.slice(5)))ids.push(s.id);
      for(const id of ids){const r=reference(id);if(!r.state.blanket)continue;const up=Math.max(0,r.profile.normal[1]),decay=baseDecay+(1-up)*verticalDecay*(1+r.profile.heightM)+Math.max(0,r.state.temperature-ambient)*heatDecay;
        set(r,Math.max(0,r.state.blanket-decay*dt));
      }
    },
    capture(){live();return {schema:'gamesystems.coatings.v1',settings:{...settings},surfaces:[...profiles.values()].map(p=>({...p,normal:[...p.normal]}))};},
    prepareRestore(raw,{thermalPlan=null}={}){
      live();const data=jsonState(raw);if(data.schema!=='gamesystems.coatings.v1'||!data.settings||Object.keys(data.settings).length!==Object.keys(settings).length||Object.keys(settings).some(k=>data.settings[k]!==settings[k])||!Array.isArray(data.surfaces)||data.surfaces.length!==profiles.size)throw new Error('Coating topology differs');
      const seen=new Set();for(const p of data.surfaces){const current=profiles.get(p.id);if(!current||seen.has(p.id)||p.areaM2!==current.areaM2||p.heightM!==current.heightM||JSON.stringify(p.normal)!==JSON.stringify(current.normal))throw new Error('Coating surface differs');seen.add(p.id);if(thermalPlan)thermalPlan.objectState(p.id);}
      return {commit(){live();}}; // Coverage already belongs to thermal / pools checkpoint plans.
    },
    restore(data){api.prepareRestore(data).commit();},
    dispose(){disposed=true;profiles.clear();},
  };return api;
}
export default function coatingsExtension(options={}){let api;return {id:'coatings',requires:['thermal','pools'],quality:SYSTEM_TIERS,
  init(ctx){api=createCoatingSystem({...options,thermal:ctx.get('thermal'),pools:ctx.get('pools'),emit:ctx.emit,quality:ctx.quality});
    ctx.on('pools:deposited',event=>api.deposited(event));
    ctx.on('flow:deposit',r=>{if(r.components.foam&&r.targetId&&!r.targetId.startsWith('pool:'))api.apply(r.targetId,r.components.foam,{normal:r.normal,jetDirection:r.direction});});
    ctx.on('sprinklers:spray',r=>{if(r.components.foam&&r.targets.length)for(const id of r.targets)if(!id.startsWith('pool:'))api.apply(id,r.components.foam/r.targets.length,{normal:[0,1,0],jetDirection:[0,-1,0]});});
    return api;},update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();}};}
