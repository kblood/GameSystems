import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VRButton} from 'three/addons/webxr/VRButton.js';
import {createHost} from './vendor/extensions/host/index.js';
import {clamp,finite,positive} from './vendor/extensions/host/system.js';
import {booleanState} from './vendor/extensions/host/state.js';
import checkpointExtension from './vendor/extensions/checkpoint/index.js';
import {createFireSceneProvider} from './vendor/extensions/checkpoint/fire-scene.js';
import thermalExtension,{assessFireHazards,createElectricalHeatAdapter} from './vendor/extensions/thermal/index.js';
import poolsExtension from './vendor/extensions/pools/index.js';
import poolInterestExtension from './vendor/extensions/pool-interest/index.js';
import flowExtension from './vendor/extensions/flow/index.js';
import coatingsExtension from './vendor/extensions/coatings/index.js';
import {bindPageLifecycle} from './page-lifecycle.js';
import {createWorldReadout} from './world-readout.js';
import missionsExtension from './vendor/extensions/missions/index.js';
import alarmsExtension from './vendor/extensions/alarms/index.js';
import smokeExtension from './vendor/extensions/smoke/index.js';
import bottlesExtension from './vendor/extensions/bottles/index.js';
import mechanicsExtension from './vendor/extensions/mechanics/index.js';
import supplyExtension from './vendor/extensions/supply/index.js';
import sprinklersExtension from './vendor/extensions/sprinklers/index.js';
import {createNetworkPump} from './vendor/extensions/sprinklers/power.js';
import {createElectricitySystem} from './vendor/extensions/electricity/index.js';
import {connectBottlePools} from './vendor/extensions/pools/bottle-bridge.js';
import {PhysicsWorld,box} from './physics.js';
import {assetUrl} from './urls.js';

const $=id=>document.getElementById(id),toast=text=>{$('toast').textContent=text;};
const doorPortal={min:[-.04,0,.3],max:[.04,2.1,1.1]};
const challengeLimits={easy:180,normal:120,hard:60};
const roomProfiles={standard:{heatCapacityPerVolume:1200,heatFraction:.08,coolingRate:.005},insulated:{heatCapacityPerVolume:1200,heatFraction:.08,coolingRate:.001},light:{heatCapacityPerVolume:300,heatFraction:.08,coolingRate:.005}};
const scene=new THREE.Scene();scene.background=new THREE.Color(0x25383e);
const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.02,60);camera.position.set(4,4.2,6);
const rig=new THREE.Group();rig.add(camera);scene.add(rig);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.xr.enabled=true;document.body.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.7,0);controls.update();
scene.add(new THREE.HemisphereLight(0xe1edf0,0x43413a,2.5));const light=new THREE.DirectionalLight(0xffddb4,3);light.position.set(0,6,3);scene.add(light);
const content=new THREE.Group();scene.add(content);
let host,physics,heat,pools,bottles,smoke,mechanics,diesel,checkpoint,selected='chair',missionStarted=false,pourClock=0,saved=null,bridgeOff,token=0,blastClock=0,simulationPaused=false,lastRestore=null;
const SAVE_KEY='gamesystems.fire-station.v1';
let objectMeshes=new Map(),flames=new Map(),surfaces=[],poolList=[],poolMesh,doorPivot,windowMesh,blastMesh;
let eastBurned=false,missions,missionInitial,alarms,alarmInitial,alarmVisuals,supply,sprinklers,power,pump,electricalHeat,interest,pumpMesh,sprinklerVisuals=new Map();
let flow,coatings,hoseLine,hoseBlockers=[];const xrHoses=new Map(),hoseRay=new THREE.Raycaster(),foamTint=new THREE.Color(0xe6ece4);hoseRay.far=8;
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),dummy=new THREE.Object3D();
function cube(size,pos,color,parent=content){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color}));m.position.set(...pos);parent.add(m);hoseBlockers.push(m);return m;}
function textLabel(text,pos){const c=document.createElement('canvas');c.width=512;c.height=100;const x=c.getContext('2d');x.fillStyle='#203335';x.fillRect(0,0,512,100);x.font='bold 32px system-ui';x.textAlign='center';x.fillStyle='#e8ceae';x.fillText(text,256,64);const m=new THREE.Mesh(new THREE.PlaneGeometry(1,.195),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.DoubleSide}));m.position.set(...pos);content.add(m);return m;}
function fireVisual(id){const group=new THREE.Group();group.name=`fire:${id}`;group.visible=false;content.add(group);for(let i=0;i<5;i++){const m=new THREE.Mesh(new THREE.ConeGeometry(.065,.45,7),new THREE.MeshBasicMaterial({color:i%2?0xffbb5b:0xf77838}));m.position.set(Math.sin(i*2.4)*.08,.18,Math.cos(i*2.4)*.08);group.add(m);}flames.set(id,group);return group;}
function disposeGroup(){content.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){m.map?.dispose();m.dispose();}});content.clear();}
function build(){
  hoseBlockers=[];
  objectMeshes=new Map();flames=new Map();surfaces=[];
  for(const [id,x] of [['west',-1.2],['east',1.2]]){const floor=box(content,physics,[2.4,.12,2.6],[x,-.06,0],id==='west'?0x777c70:0x697d7c,{surface:'concrete'});floor.userData.materialId=`floor-${id}`;surfaces.push(floor);textLabel(id==='west'?'VEST / BRÆNDBART':'ØST / BESKYT RUMMET',[x,2.8,-1.28]);}
  hoseBlockers.push(box(content,physics,[4.8,2.6,.12],[0,1.3,-1.36],0x80918b),box(content,physics,[.12,2.6,2.6],[-2.46,1.3,0],0x6d8583));
  cube([.06,2.6,1.6],[0,1.3,-.5],0x778d87);cube([.06,.5,.8],[0,2.35,.7],0x778d87);
  const roof=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.8,.02,2.6)),new THREE.LineBasicMaterial({color:0xa6b4a4}));roof.position.set(0,2.6,0);content.add(roof);
  doorPivot=new THREE.Group();doorPivot.position.set(0,0,.3);content.add(doorPivot);const door=cube([.07,2.1,.8],[0,1.05,.4],0x9a7951,doorPivot);door.userData.control='door';
  windowMesh=cube([.7,.7,.04],[-1.45,1.7,-1.28],0x9ec0cb);windowMesh.userData.control='window';windowMesh.material.transparent=true;windowMesh.material.opacity=.5;
  const specs=[['chair',[-1.1,.32,-.5],[.35,.65,.35],0x91633e],['curtain',[-.25,.7,-.5],[.1,.9,.35],0xb18562],['east-chair',[.45,.32,-.5],[.35,.65,.35],0x876042],['metal',[1.5,.25,.4],[.35,.5,.35],0x8c9b9b],['charge',[-1.8,.18,-.8],[.22,.35,.22],0x46534d]];
  for(const[id,pos,size,color]of specs){const m=cube(size,pos,color);m.userData.fireId=id;m.userData.baseColor=m.material.color.clone();objectMeshes.set(id,m);fireVisual(id).position.copy(m.position);}
  poolMesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,.007,32),new THREE.MeshStandardMaterial({color:0xb99c59,transparent:true,opacity:.7,roughness:.25}),128);poolMesh.count=0;poolMesh.frustumCulled=false;content.add(poolMesh);
  poolMesh.material.color.set(0xffffff);
  blastMesh=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshBasicMaterial({color:0xffad57,transparent:true,opacity:.3,wireframe:true}));blastMesh.visible=false;content.add(blastMesh);
  pumpMesh=cube([.3,.35,.3],[1.95,.18,-.85],0x466579);textLabel('PUMPE / BATTERI',[1.8,.65,-1.27]);
  hoseLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0x8ac7e1,transparent:true,opacity:.8}));hoseLine.visible=false;content.add(hoseLine);
  hoseLine.frustumCulled=false;
  alarmVisuals=new Map();for(const [id,x]of [['west',-1.2],['east',1.2]]){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.07,12,8),new THREE.MeshBasicMaterial({color:0x74a791}));lamp.name=`alarm:${id}`;lamp.position.set(x,2.4,-1.25);content.add(lamp);alarmVisuals.set(id,lamp);}
  sprinklerVisuals=new Map();
  for(const [id,x]of [['west',-1.2],['east',1.2]]){
    const head=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,.08,12),new THREE.MeshStandardMaterial({color:0xb9a16d,metalness:.8,roughness:.3}));head.position.set(x,2.5,0);content.add(head);
    const points=[];for(let i=0;i<12;i++){const a=i*Math.PI/6;points.push(new THREE.Vector3(x,2.45,0),new THREE.Vector3(x+Math.cos(a)*.9,.05,Math.sin(a)*.9));}
    const spray=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x8cbddd,transparent:true,opacity:.45}));spray.visible=false;content.add(spray);sprinklerVisuals.set(id,spray);
  }
}
async function reset(){
  stopHose();flow=null;
  $('hose-kind').value='hose';
  $('foam-dose').value='150';
  electricalHeat?.dispose();electricalHeat=null;pump?.dispose();power?.dispose();pump=power=null;
  const current=++token;window.__fire=null;document.querySelectorAll('button').forEach(b=>b.disabled=true);bridgeOff?.();checkpoint?.dispose();host?.dispose();missions=alarms=null;heat=pools=bottles=smoke=mechanics=diesel=checkpoint=null;disposeGroup();selected='chair';missionStarted=false;eastBurned=false;pourClock=0;blastClock=0;simulationPaused=false;lastRestore=null;$('pause').textContent='Pause';
  $('door').value='1';$('window').value='1';$('target').querySelectorAll('option[data-pool]').forEach(o=>o.remove());$('target').value='chair';
  physics=new PhysicsWorld();build();host=createHost({THREE,scene,renderer,camera,physics:physics.adapter,quality:+$('quality').value,onError:(e,id)=>{console.error(id,e);toast(`Fejl: ${e.message}`);}});
  heat=await host.load(thermalExtension,{autoSpread:true,spreadRadius:1,spreadConductance:12});
  heat.addRoom('west',{volume:16,ceiling:2.6});heat.addRoom('east',{volume:16,ceiling:2.6});heat.addVent('door',{a:'west',b:'east',open:1,flow:3,portal:doorPortal});heat.addVent('window',{a:'west',flow:8,open:1});
  for(const id of ['chair','curtain','east-chair','metal','charge']){const mesh=objectMeshes.get(id),material=id==='metal'?'metal':id==='charge'?'powder':id==='curtain'?'fabric':'wood';heat.add(id,{material,position:mesh.position.toArray(),roomId:id==='east-chair'||id==='metal'?'east':'west',fuelJ:material==='metal'?0:material==='powder'?3000:500000,heatCapacity:100,airConductance:.5,burnPower:material==='metal'?0:material==='powder'?3000:1800,smokeYield:.00014,...(id==='charge'?{blast:{fuseSeconds:2,radius:1.4,strength:12}}:{})});}
  mechanics=await host.load(mechanicsExtension);mechanics.add('door',{kind:'hinge',axis:[0,1,0],max:Math.PI/2,value:Math.PI/2});
  host.on('mechanics:changed',s=>{if(s.id==='door'){heat.setVent('door',s.fraction);doorPivot.rotation.y=s.value;}});doorPivot.rotation.y=Math.PI/2;
  alarms=await host.load(alarmsExtension);for(const id of ['west','east'])alarms.add(id,{roomId:id});alarmInitial=alarms.capture();
  pools=await host.load(poolsExtension,{airConductance:.5,accept:e=>surfaces.some(s=>s.userData.materialId===e.surfaceId),roomFor:e=>e.surfaceId==='floor-west'?'west':'east'});
  supply=await host.load(supplyExtension);supply.add('sprinkler-tank',{capacityMl:3000});supply.add('hose-tank',{capacityMl:1200,components:{water:1200}});supply.add('foam-tank',{capacityMl:600,components:{foam:600}});
  coatings=await host.load(coatingsExtension);
  for(const[id,m]of objectMeshes){const {width:w,height:h,depth:d}=m.geometry.parameters;coatings.add(id,{areaM2:2*(w*h+w*d+h*d),normal:id==='curtain'?[0,0,1]:[0,1,0],heightM:Math.max(0,m.position.y)});}
  power=createElectricitySystem({emit:(type,data)=>{if(type==='electricity:energy')electricalHeat?.consume(data);}});power.add('battery',{kind:'battery',a:'p',b:'g',voltage:12,capacityWh:1,energyWh:1,resistance:.08});
  power.add('switch',{kind:'switch',a:'p',b:'sw',resistance:.02});power.add('wire',{kind:'wire',a:'sw',b:'f',resistance:.02});power.add('fuse',{kind:'fuse',a:'f',b:'bus',resistance:.02,rating:5});
  power.add('pump',{a:'bus',b:'g',resistance:4,enabled:false});power.add('fault',{a:'bus',b:'g',resistance:.1,enabled:false});power.evaluate();
  electricalHeat=createElectricalHeatAdapter({network:power,thermal:heat,bindings:[{componentId:'wire',thermalId:'metal',fraction:1}]});
  pump=createNetworkPump({network:power,loadId:'pump',ratedW:36});
  sprinklers=await host.load(sprinklersExtension,{powerFraction:pump.powerFraction});
  for(const [id,x]of [['west',-1.2],['east',1.2]])sprinklers.add(id,{tankId:'sprinkler-tank',position:[x,2.5,0],roomId:id,surfaceId:`floor-${id}`,radius:3.2,rateMlPerSecond:120,open:false});
  interest=await host.load(poolInterestExtension,{radius:1});
  flow=await host.load(flowExtension,{resolveTarget:hoseTarget,acceptTarget:t=>t.targetId===null?surfaces.some(s=>s.userData.materialId===t.surfaceId):heat.hasObject(t.targetId)||(t.targetId?.startsWith('pool:')&&pools.has(t.targetId.slice(5))),apply:r=>{const water=r.components.water??0;if(water&&r.targetId&&!r.targetId.startsWith('pool:'))heat.water(r.targetId,water);}});
  flow.add('hose',{tankId:'hose-tank',sourceKey:'hose',rateMlPerSecond:240});
  flow.add('foam',{tankId:'foam-tank',sourceKey:'foam',rateMlPerSecond:120});
  const catalog=await(await fetch(assetUrl('catalog.json'))).json();if(current!==token)return;
  bottles=await host.load(bottlesExtension,{catalog,assetURL:assetUrl,surfaces,audio:{play(){}}});bridgeOff=connectBottlePools({host,bottles,pools});
  const thisBottles=bottles,newDiesel=await thisBottles.spawn('container_jerrycan','container_jerrycan_fuel',.02,new THREE.Vector3(-1.65,.8,.7),true);if(current!==token){thisBottles.remove(newDiesel);return;}diesel=newDiesel;diesel.liquidKind='diesel';
  diesel.checkpointId='diesel-can';
  physics.hold(diesel.entry,{position:[-1.65,.8,.7],quaternion:[0,0,0,1]});
  smoke=await host.load(smokeExtension);smoke.addRoomBounds('west',{min:[-2.4,0,-1.3],max:[0,2.6,1.3]});smoke.addRoomBounds('east',{min:[0,0,-1.3],max:[2.4,2.6,1.3]});
  missions=await host.load(missionsExtension,{clearSeconds:3,evaluate:({data})=>{const report=hazards(),failed=eastBurned||report.rooms.some(r=>r.id===(data?.protectRoom??'east')&&r.fires>0);return {clear:report.clear,failed,reason:'Østrummet fik brand.'};}});missionInitial=missions.capture();
  checkpoint=await host.load(checkpointExtension,{sceneId:'fire-station-v1'});
  checkpoint.register('fire',createFireSceneProvider({thermal:heat,pools,bottles,mechanics,supply,flow,coatings,application:applicationState()}));
  checkpoint.register('sprinklers',sprinklers);
  checkpoint.register('electricity',power);checkpoint.register('pump',pump);
  checkpoint.register('pool-interest',interest);
  host.on('thermal:ignited',s=>{if(s.roomId==='east'&&missions.state().status==='active')eastBurned=true;});
  host.on('thermal:blast',e=>{blastMesh.position.set(...e.position);blastClock=.7;toast('Spil-ladningen udløste sin effekt.');});
  window.__fire={host,heat,pools,bottles,smoke,alarms,missions,supply,sprinklers,power,pump,electricalHeat,interest,flow,coatings,physics,renderer,camera,scene,checkpoint,reset,worldReadout,state:()=>({challenge:missions.state(),alarms:alarms.all(),rooms:heat.roomStates(),objects:heat.objects(),pools:pools.all(),waterMl:supply.state('hose-tank').ml,foamMl:supply.state('foam-tank').ml,mission:missionStatus(),hazards:hazards(),paused:simulationPaused,pourClock,lastRestore}),project};
  document.querySelectorAll('button').forEach(b=>b.disabled=false);
  select('chair');windowMesh.rotation.y=heat.ventState('window').open*Math.PI/3;
  let note='Vælg en genstand. Ilden spreder sig via varme.';
  if(!saved){try{const text=localStorage.getItem(SAVE_KEY);if(text){saved=checkpoint.decode(text);note='En gemt brandstation kan indlæses.';}}catch{note='Den lagrede gemning kunne ikke læses. Bygningen er startet normalt.';}}
  toast(note);
}
function applicationState(){
  return {capture(){return {eastBurned,challenge:missions.capture(),difficulty:$('challenge-difficulty').value,alarms:alarms.capture(),waterMl:supply.state('hose-tank').ml,foamMl:supply.state('foam-tank').ml,hoseMode:selectedNozzle(),foamDose:+$('foam-dose').value,missionStarted,pourClock:Math.max(0,pourClock),paused:simulationPaused,selected,quality:+$('quality').value,timeScale:+$('speed').value,blastClock,blastPosition:blastMesh.position.toArray()};},
    prepareRestore(data,{thermalPlan,mechanicsPlan,poolRecords,supplyPlan}){
      const protectedBurn=data.eastBurned===undefined?false:booleanState(data.eastBurned);
      const missionPlan=missions.prepareRestore(data.challenge===undefined?missionInitial:data.challenge),challenge=missionPlan.state(),difficulty=data.difficulty===undefined?'normal':data.difficulty;
      if(!Object.hasOwn(challengeLimits,difficulty)||challenge.status!=='idle'&&(challenge.data?.scenario!=='west-fire'||!Object.hasOwn(challengeLimits,challenge.data?.difficulty)||challenge.data?.protectRoom!=='east'||challenge.timeLimit!==challengeLimits[challenge.data.difficulty]||data.missionStarted!==true))throw new Error('Invalid saved fire challenge');
      const alarmPlan=alarms.prepareRestore(data.alarms===undefined?alarmInitial:data.alarms,{roomExists:id=>thermalPlan.roomState(id)});
      const water=positive(data.waterMl,'waterMl',true),pour=positive(data.pourClock,'pourClock',true),blast=positive(data.blastClock,'blastClock',true),quality=finite(data.quality),timeScale=finite(data.timeScale);
      if(water>1200||pour>2||blast>.7||!Number.isInteger(quality)||quality<0||quality>3||![1,5].includes(timeScale))throw new Error('Invalid saved station resources/settings');
      if(!supplyPlan||Math.abs(supplyPlan.state('hose-tank').ml-water)>1e-6)throw new Error('Saved hose display disagrees with source tank');
      const foam=positive(data.foamMl,'foamMl',true);if(foam>600||Math.abs(supplyPlan.state('foam-tank').ml-foam)>1e-6||!['hose','foam'].includes(data.hoseMode)||![20,75,150].includes(data.foamDose))throw new Error('Invalid saved foam supply/mode');
      const paused=booleanState(data.paused),started=booleanState(data.missionStarted),position=data.blastPosition;
      if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new Error('Invalid saved blast position');
      if(thermalPlan.roomIds().sort().join(',')!=='east,west'||thermalPlan.objectIds().filter(id=>!id.startsWith('pool:')).sort().join(',')!==['chair','charge','curtain','east-chair','metal'].sort().join(','))throw new Error('Checkpoint belongs to another building layout');
      thermalPlan.objectState(data.selected);
      const door=thermalPlan.ventState('door'),window=thermalPlan.ventState('window');
      if(door.portal!==null&&JSON.stringify(door.portal)!==JSON.stringify(doorPortal))throw new Error('Saved door portal differs from building geometry');
      if(door.a!=='west'||door.b!=='east'||window.a!=='west'||window.b!==null||Math.abs(door.open-mechanicsPlan.state('door').fraction)>1e-8)throw new Error('Saved openings disagree with building mechanics');
      let target=data.selected;const pool=poolRecords.find(p=>p.thermalId===target);if(pool&&pool.ml<=.01)target='chair';
      return {commit(){eastBurned=protectedBurn;missionPlan.commit();$('challenge-difficulty').value=difficulty;alarmPlan.commit();xrHoses.clear();$('hose-kind').value=data.hoseMode;$('foam-dose').value=data.foamDose;pourClock=pour;blastClock=blast;blastMesh.position.set(...position);simulationPaused=paused;missionStarted=started;selected=target;},
        notify(){missionPlan.notify();alarmPlan.notify();host.setQuality(quality);$('quality').value=quality;$('speed').value=timeScale;$('door').value=door.open;$('window').value=window.open;doorPivot.rotation.y=mechanics.state('door').value;windowMesh.rotation.y=window.open*Math.PI/3;$('pause').textContent=paused?'Fortsæt':'Pause';smoke.prime();visuals(0);select(target);visuals(0);}
      };
    }
  };
}
function restoreCheckpoint(data){lastRestore=checkpoint.restore(data);toast(lastRestore.observerErrors.length?'Bygningen er indlæst, men visningen kunne ikke opdateres helt.':'Hele brandstationen er indlæst.');}
function storeCheckpoint(data){saved=data;try{localStorage.setItem(SAVE_KEY,checkpoint.encode(data));return true;}catch{return false;}}
function select(id){try{if(id.startsWith('pool:')&&pools.has(id.slice(5))&&!pools.activate(id.slice(5))){$('target').value=selected;toast('Alle aktive pladser bruges af varme, våde eller forbundne pytter. Væsken er stadig gemt.');return;}const s=heat.state(id);selected=id;$('target').value=id;$('flammability').value=s.flammability;$('ignition').value=s.ignition;}catch{toast('Vælg en eksisterende genstand.');}}
function hazards(){return assessFireHazards({rooms:heat.roomStates(),objects:heat.objects(),hotDormantSummary:pools.hotDormantSummary()});}
function missionStatus(report=hazards()){
  const challenge=missions?.state(),hint=sandboxStatus(report);if(!challenge||challenge.status==='idle')return hint;
  if(challenge.status==='succeeded')return `Udfordring klaret på ${challenge.elapsed.toFixed(1)} s. ${hint}`;
  if(challenge.status==='failed')return `Udfordring fejlet: ${challenge.failureKind==='timeout'?'tiden udløb':challenge.reason} ${hint}`;
  return `Udfordring · ${Math.ceil(challenge.timeLimit-challenge.elapsed)} s tilbage. ${report.clear?`Kontrol ${challenge.clearElapsed.toFixed(1)} / 3 s.`:hint}`;
}
async function startChallenge(){
  const difficulty=$('challenge-difficulty').value,generation=token+1;await reset();if(generation!==token||!checkpoint)return;
  missionStarted=true;heat.setPosition('curtain',[-.25,.7,.7],'west');heat.setPosition('east-chair',[.45,.32,.7],'east');heat.ignite('chair');heat.ignite('curtain');missions.start({timeLimit:challengeLimits[difficulty],data:{scenario:'west-fire',difficulty,protectRoom:'east'}});select('chair');visuals(0);toast('Sluk vest, beskyt øst og køl/ventilér bygningen.');
}
function sandboxStatus(report=hazards()){
  if(!missionStarted)return 'Antænd en genstand og prøv at slukke bygningen.';
  const states=[...report.rooms,report.outside],fires=states.reduce((n,r)=>n+r.fires,0),reasons=report.reasons;
  if(fires)return `${fires} brande aktive. Beskyt det østlige rum.`;
  if(reasons.includes('charge'))return 'Der er en aktiv spil-ladning i bygningen.';
  if(reasons.includes('hot-fuel'))return 'Flammerne er væk, men brændstoffet er stadig varmt.';
  if(reasons.includes('dormant-fuel'))return 'Der er stadig varmt brændstof i en gemt pyt. Frigør en aktiv plads eller opsaml væsken.';
  if(reasons.includes('heat'))return 'Ilden er slukket, men rumluften er stadig varm.';
  if(reasons.includes('smoke'))return 'Ilden er slukket. Der er stadig røg i bygningen.';
  if(reasons.includes('air'))return 'Ilden er slukket, men luftreserven skal genoprettes.';
  return 'Bygningen er slukket og ventileret.';
}
function project(position){const p=new THREE.Vector3(...position).project(camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};}
function stopHose(){if(flow&&host?.get('flow')===flow)flow.stopAll();xrHoses.clear();if(hoseLine)hoseLine.visible=false;}
function selectedNozzle(){return $('hose-kind').value==='foam'?'foam':'hose';}
function releaseHose(owner){if(flow&&host?.get('flow')===flow)for(const id of ['hose','foam'])flow.stop(id,owner);}
function hoseTarget(emitterId='hose'){
  let id=selected,impact=null,normal=null,jet=null;const tracked=[...xrHoses.values()].find(e=>e.emitterId===emitterId);
  if(tracked){const controller=tracked.controller;controller.updateMatrixWorld(true);const q=controller.getWorldQuaternion(new THREE.Quaternion());hoseRay.ray.origin.setFromMatrixPosition(controller.matrixWorld);hoseRay.ray.direction.set(0,0,-1).applyQuaternion(q);
    content.updateMatrixWorld(true);const hit=hoseRay.intersectObjects([...hoseBlockers,...surfaces,poolMesh],true)[0];if(!hit)return null;
    normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray();jet=hoseRay.ray.direction.toArray();
    if(surfaces.includes(hit.object)){const surfaceId=hit.object.userData.materialId;return {targetId:null,roomId:surfaceId==='floor-west'?'west':'east',surfaceId,position:[hit.point.x,.01,hit.point.z],impactPosition:hit.point.toArray(),normal,direction:jet};}
    id=hit.object===poolMesh?poolList[hit.instanceId]?.thermalId:hit.object.userData.fireId;if(!id)return null;impact=hit.point.toArray();
  }
  const s=id.startsWith('pool:')&&pools.has(id.slice(5))?pools.state(id.slice(5)):heat.hasObject(id)?heat.state(id):null;if(!s)return null;
  normal=normal??coatings.state(id).normal;jet=jet??normal.map(n=>-n);
  return {targetId:id,roomId:s.roomId,surfaceId:`floor-${s.roomId}`,position:[impact?.[0]??s.position[0],.01,impact?.[2]??s.position[2]],impactPosition:impact??[...s.position],normal,direction:jet};
}
function hose(){if(!flow)return;const out=flow.pulse('hose',80);toast(out.ml?`${out.ml.toFixed(0)} ml vand køler målet.`:'Ingen væske eller gyldigt mål.');}
const challengeActive=()=>missions?.state().status==='active';
const editorActions=new Set(['ignite','heat','pour','arm','hose-refill','sprinkler-fill','pump-charge','remove-pool','remove-dormant']);
const pausedActions=new Set(['water','foam','sprinkler-valve','sprinkler-reset','pump-switch','pump-wire','pump-cable','pump-fault','pump-fuse']);
const actions={
  'challenge-start':()=>startChallenge().catch(()=>toast('Udfordringen kunne ikke startes.')),
  'challenge-stop':()=>{missions.reset();toast('Tilbage i sandkassen. Bygningen fortsætter som den er.');},
  'alarm-silence':()=>{for(const a of alarms.all())alarms.silence(a.id);},
  'alarm-reset':()=>{const blocked=alarms.all().filter(a=>!alarms.reset(a.id));toast(blocked.length?'Rum skal køles og ventileres før alarmen kan resettes.':'Alarmerne er nulstillet.');},
  'alarm-power':()=>{const enabled=!alarms.all().some(a=>a.enabled);for(const a of alarms.all())alarms.setEnabled(a.id,enabled);},
  'hose-refill':()=>{const foam=selectedNozzle()==='foam',out=supply.fill(foam?'foam-tank':'hose-tank',foam?600:1200,{kind:foam?'foam':'water'});toast(`${out.acceptedMl.toFixed(0)} ml ${foam?'skum':'vand'} fyldt på slangen.`);},
  'pump-switch':()=>{power.setEnabled('switch',!power.state('switch').enabled);power.evaluate();},
  'pump-cable':()=>{power.configure('wire',{resistance:power.state('wire').resistance>.02?.02:1.5});power.evaluate();},
  'pump-wire':()=>{power.setEnabled('wire',!power.state('wire').enabled);power.evaluate();},
  'pump-fault':()=>{power.setEnabled('fault',!power.state('fault').enabled);power.evaluate();},
  'pump-fuse':()=>{power.replaceFuse('fuse');power.evaluate();},
  'pump-charge':()=>{power.charge('battery',1);power.evaluate();},
  'show-dormant':()=>{const p=pools.nextDormant();if(p)select(p.thermalId);else toast('Alle gemte pytter er allerede aktive.');},
  'remove-dormant':()=>{const p=pools.nextDormant();if(p){pools.remove(p.id);toast('Den næste gemte pyt er opsamlet.');}},
  'sprinkler-fill':()=>{const result=supply.fill('sprinkler-tank',500,{kind:$('sprinkler-liquid').value});toast(`${result.acceptedMl.toFixed(0)} ml fyldt på sprinklerforsyningen.`);},
  'sprinkler-valve':()=>{const open=!sprinklers.state('west').open;for(const id of ['west','east'])sprinklers.setOpen(id,open);},
  'sprinkler-reset':()=>{for(const id of ['west','east'])sprinklers.reset(id);toast('Sprinklerhovederne er skiftet. Varme kan udløse dem igen.');},
  ignite:()=>{missionStarted=true;toast(heat.ignite(selected)?'Genstanden brænder.':'Genstanden kan ikke antændes nu.');},
  heat:()=>{missionStarted=true;heat.addHeat(selected,20000);toast('Varmen stiger mod antændelsestemperaturen.');},
  water:hose,foam:()=>{const s=heat.state(selected),n=coatings.state(selected).normal;const out=flow.pulse('foam',+$('foam-dose').value,{targetId:selected,roomId:s.roomId,surfaceId:`floor-${s.roomId}`,position:[s.position[0],.01,s.position[2]],impactPosition:s.position,normal:n,direction:n.map(x=>-x)});toast(`${out.ml.toFixed(0)} ml skum er doseret på overfladen.`);},
  pour:()=>{pourClock=2;physics.hold(diesel.entry,{position:[-1.65,.8,.7],quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI).toArray()});toast('Den rigtige dunk hælder diesel ud.');},
  arm:()=>{missionStarted=true;heat.arm('charge');toast('Abstrakt spil-ladning: 2 sekunders timer.');},
  save:()=>{const data=checkpoint.capture();toast(storeCheckpoint(data)?'Hele brandstationen er gemt i browseren.':'Brandstationen er gemt i denne session; browserlageret kunne ikke opdateres.');},
  restore:()=>{if(saved)restoreCheckpoint(saved);else toast('Der findes endnu ingen gemning.');},reset,
  pause:()=>{stopHose();simulationPaused=!simulationPaused;$('pause').textContent=simulationPaused?'Fortsæt':'Pause';toast(simulationPaused?'Simulationen er sat på pause.':'Simulationen fortsætter.');},
  download:()=>{const data=checkpoint.capture(),url=URL.createObjectURL(new Blob([checkpoint.encode(data)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='brandstation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Gemningen eksporteres som en fil.');},
  import:()=>{$('checkpoint-file').click();},
  'remove-pool':()=>{const id=selected.startsWith('pool:')?selected.slice(5):null;if(id&&pools.has(id)){pools.remove(id);select('chair');toast('Den valgte pyt er opsamlet.');}},
};
function actionAllowed(id,active=challengeActive()){return Object.hasOwn(actions,id)&&typeof actions[id]==='function'&&!(active&&(editorActions.has(id)||simulationPaused&&pausedActions.has(id)));}
function invokeAction(id){if(!checkpoint||!window.__fire)return false;try{if(!actionAllowed(id)){toast('Genoptag udfordringen for at betjene udstyret; redigering/genopfyldning kræver sandkasse.');return false;}const result=actions[id]();if(result?.then)Promise.resolve(result).catch(()=>toast('Handlingen kunne ikke gennemføres.'));if(window.__fire&&heat&&flow&&checkpoint)visuals(0);return true;}catch{toast('Handlingen kunne ikke gennemføres.');return false;}}
for(const id of Object.keys(actions))$(id).addEventListener('click',()=>invokeAction(id));
actions['challenge-level']=()=>{const levels=Object.keys(challengeLimits),next=levels[(levels.indexOf($('challenge-difficulty').value)+1)%levels.length];$('challenge-difficulty').value=next;toast(`Næste opgave: ${challengeLimits[next]} s.`);};
const hoseHold=$('hose-hold');
hoseHold.addEventListener('pointerdown',event=>{if(event.button!==0||!checkpoint||simulationPaused)return;event.preventDefault();const owner=`pointer:${event.pointerId}`;hoseHold.setPointerCapture(event.pointerId);flow.start(selectedNozzle(),owner);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])hoseHold.addEventListener(name,event=>releaseHose(`pointer:${event.pointerId}`));
hoseHold.addEventListener('keydown',event=>{if(!['Enter','Space'].includes(event.code))return;event.preventDefault();if(!event.repeat&&checkpoint&&!simulationPaused)flow.start(selectedNozzle(),`key:${event.code}`);});
window.addEventListener('keyup',event=>{if(['Enter','Space'].includes(event.code))releaseHose(`key:${event.code}`);});
hoseHold.addEventListener('blur',()=>{if(flow)for(const id of ['hose','foam'])for(const owner of flow.state(id).owners)if(owner.startsWith('key:'))releaseHose(owner);});
$('hose-kind').addEventListener('change',stopHose);
window.addEventListener('blur',stopHose);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHose();});
$('checkpoint-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0],generation=token;if(!file||!checkpoint)return;
  try{if(file.size>2*1024*1024)throw new Error('File exceeds checkpoint budget');const text=await file.text();if(generation!==token)return;const data=checkpoint.decode(text);restoreCheckpoint(data);storeCheckpoint(data);}
  catch(error){toast(error instanceof AggregateError?'Gemningen fejlede under indlæsning. Genstart bygningen.':'Gemningen kunne ikke indlæses. Den aktive bygning er bevaret.');}
  finally{event.target.value='';}
});
$('target').addEventListener('change',()=>select($('target').value));
for(const key of ['flammability','ignition'])$(key).addEventListener('input',()=>{if(heat&&!challengeActive())heat.configure(selected,{[key]:+$(key).value});});
$('door').addEventListener('input',()=>{if(!challengeActive()||!simulationPaused)mechanics?.setValue('door',+$('door').value*Math.PI/2);});
$('window').addEventListener('input',()=>{if(challengeActive()&&simulationPaused)return;heat?.setVent('window',+$('window').value);windowMesh.rotation.y=+$('window').value*Math.PI/3;});
$('room-profile').addEventListener('change',()=>{if(!heat||challengeActive())return;const roomId=heat.state(selected).roomId,profile=roomProfiles[$('room-profile').value];if(roomId&&profile){heat.configureRoom(roomId,profile);visuals(0);}});
$('quality').addEventListener('change',()=>{host?.setQuality(+$('quality').value);renderer.setPixelRatio(Math.min(devicePixelRatio,[.7,1,1.25,1.5][+$('quality').value]));});
function pick(){const hit=ray.intersectObjects([...objectMeshes.values(),poolMesh,doorPivot,windowMesh],true)[0];if(!hit)return;
  if(hit.object===poolMesh){const p=poolList[hit.instanceId];if(p)select(p.thermalId);}
  else if(hit.object.userData.fireId)select(hit.object.userData.fireId);
  else if(hit.object.userData.control==='door'){if(challengeActive()&&simulationPaused)return;const open=heat.ventState('door').open>.5?0:1;mechanics.setValue('door',open*Math.PI/2);$('door').value=open;}
  else if(hit.object.userData.control==='window'){if(challengeActive()&&simulationPaused)return;const open=heat.ventState('window').open>.5?0:1;heat.setVent('window',open);$('window').value=open;}
}
renderer.domElement.addEventListener('click',e=>{if(!heat)return;pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);ray.setFromCamera(pointer,camera);pick();});
function visuals(dt){
  const locked=challengeActive();for(const button of buttons){const allowed=button.userData.nozzleMode?!simulationPaused:actionAllowed(button.userData.actionId,locked);button.material.opacity=allowed?1:.35;if(button.userData.actionId==='pause')updateXrLabel(button,simulationPaused?'FORTSÆT':'PAUSE');if(button.userData.actionId==='challenge-level'){const level=$('challenge-difficulty').value;updateXrLabel(button,`NÆSTE ${({easy:'LET',normal:'NORMAL',hard:'SVÆR'})[level]} ${challengeLimits[level]} S`);}}
 for(const id of editorActions)$(id).disabled=locked;for(const id of pausedActions)$(id).disabled=locked&&simulationPaused;for(const id of ['flammability','ignition'])$(id).disabled=locked;for(const id of ['door','window'])$(id).disabled=locked&&simulationPaused;
  const alarmStates=alarms.all();for(const a of alarmStates)alarmVisuals.get(a.id).material.color.set(!a.enabled?0x52585a:a.triggered?a.silenced?0xd7a65b:0xec634c:0x74a791);
  const alarmText=alarmStates.map(a=>`${a.id==='west'?'VEST':'ØST'}: ${!a.enabled?'slået fra':a.fault?'rum mangler':!a.powered?'uden strøm':a.triggered?a.silenced?'udløst · dæmpet':'ALARM':'klar'}`).join(' · ');$('alarm-status').textContent=alarmText;$('alarm-power').textContent=alarmStates.some(a=>a.enabled)?'Slå alarmer fra':'Slå alarmer til';
  const waterMl=supply.state('hose-tank').ml;
  const hoseId=selectedNozzle(),hoseState=flow.state(hoseId);hoseLine.visible=hoseState.flowMlPerSecond>0&&!!hoseState.target;hoseLine.material.color.set(hoseId==='foam'?0xe6ece4:0x8ac7e1);
  if(hoseLine.visible){const tracked=[...xrHoses.values()].find(e=>e.emitterId===hoseId),origin=tracked?tracked.controller.getWorldPosition(new THREE.Vector3()).toArray():[2,.9,1.5];const end=hoseState.target.impactPosition,positions=hoseLine.geometry.attributes.position;positions.setXYZ(0,...origin);positions.setXYZ(1,...end);positions.needsUpdate=true;}
  if(power){const battery=power.state('battery'),load=power.state('pump');
    pumpMesh.material.color.set(load.power>0?0x76c8b3:power.state('fuse').blown?0xc3624b:0x466579);
    $('pump-status').textContent=`Batteri: ${battery.energyWh.toFixed(3)} / ${battery.capacityWh} Wh · pumpe: ${load.power.toFixed(1)} W · ${load.volts.toFixed(1)} V · sikring ${power.state('fuse').blown?'sprunget':'hel'}\nLedningstab: ${power.state('wire').power.toFixed(2)} W · metal ved pumpe: ${heat.state('metal').temperature.toFixed(2)} °C`;
    $('pump-cable').textContent=power.state('wire').resistance>.02?'Skift dårlig ledning':'Lav dårlig ledning';
    $('pump-switch').textContent=power.state('switch').enabled?'Afbryd pumpe':'Tilslut pumpe';$('pump-wire').textContent=power.state('wire').enabled?'Tag ledning ud':'Sæt ledning i';$('pump-fault').textContent=power.state('fault').enabled?'Fjern pumpefejl':'Lav pumpefejl';
  }
  if(sprinklers){for(const h of sprinklers.all())sprinklerVisuals.get(h.id).visible=h.flowMlPerSecond>0;
    const tank=supply.state('sprinkler-tank');$('sprinkler-valve').textContent=sprinklers.state('west').open?'Luk forsyning':'Åbn forsyning';
    $('sprinkler-status').textContent=`Tank: ${tank.ml.toFixed(0)} / ${tank.capacityMl} ml · ${Object.entries(tank.components).filter(([,ml])=>ml>.01).map(([kind,ml])=>`${kind} ${ml.toFixed(0)} ml`).join(', ')||'tom'}\n`+sprinklers.all().map(h=>`${h.id}: ${h.triggered?'udløst':'klar'} · ${h.temperature.toFixed(0)} °C · ${h.flowMlPerSecond.toFixed(0)} ml/s`).join(' | ');
  }
  if(!heat.hasObject(selected))select('chair');
  const all=heat.objects(),alive=new Set(all.map(s=>s.id));
  for(const[id,group]of flames)if(!alive.has(id)){content.remove(group);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});flames.delete(id);}
  for(const s of all){const mesh=objectMeshes.get(s.id);mesh?.position.set(...s.position);if(mesh)mesh.material.color.copy(mesh.userData.baseColor).lerp(foamTint,s.blanket*.7);let flame=flames.get(s.id);if(!flame&&s.burning)flame=fireVisual(s.id);if(flame){flame.position.set(...s.position);flame.visible=s.burning;flame.children.forEach((m,i)=>{m.visible=i<[1,2,3,5][+$('quality').value];m.scale.y=(.7+Math.sin(performance.now()*.007+i)*.2)*clamp(s.intensity/1000,.2,2);});}}
  poolList=pools.visible(128);poolMesh.count=poolList.length;
  poolList.forEach((p,i)=>{dummy.position.set(p.position[0],.008,p.position[2]);dummy.scale.set(p.radius,1,p.radius);dummy.updateMatrix();poolMesh.setMatrixAt(i,dummy.matrix);poolMesh.setColorAt(i,new THREE.Color(p.components.diesel?0xa99149:0x718e9c).lerp(foamTint,p.blanket*.85));});poolMesh.instanceMatrix.needsUpdate=true;if(poolMesh.instanceColor)poolMesh.instanceColor.needsUpdate=true;
  // This lab draws the persistent pool owner. The normal bottle demo keeps the other agent's coloured puddle VFX.
  for(const p of bottles.pour.puddles)p.mesh.visible=false;
  for(const option of [...$('target').querySelectorAll('option[data-pool]')])if(!poolList.some(p=>p.thermalId===option.value))option.remove();
  for(const p of poolList)if(![...$('target').options].some(o=>o.value===p.thermalId)){const o=document.createElement('option');o.value=p.thermalId;o.dataset.pool='1';o.textContent=`${p.components.diesel?'Diesel':'Vand'}pyt · ${p.roomId}`;$('target').append(o);}
  $('target').value=selected;$('show-dormant').disabled=!pools.stats().dormant;$('remove-dormant').disabled=locked||!pools.stats().dormant;
  $('remove-pool').disabled=locked||!selected.startsWith('pool:')||!pools.has(selected.slice(5));
  const s=heat.state(selected),r=heat.roomState(s.roomId??'west');
  $('room-profile').disabled=locked||s.roomId===null;$('room-profile').value=Object.entries(roomProfiles).find(([,p])=>Object.entries(p).every(([key,value])=>r[key]===value))?.[0]??'custom';
  $('readout').textContent=`${selected}: ${s.temperature.toFixed(0)} °C\nAntændelse: ${s.ignition.toFixed(0)} °C\nBrændbarhed: ${s.flammability.toFixed(2)}\nLuftreserve i ${r.id}: ${Math.round(r.oxygen*100)}%\nRøg: ${r.smokeDensity.toFixed(3)} · Sigt: ${Math.round(r.visibility*100)}%\nVand tilbage: ${waterMl.toFixed(0)} ml\nPytter: ${poolList.length} · ${pools.ledger().remainingMl.toFixed(0)} ml\nRøgpartikler: ${smoke.stats().particles}/${smoke.stats().cap}`;
  $('readout').textContent+=`\nVæskeposter: ${pools.stats().records} · hvilende: ${pools.stats().dormant}`;
  $('readout').textContent+=`\nSeneste aktivering: ${interest.stats().activated} · blokeret: ${interest.stats().blocked}`;
  $('readout').textContent+=`\nSlange: ${hoseState.flowMlPerSecond.toFixed(0)} ml/s`;
  $('readout').textContent+=`\nSkum: ${supply.state('foam-tank').ml.toFixed(0)} ml · dækning ${Math.round(s.blanket*100)}%`;
  const report=hazards(),names={'fire':'brand','charge':'aktiv ladning','hot-fuel':'varmt brændstof','dormant-fuel':'varm gemt pyt','heat':'varm luft','smoke':'røg','air':'lav luftreserve'};
  $('room-overview').textContent=report.rooms.map(r=>`${r.id==='west'?'VEST':'ØST'} · ${r.clear?'klar':r.reasons.map(reason=>names[reason]).join(', ')}\n${r.temperature.toFixed(0)} °C · luftreserve ${Math.round(r.oxygen*100)}% · sigt ${Math.round(r.visibility*100)}%`).join('\n\n');
  const mission=missionStatus(report);$('mission').textContent=mission;
  if(worldReadout.mesh.visible)worldReadout.update(`BRANDSTATION${simulationPaused?' · PAUSE':''}\nALARMER · ${alarmText}\nVand ${waterMl.toFixed(0)} ml · skum ${supply.state('foam-tank').ml.toFixed(0)} ml\n${mission}\n\n${$('room-overview').textContent}`);if(blastClock>0){blastClock=Math.max(0,blastClock-dt);blastMesh.visible=true;blastMesh.scale.setScalar((.7-blastClock)*2);blastMesh.material.opacity=blastClock*.5;}else blastMesh.visible=false;
}
const xrControls=new THREE.Group();xrControls.visible=false;scene.add(xrControls);
const worldReadout=createWorldReadout({THREE,parent:xrControls});worldReadout.mesh.position.set(0,2.35,.65);
function xrButton(text,x,y,{actionId=null,nozzleMode=null}={}){const label=textLabel(text,[x,y,1.7]);xrControls.attach(label);label.name=nozzleMode?`xr-nozzle:${nozzleMode}`:`xr-action:${actionId}`;label.userData.text=text;label.userData.actionId=actionId;label.userData.nozzleMode=nozzleMode;label.material.transparent=true;label.material.depthTest=false;label.material.depthWrite=false;label.material.toneMapped=false;label.material.map.colorSpace=THREE.SRGBColorSpace;label.renderOrder=101;return label;}
const buttons=[xrButton('VAND',-1,1.4,{nozzleMode:'hose'}),xrButton('SKUM',0,1.4,{nozzleMode:'foam'}),xrButton('DIESEL',1,1.4,{actionId:'pour'}),xrButton('START',-1,1.12,{actionId:'challenge-start'}),xrButton('PAUSE',0,1.12,{actionId:'pause'}),xrButton('SANDKASSE',1,1.12,{actionId:'challenge-stop'}),xrButton('NIVEAU',-.5,.84,{actionId:'challenge-level'}),xrButton('DÆMP ALARM',.5,.84,{actionId:'alarm-silence'})];
function updateXrLabel(button,text){if(button.userData.text===text)return;const canvas=button.material.map.image,ctx=canvas.getContext('2d');ctx.fillStyle='#203335';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='bold 32px system-ui';ctx.textAlign='center';ctx.fillStyle='#e8ceae';ctx.fillText(text,canvas.width/2,64,canvas.width-24);button.userData.text=text;button.material.map.needsUpdate=true;}
function disposeXrButtons(){for(const button of buttons){button.removeFromParent();button.material.map?.dispose();button.material.dispose();button.geometry.dispose();}}
for(let i=0;i<2;i++){const controller=renderer.xr.getController(i),owner=`xr:${i}`;rig.add(controller);controller.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-5)]),new THREE.LineBasicMaterial({color:0xf1ba79})));controller.addEventListener('selectstart',()=>{if(!heat||!flow||host.get('flow')!==flow)return;controller.updateMatrixWorld(true);const q=controller.getWorldQuaternion(new THREE.Quaternion());ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);ray.ray.direction.set(0,0,-1).applyQuaternion(q);
    xrControls.updateMatrixWorld(true);const button=xrControls.visible?ray.intersectObjects(buttons)[0]?.object:null;
    if(button?.userData.actionId){invokeAction(button.userData.actionId);return;}
    if(!simulationPaused){const id=button?.userData.nozzleMode??selectedNozzle();if(button){if(selectedNozzle()!==id)stopHose();$('hose-kind').value=id;}content.updateMatrixWorld(true);const hit=button?null:ray.intersectObjects([...hoseBlockers,...surfaces,poolMesh],true)[0];if(hit?.object.userData.control){pick();return;}if(!button)xrHoses.set(owner,{controller,emitterId:id});flow.start(id,owner);}});
  for(const name of ['selectend','disconnected'])controller.addEventListener(name,()=>{xrHoses.delete(owner);releaseHose(owner);});
}
document.body.append(VRButton.createButton(renderer));
renderer.xr.addEventListener('sessionstart',()=>{stopHose();rig.position.set(0,0,3);controls.enabled=false;document.querySelector('aside').style.display='none';xrControls.visible=true;worldReadout.setVisible(true);if(heat&&flow&&checkpoint)visuals(0);});
renderer.xr.addEventListener('sessionend',()=>{stopHose();rig.position.set(0,0,0);camera.position.set(4,4.2,6);controls.enabled=true;controls.update();document.querySelector('aside').style.display='';xrControls.visible=false;worldReadout.setVisible(false);});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
const clock=new THREE.Clock();const animate=()=>{const dt=Math.min(clock.getDelta(),.05)*+$('speed').value;if(host&&diesel&&smoke&&checkpoint){if(!simulationPaused){host.update(dt);physics.step(dt);if(pourClock>0){pourClock=Math.max(0,pourClock-dt);if(pourClock===0)physics.hold(diesel.entry,{position:[-1.65,.8,.7],quaternion:[0,0,0,1]});}}visuals(simulationPaused?0:dt);}renderer.render(scene,camera);};renderer.setAnimationLoop(animate);
const pageLifecycle=bindPageLifecycle({releaseInput:stopHose,suspend:()=>renderer.setAnimationLoop(null),resume:()=>renderer.setAnimationLoop(animate),resetClock:()=>clock.getDelta(),keepActiveWhenHidden:()=>renderer.xr.isPresenting,dispose:()=>{token++;window.__fire=null;bridgeOff?.();checkpoint?.dispose();host?.dispose();pump?.dispose();power?.dispose();flow=null;checkpoint=null;electricalHeat?.dispose();electricalHeat=null;worldReadout.dispose();disposeXrButtons();disposeGroup();controls.dispose();renderer.dispose();}});window.__pageLifecycle=pageLifecycle;
for(const name of ['sessionstart','sessionend'])renderer.xr.addEventListener(name,()=>pageLifecycle.refresh());
reset().catch(e=>{console.error(e);toast(e.message);});
