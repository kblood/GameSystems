import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createVehicleSystem, createVehiclePhysicsAdapter, createFuelStore, createBatteryStore, VEHICLE_PARTS } from './vendor/extensions/vehicle/index.js';
import { bindVehicleVisual } from './vendor/extensions/vehicle/visuals.js';
import { createSupplySystem, createFuelAdapter } from './vendor/extensions/supply/index.js';
import { createEnergyStore } from './vendor/extensions/electricity/storage.js';
import {createCheckpointSystem} from './vendor/extensions/checkpoint/index.js';
import {createVehicleSceneProvider} from './vendor/extensions/checkpoint/vehicle-scene.js';
import {createVehicleFuelPort} from './vendor/extensions/vehicle/fuel-port.js';
import {createFlowSystem} from './vendor/extensions/flow/index.js';
import {createThermalSystem} from './vendor/extensions/thermal/index.js';
import {createPoolsSystem} from './vendor/extensions/pools/index.js';
import {bindPageLifecycle} from './page-lifecycle.js';

const $ = id => document.getElementById(id), message = text => { $('message').textContent = text; };
const scene = new THREE.Scene(); scene.background = new THREE.Color('#243039');
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture; room.dispose(); pmrem.dispose();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .05, 150); camera.position.set(5.2, 3.1, 5.9);
const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(-.45, .7, 0); orbit.enableDamping = true; orbit.minDistance = 1.1; orbit.maxDistance = 13;
const sun = new THREE.DirectionalLight(0xe5f5ff, 4); sun.position.set(2, 7, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .1, far: 18 }); sun.shadow.bias = -.0005; scene.add(sun);
const fill = new THREE.DirectionalLight(0xffd3a3, 2); fill.position.set(-4, 3, -3); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#35424a', roughness: .85 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -.013; ground.receiveShadow = true; scene.add(ground);
const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, .06, 96), new THREE.MeshStandardMaterial({ color: '#1b252b', metalness: .35, roughness: .35 })); platform.position.y = -.035; platform.receiveShadow = true; scene.add(platform);
const collisionWall = new THREE.Mesh(new THREE.BoxGeometry(8,1.5,.3), new THREE.MeshStandardMaterial({color:'#b66a38',roughness:.75})); collisionWall.position.set(0,.75,8); collisionWall.castShadow=true;collisionWall.receiveShadow=true;collisionWall.userData.vehicleCollider=true;scene.add(collisionWall);
const speedBump = new THREE.Mesh(new THREE.BoxGeometry(8,.28,5), new THREE.MeshStandardMaterial({color:'#d39a36',roughness:.75})); speedBump.position.set(0,.14,5.5); speedBump.receiveShadow=true; scene.add(speedBump);
const wheelRay = new THREE.Raycaster(), terrainMeshes=[ground,platform,speedBump], collisionMeshes=[collisionWall];
function chassisBounds(pose, half) {
  const c=Math.cos(pose.heading),s=Math.sin(pose.heading),hx=Math.abs(c)*half[0]+Math.abs(s)*half[2],hz=Math.abs(s)*half[0]+Math.abs(c)*half[2];
  return new THREE.Box3(new THREE.Vector3(pose.position[0]-hx,pose.position[1]-half[1],pose.position[2]-hz),new THREE.Vector3(pose.position[0]+hx,pose.position[1]+half[1],pose.position[2]+hz));
}
function sweepChassis({from,to,halfExtentsM}) {
  if(!collisionMeshes.length)return null;
  const solids=collisionMeshes.map(mesh=>{mesh.updateWorldMatrix(true,false);return {mesh,box:new THREE.Box3().setFromObject(mesh)}});
  const distance=Math.hypot(to.position[0]-from.position[0],to.position[1]-from.position[1],to.position[2]-from.position[2]);
  const steps=Math.max(1,Math.min(512,Math.ceil((distance+Math.abs(to.heading-from.heading)*2.6)/.15)));
  const poseAt=t=>({position:from.position.map((v,i)=>v+(to.position[i]-v)*t),heading:from.heading+(to.heading-from.heading)*t});
  const collisionAt=t=>{const bounds=chassisBounds(poseAt(t),halfExtentsM);return solids.find(solid=>bounds.intersectsBox(solid.box))??null;};
  let low=0,high=0,solid=null;
  for(let i=1;i<=steps;i++){const t=i/steps,hit=collisionAt(t);if(hit){low=(i-1)/steps;high=t;solid=hit;break;}}
  if(!solid)return null;
  for(let i=0;i<14;i++){const mid=(low+high)*.5;if(collisionAt(mid))high=mid;else low=mid;}
  const body=chassisBounds(poseAt(high),halfExtentsM),other=solid.box;
  const overlaps=[Math.min(body.max.x,other.max.x)-Math.max(body.min.x,other.min.x),Math.min(body.max.y,other.max.y)-Math.max(body.min.y,other.min.y),Math.min(body.max.z,other.max.z)-Math.max(body.min.z,other.min.z)];
  const axis=overlaps.indexOf(Math.min(...overlaps)),normal=[0,0,0],bodyCenter=body.getCenter(new THREE.Vector3()),otherCenter=other.getCenter(new THREE.Vector3());
  normal[axis]=Math.sign([bodyCenter.x-otherCenter.x,bodyCenter.y-otherCenter.y,bodyCenter.z-otherCenter.z][axis])||-1;
  return {fraction:high,normal};
}
const vehiclePhysics=createVehiclePhysicsAdapter({sweepChassis,raycastWheel:({origin,maxDistanceM})=>{wheelRay.set(new THREE.Vector3(...origin),new THREE.Vector3(0,-1,0));wheelRay.near=0;wheelRay.far=maxDistanceM;const hit=wheelRay.intersectObjects(terrainMeshes,false)[0];return hit?{distanceM:hit.distance}:null;}});

const supply = createSupplySystem(); supply.add('aster-fuel', { capacityMl: 52000, components: { petrol: 28000 } });
const shared = { fuel: createFuelAdapter(supply, 'aster-fuel', { kind: 'petrol' }), power: createEnergyStore({ capacityWh: 720, energyWh: 540, voltage: 12.6 }) };
const standalone = { fuel: createFuelStore(), power: createBatteryStore() };
const api = createVehicleSystem({ emit: (event, data) => { if (event === 'vehicle:stopped') message(`Engine stopped: ${data.reason}`); } });
api.registerAdapters('shared',shared);api.registerAdapters('standalone',standalone);api.add('aster',{adapterKey:'shared'});
let root, binding, ready = false, clock = new THREE.Clock(), lastReadout = 0,paused=false,leakEnabled=false,brakeTimer=null,saved=null,importToken=0,disposed=false,lastPhysics=null;
let pools;const thermal=createThermalSystem({emit:(name,r)=>{if(name==='thermal:burned')pools?.burned(r.id,r.joules);}});pools=createPoolsSystem({thermal,maxPools:16});
const fuelPort=createVehicleFuelPort(api,'aster'),fuelFlow=createFlowSystem({supply:fuelPort,resolveTarget:()=>{if(!ready||!root)return null;root.updateMatrixWorld(true);const p=root.getObjectByName('FuelFlap').getWorldPosition(new THREE.Vector3());return {surfaceId:'vehicle-floor',position:[p.x,.015,p.z]};},emit:(name,r)=>{if(name==='liquid:deposit')pools.deposit(r);}});
fuelFlow.add('fuel-leak',{tankId:'aster',sourceKey:'vehicle:aster:fuel',rateMlPerSecond:20});
const poolVisual=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,.005,32),new THREE.MeshStandardMaterial({color:0xe0a55e,transparent:true,opacity:.75,roughness:.25}),16);poolVisual.count=0;poolVisual.frustumCulled=false;scene.add(poolVisual);
const flameVisual=new THREE.InstancedMesh(new THREE.ConeGeometry(.055,.35,8),new THREE.MeshBasicMaterial({color:0xffa54c}),48);flameVisual.count=0;flameVisual.frustumCulled=false;scene.add(flameVisual);const spillDummy=new THREE.Object3D();
const checkpoint=createCheckpointSystem({sceneId:'aster-sedan-v1'}),SAVE_KEY='gamesystems.aster.v1';
checkpoint.register('scene',createVehicleSceneProvider({vehicles:api,supply,sharedPower:shared.power,standaloneFuel:standalone.fuel,standalonePower:standalone.power,tankId:'aster-fuel',thermal,pools,fuelFlow,application:{
  capture(){return {paused,leakEnabled,adapters:$('adapters').value,quality:$('quality').value};},
  prepareRestore(d,{vehiclePlan}){if(typeof d.paused!=='boolean'||typeof d.leakEnabled!=='boolean'||!['shared','standalone','disabled'].includes(d.adapters)||!['high','low'].includes(d.quality))throw new Error('Invalid vehicle UI state');const s=vehiclePlan.state('aster');
    if(d.adapters==='disabled'?(s.modes.fuel!=='disabled'||s.modes.power!=='disabled'):(s.adapterKey!==d.adapters||s.modes.fuel!=='adapter'||s.modes.power!=='adapter'))throw new Error('Adapter selector disagrees with vehicle binding');
    return {commit(){clearTimeout(brakeTimer);brakeTimer=null;paused=d.paused;leakEnabled=d.leakEnabled;if(leakEnabled)fuelFlow.start('fuel-leak','valve');else fuelFlow.stopAll();$('adapters').value=d.adapters;$('throttle').value=0;$('steer').value=0;},notify(){if($('quality').value!==d.quality){$('quality').value=d.quality;loadAsset(d.quality);}vehiclePhysics.reset();const restored=api.state('aster');lastPhysics=vehiclePhysics.resolve(restored,restored,1/60);binding?.update(restored,{moveRoot:true,suspension:lastPhysics.suspension});$('pause').textContent=paused?'Resume':'Pause';}};
  },
}}));
const partLabels = { door_fl: 'Front left door', door_fr: 'Front right door', door_rl: 'Rear left door', door_rr: 'Rear right door', hood: 'Hood', trunk: 'Trunk', fuel_flap: 'Fuel flap' };
function toggle(part) { const s = api.state('aster'); const accepted = api.setPart('aster', part, s.parts[part].target > .5 ? 0 : 1); if (!accepted) message(s.parts[part].locked?'Panel locked. Unlock before moving it.':'Stop the wheels before opening panels.'); }
for (const [part, label] of Object.entries(partLabels)) { const button = document.createElement('button'); button.textContent = label; button.dataset.part = part; button.onclick = () => toggle(part); $('parts').appendChild(button); }
$('open-all').onclick = () => { let blocked=false;for (const part of Object.keys(VEHICLE_PARTS)) if(!api.setPart('aster', part, 1))blocked=true;message(blocked?'Unlock panels and stop the wheels before opening.':'Opening panels.'); };
$('close-all').onclick = () => { let blocked=false;for (const part of Object.keys(VEHICLE_PARTS)) if(!api.setPart('aster', part, 0))blocked=true;message(blocked?'Locked panels keep their current position.':'Closing panels.'); };
$('lock-panels').onclick=()=>{const lock=!Object.values(api.state('aster').parts).every(p=>p.locked);for(const name of Object.keys(VEHICLE_PARTS))api.setLocked('aster',name,lock);$('lock-panels').textContent=lock?'Unlock panels':'Lock panels';};
$('ignition').onclick = () => { if (api.state('aster').running) api.stop('aster'); else { const result = api.start('aster'); message(result.started ? 'Engine running. Release the parking brake and apply throttle.' : `Start blocked: ${result.reason}`); } };
$('lights').onclick = () => api.setLights('aster', !api.state('aster').lights);
for (const control of ['throttle', 'steer']) $(control).oninput = () => api.setControls('aster', { [control]: Number($(control).value) });
$('drive').onclick = () => api.setControls('aster', { handbrake: !api.state('aster').controls.handbrake });
$('gear').onclick=()=>{const gear=api.state('aster').controls.gear===1?-1:1;api.setControls('aster',{gear});$('gear').textContent=gear===1?'Gear: drive':'Gear: reverse';};
$('brake').onclick = () => { api.setControls('aster', { throttle: 0, brake: 1, handbrake: true }); $('throttle').value = 0; clearTimeout(brakeTimer);brakeTimer=setTimeout(() => api.setControls('aster', { brake: 0 }), 800); };
$('refuel').onclick = () => { const accepted = api.refuel('aster', 5); message(accepted ? `Added ${accepted.toFixed(2)} L petrol.` : 'Stop the engine and wheels, then open the fuel flap.'); };
$('charge').onclick = () => message(`Battery accepted ${api.charge('aster', 100).toFixed(1)} Wh.`);
$('spill').onclick=()=>message(`Spilled ${fuelFlow.pulse('fuel-leak',100).ml.toFixed(0)} ml from connected fuel source.`);
$('leak').onclick=()=>{leakEnabled=!leakEnabled;if(leakEnabled)fuelFlow.start('fuel-leak','valve');else fuelFlow.stopAll();};
$('ignite-spill').onclick=()=>{const p=pools.visible(1)[0];if(p)message(pools.ignite(p.id)?'Spilled fuel ignited.':'Pool cannot ignite now.');};
$('collect-spill').onclick=()=>{for(const p of pools.all())pools.remove(p.id);message('Spilled fuel collected.');};
$('adapters').onchange = () => {
  const mode = $('adapters').value;
  if (mode !== 'disabled') api.bindAdapters('aster',mode);
  api.setModes('aster', { fuel: mode === 'disabled' ? 'disabled' : 'adapter', power: mode === 'disabled' ? 'disabled' : 'adapter' });
  message(mode === 'disabled' ? 'Fuel and battery consumption disabled.' : `${mode === 'shared' ? 'Shared systems' : 'Standalone stores'} connected; each source retains its own reserves.`);
};
$('pause').onclick=()=>{paused=!paused;api.setControls('aster',{throttle:0,brake:0,steer:0});$('throttle').value=0;$('steer').value=0;$('pause').textContent=paused?'Resume':'Pause';};
$('save').onclick=()=>{try{saved=checkpoint.capture();localStorage.setItem(SAVE_KEY,checkpoint.encode(saved));message('Vehicle and all reserves saved.');}catch(e){message(`Save failed: ${e.message}`);}};
function restore(data){importToken++;checkpoint.restore(data);message('Vehicle restored; driver controls neutral.');}
$('restore').onclick=()=>{try{if(saved)restore(saved);else message('No checkpoint saved.');}catch(e){message(`Restore rejected: ${e.message}`);}};
$('export').onclick=()=>{const data=checkpoint.capture(),url=URL.createObjectURL(new Blob([checkpoint.encode(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='aster-checkpoint.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onclick=()=>$('checkpoint-file').click();
$('checkpoint-file').onchange=async event=>{const file=event.target.files?.[0],generation=++importToken;if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Checkpoint too large');const text=await file.text();if(generation!==importToken||disposed)return;const data=checkpoint.decode(text);restore(data);saved=data;localStorage.setItem(SAVE_KEY,checkpoint.encode(data));}catch(e){message(`Import rejected: ${e.message}`);}finally{event.target.value='';}};
try{const text=localStorage.getItem(SAVE_KEY);if(text)saved=checkpoint.decode(text);}catch{message('Stored checkpoint cannot be read.');}

const loader = new GLTFLoader();
let assetRequest = 0, renderQuality = 'high';
function disposeRoot(old) {
  const materials = new Set(); old.traverse(o => { o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
  for (const m of materials) m.dispose();
}
function loadAsset(quality) {
  const request = ++assetRequest; ready = false;
  loader.load(`./assets/export/vehicles/aster_sedan${quality === 'low' ? '_low' : ''}.glb`, gltf => {
    if (request !== assetRequest) { disposeRoot(gltf.scene); return; }
    binding?.dispose(); if (root) { scene.remove(root); disposeRoot(root); }
    root = gltf.scene; renderQuality = quality; renderer.shadowMap.enabled = quality === 'high';
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !o.material?.transmission; o.receiveShadow = true;
      if (quality === 'low' && o.material?.transmission) { o.material.transmission = 0; o.material.transparent = true; o.material.opacity = .22; o.material.depthWrite = false; o.material.metalness = 0; o.material.needsUpdate = true; }
    });
    scene.add(root); binding = bindVehicleVisual(root, { THREE }); ready = true; message('Aster ready. Drive toward the orange barrier to test chassis collision and suspension.');
  }, undefined, error => { console.error(error); message('Model load failed. Rebuild scripts/car_aster.py and run npm run sync.'); });
}
loadAsset('high'); $('quality').onchange = () => loadAsset($('quality').value);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
renderer.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', event => {
  if (!root || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
  pointer.set(event.clientX / innerWidth * 2 - 1, -event.clientY / innerHeight * 2 + 1); raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(root, true)[0];
  for (let o = hit?.object; o; o = o.parent) { const part = Object.entries(VEHICLE_PARTS).find(([, p]) => p.node === o.name); if (part) { toggle(part[0]); break; } }
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const animate=() => {
  const dt = Math.min(clock.getDelta(), .1); if(!paused){const before=api.state('aster');api.step(dt);fuelFlow.step(dt);thermal.step(dt);const desired=api.state('aster');lastPhysics=vehiclePhysics.resolve(before,desired,dt);const accepted=api.applyMotionResolution('aster',before,lastPhysics);if(accepted.collided){$('throttle').value='0';$('steer').value='0';message('Chassis contact. Motion stopped at the barrier; reset throttle to drive again.');}} const s = api.state('aster'); binding?.update(s,{moveRoot:true,suspension:lastPhysics?.suspension??null});
  if(root){const target=root.position.clone().add(new THREE.Vector3(0,.7,0)),delta=target.sub(orbit.target);orbit.target.add(delta);camera.position.add(delta);}orbit.update();
  const visible=pools.visible(16);poolVisual.count=visible.length;let flameCount=0;
  visible.forEach((p,i)=>{spillDummy.position.set(p.position[0],.006,p.position[2]);spillDummy.scale.set(p.radius,1,p.radius);spillDummy.updateMatrix();poolVisual.setMatrixAt(i,spillDummy.matrix);if(p.burning)for(let j=0;j<3;j++){spillDummy.position.set(p.position[0]+Math.sin(j*2.1)*.06,.18,p.position[2]+Math.cos(j*2.1)*.06);spillDummy.scale.set(1,1,1);spillDummy.updateMatrix();flameVisual.setMatrixAt(flameCount++,spillDummy.matrix);}});
  poolVisual.instanceMatrix.needsUpdate=true;flameVisual.count=flameCount;flameVisual.instanceMatrix.needsUpdate=true;renderer.render(scene,camera);
  lastReadout += dt; if (lastReadout > .15) {
    lastReadout = 0; $('ignition').textContent = s.running ? 'Stop engine' : 'Start engine'; $('drive').textContent = `Parking brake: ${s.controls.handbrake ? 'on' : 'off'}`;$('gear').textContent=s.controls.gear===1?'Gear: drive':'Gear: reverse';
    $('lock-panels').textContent=Object.values(s.parts).every(p=>p.locked)?'Unlock panels':'Lock panels';
    $('leak').textContent=leakEnabled?'Stop leak':'Start leak';
    $('readout').textContent = `ENGINE    ${s.running ? `${Math.round(s.rpm)} rpm` : 'off'}\nSPEED     ${(Math.abs(s.speed) * 3.6).toFixed(1)} km/h\nFUEL      ${s.fuel.amountL.toFixed(3)} / ${s.fuel.capacityL} L\nBATTERY   ${s.power.energyWh.toFixed(2)} / ${s.power.capacityWh} Wh\nLIGHTS    ${s.lights && s.electrics ? 'on' : 'off'}\nDRAW CALLS ${renderer.info.render.calls}`;
    $('readout').textContent+=`\nSPILLED   ${(s.spilledL*1000).toFixed(0)} ml\nPOOLS     ${pools.ledger().remainingMl.toFixed(0)} ml · burned ${pools.ledger().burnedMl.toFixed(0)} ml\nSUSPENSION ${lastPhysics?.suspension.groundedWheels??0}/4 wheels`;
  }
};renderer.setAnimationLoop(animate);
// Local QA hook; gameplay and smoke tests use the same public APIs as a host.
window.__vehicleLab = { get ready() { return ready; }, get quality() { return renderQuality; },get paused(){return paused;},get lastPhysics(){return lastPhysics;},api,physics:vehiclePhysics,checkpoint,supply,shared,standalone,thermal,pools,fuelFlow,fuelPort,speedBump,get root() { return root; },renderer,camera,scene };
window.__pageLifecycle=bindPageLifecycle({suspend:()=>renderer.setAnimationLoop(null),resetClock:()=>clock.getDelta(),releaseInput:()=>{clearTimeout(brakeTimer);brakeTimer=null;api.setControls('aster',{throttle:0,brake:0,steer:0});$('throttle').value=0;$('steer').value=0;fuelFlow.stopAll();},resume:()=>{if(leakEnabled)fuelFlow.start('fuel-leak','valve');renderer.setAnimationLoop(animate);},dispose:()=>{disposed=true;importToken++;assetRequest++;ready=false;checkpoint.dispose();fuelFlow.dispose();pools.dispose();thermal.dispose();api.dispose();supply.dispose();shared.power.dispose();binding?.dispose();orbit.dispose();environment.dispose();renderer.dispose();}});
