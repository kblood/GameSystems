import { positive, vector, clamp, SYSTEM_TIERS, tierState } from '../host/system.js';

export const SMOKE_BUDGETS=Object.freeze({minimal:12,low:32,mid:80,high:160});
// Visual smoke only. Persistent smoke/visibility and room exchange belong to thermal, independent of this budget.
export function createSmokeSystem({THREE,scene,thermal,quality='high',seed=714}={}) {
  if(!THREE?.InstancedMesh||!scene||!thermal?.roomStates)throw new TypeError('Smoke needs THREE, scene and thermal public API');
  const tiers=tierState(quality),bounds=new Map(),puffs=[],roomCounts=new Map();
  const capacity=SMOKE_BUDGETS.high,geometry=new THREE.PlaneGeometry(1,1),alpha=new Float32Array(capacity),clipMin=new Float32Array(capacity*3),clipMax=new Float32Array(capacity*3);
  geometry.setAttribute('puffOpacity',new THREE.InstancedBufferAttribute(alpha,1));
  geometry.setAttribute('puffMin',new THREE.InstancedBufferAttribute(clipMin,3));geometry.setAttribute('puffMax',new THREE.InstancedBufferAttribute(clipMax,3));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{tint:{value:new THREE.Color(0x555b5d)}},
    vertexShader:`attribute float puffOpacity;attribute vec3 puffMin;attribute vec3 puffMax;varying vec2 uvP;varying float alphaP;varying vec3 worldP;varying vec3 minP;varying vec3 maxP;
      void main(){uvP=uv;alphaP=puffOpacity;minP=puffMin;maxP=puffMax;float s=length(instanceMatrix[0].xyz);
      vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
      worldP=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz+right*position.x*s+up*position.y*s;
      gl_Position=projectionMatrix*viewMatrix*vec4(worldP,1.);}`,
    fragmentShader:`uniform vec3 tint;varying vec2 uvP;varying float alphaP;varying vec3 worldP;varying vec3 minP;varying vec3 maxP;
      void main(){if(any(lessThan(worldP,minP))||any(greaterThan(worldP,maxP)))discard;float r=length(uvP-vec2(.5))*2.;float a=(1.-smoothstep(.2,1.,r))*alphaP;if(a<.005)discard;gl_FragColor=vec4(tint,a);}`,
  });
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=6;scene.add(mesh);
  const transform=new THREE.Object3D();let accumulator=0,disposed=false,simSteps=0,roomLimit=capacity,roomCursor=0,selectedRooms=null;
  function live(){if(disposed)throw new Error('Smoke system is disposed');}
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function removePuff(index){const [p]=puffs.splice(index,1);const count=(roomCounts.get(p.roomId)??1)-1;if(count)roomCounts.set(p.roomId,count);else roomCounts.delete(p.roomId);}
  function largestRoom(){let id=null,count=0;for(const [room,n]of roomCounts)if(n>count){id=room;count=n;}return {id,count};}
  function takeSlot(roomId){
    if(selectedRooms&&!selectedRooms.has(roomId))return false;
    if((roomCounts.get(roomId)??0)>=roomLimit)return false;
    if(puffs.length<SMOKE_BUDGETS[tiers.quality])return true;
    const largest=largestRoom();if((roomCounts.get(roomId)??0)>=largest.count)return false;
    // Donate the oldest puff from the most represented room; persistent reservoirs are untouched.
    let oldest=-1;for(let i=0;i<puffs.length;i++)if(puffs[i].roomId===largest.id&&(oldest<0||puffs[i].life>puffs[oldest].life))oldest=i;
    removePuff(oldest);return true;
  }
  const reservoirOpacity=density=>clamp(.2+density*1.5,.2,.65)*clamp(density/.05,0,1);
  function spawn(room,position,density,sourceId=null) {
    const b=bounds.get(room.id);if(!b||!takeSlot(room.id))return;
    const p=position? [...position]:[b.min[0]+random()*(b.max[0]-b.min[0]),room.smokeLayerBottom,b.min[2]+random()*(b.max[2]-b.min[2])];
    puffs.push({roomId:room.id,sourceId,position:p.map((v,i)=>clamp(v,b.innerMin[i],b.innerMax[i])),life:0,maxLife:6+random()*4,
      drift:[(random()-.5)*.08,.3+random()*.2,(random()-.5)*.08],size:.12+random()*.12,opacity:sourceId===null?reservoirOpacity(density):clamp(.2+density*1.5,.2,.65)});
    roomCounts.set(room.id,(roomCounts.get(room.id)??0)+1);
  }
  const api={
    mesh,
    get quality(){return tiers.quality;},setQuality(tier){live();tiers.setQuality(tier);while(puffs.length>SMOKE_BUDGETS[tier]){const {id}=largestRoom();removePuff(puffs.findIndex(p=>p.roomId===id));}upload();},
    addRoomBounds(id,{min,max}){live();thermal.roomState(id);min=vector(min);max=vector(max);if(min.some((v,i)=>v>=max[i]))throw new RangeError('Invalid smoke bounds');const margin=min.map((v,i)=>Math.min(.05,(max[i]-v)*.25)),innerMin=min.map((v,i)=>v+margin[i]),innerMax=max.map((v,i)=>v-margin[i]);bounds.set(id,{min,max,innerMin,innerMax});for(const p of puffs)if(p.roomId===id)p.position=p.position.map((v,i)=>clamp(v,innerMin[i],innerMax[i]));upload();},
    removeRoomBounds(id){if(disposed)return false;const removed=bounds.delete(id);for(let i=puffs.length-1;i>=0;i--)if(puffs[i].roomId===id)removePuff(i);upload();return removed;},
    step(dt){
      if(disposed)return;positive(dt,'dt',true);if(dt>10)throw new RangeError('dt exceeds 10 seconds');accumulator+=dt;
      while(accumulator>=.1-1e-9){accumulator=Math.max(0,accumulator-.1);simSteps++;
        const rooms=new Map(thermal.roomStates().map(r=>[r.id,r]));
        const fires=(thermal.burningObjects?.()??thermal.objects()).filter(f=>f.burning&&f.intensity>0&&f.smokeYield!==0),emitting=new Map(fires.map(f=>[f.id,f])),activeRooms=new Set([...rooms.values()].filter(r=>r.smokeDensity>.003&&bounds.has(r.id)).map(r=>r.id));
        for(const fire of fires)if(bounds.has(fire.roomId))activeRooms.add(fire.roomId);
        const cap=SMOKE_BUDGETS[tiers.quality],ids=[...activeRooms];
        selectedRooms=ids.length>cap?new Set(Array.from({length:cap},(_,i)=>ids[(roomCursor+i)%ids.length])):null;
        if(selectedRooms)roomCursor=(roomCursor+1)%ids.length;
        roomLimit=Math.max(1,Math.ceil(cap/Math.max(1,activeRooms.size)));
        for(let i=puffs.length-1;i>=0;i--){const p=puffs[i],b=bounds.get(p.roomId),room=rooms.get(p.roomId),source=emitting.get(p.sourceId),liveSource=source?.roomId===p.roomId;p.life+=.1;if(!b||!room||p.life>=p.maxLife||!liveSource&&room.smokeDensity<=.003){removePuff(i);continue;}
          p.opacity=liveSource?clamp(.2+room.smokeDensity*1.5,.2,.65):reservoirOpacity(room.smokeDensity);
          p.position=p.position.map((v,k)=>clamp(v+p.drift[k]*.1,b.innerMin[k],b.innerMax[k]));p.size=Math.min(.8,p.size+.007);
        }
        for(const fire of fires)if(fire.roomId&&random()<clamp(fire.intensity/1500,0,1)){const room=rooms.get(fire.roomId);if(room)spawn(room,fire.position,room.smokeDensity,fire.id);}
        // Hot smoke remains after flames die. Reservoir density, not old fire particles, drives its persistence.
        for(const r of rooms.values())if(r.smokeDensity>.003&&random()<clamp(r.smokeDensity*3,0,1))spawn(r,null,r.smokeDensity);
      }
      upload();
    },
    stats(){return {particles:puffs.length,cap:SMOKE_BUDGETS[tiers.quality],drawCalls:1,simSteps,rooms:Object.fromEntries(roomCounts)};},
    clear(){if(disposed)return;puffs.length=0;roomCounts.clear();accumulator=0;roomCursor=0;selectedRooms=null;upload();},
    prime(){
      live();api.clear();const rooms=thermal.roomStates().filter(r=>r.smokeDensity>.003&&bounds.has(r.id)),cap=SMOKE_BUDGETS[tiers.quality];
      roomLimit=Math.max(1,Math.ceil(cap/Math.max(1,rooms.length)));
      const weight=rooms.reduce((n,r)=>n+r.smokeDensity,0);
      for(const r of rooms){const count=Math.min(cap-puffs.length,Math.ceil(cap*.6*r.smokeDensity/Math.max(.1,weight)));for(let i=0;i<count;i++)spawn(r,null,r.smokeDensity);}
      for(const p of puffs)p.life=p.maxLife*.3;upload();
    },
    dispose(){if(disposed)return;disposed=true;puffs.length=0;roomCounts.clear();bounds.clear();mesh.count=0;scene.remove(mesh);geometry.dispose();material.dispose();},
  };
  function upload(){mesh.count=puffs.length;for(let i=0;i<puffs.length;i++){const p=puffs[i],b=bounds.get(p.roomId);transform.position.set(...p.position);transform.scale.setScalar(p.size);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);const f=p.life/p.maxLife;alpha[i]=p.opacity*Math.min(1,f*8)*Math.min(1,(1-f)*4);clipMin.set(b.min,i*3);clipMax.set(b.max,i*3);}mesh.instanceMatrix.needsUpdate=true;for(const key of ['puffOpacity','puffMin','puffMax'])geometry.attributes[key].needsUpdate=true;}
  return api;
}
export default function smokeExtension(options={}) {let api;return {id:'smoke',requires:['thermal'],quality:SYSTEM_TIERS,
  init(ctx){api=createSmokeSystem({...options,THREE:ctx.THREE,scene:ctx.scene,thermal:ctx.get('thermal'),quality:ctx.quality});return api;},
  update(dt){api.step(dt);},setQuality(tier){api.setQuality(tier);},dispose(){api?.dispose();},
};}
