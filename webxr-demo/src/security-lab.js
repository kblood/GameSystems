import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHost } from './vendor/extensions/host/index.js';
import camerasExtension from './vendor/extensions/cameras/index.js';
import checkpointExtension from './vendor/extensions/checkpoint/index.js';
import { createElectricitySystem } from './vendor/extensions/electricity/index.js';
import {bindPageLifecycle} from './page-lifecycle.js';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x182832);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, .05, 60); camera.position.set(8, 6, 9);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.update();
scene.add(new THREE.HemisphereLight(0xe4effa, 0x47555c, 3)); const sun = new THREE.DirectionalLight(0xffe5ba, 3); sun.position.set(2, 6, 4); scene.add(sun);
function cube(size, position, color) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .65 })); mesh.position.set(...position); scene.add(mesh); return mesh; }
cube([7, .1, 5], [0, -.05, 0], 0x5a6870); cube([7, 2.7, .12], [0, 1.35, -2.5], 0x3c555e);
cube([2, .8, 1], [-1.6, .4, -.4], 0x9b704b); cube([.65, .5, .65], [-1.6, 1.05, -.4], 0xcfb35b);
for(let i = 0; i < 3; i++) cube([1.4, .6, .8], [1.8, .3 + i * .62, -1], [0x649da1, 0x7b8ca7, 0xac805f][i]);
const moving = cube([.4, .6, .4], [-.5, .3, 1], 0xd4a55e);
cube([2.5, 1.7, .16], [2.2, 1.7, 2.4], 0x10171e);
const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.294), new THREE.MeshBasicMaterial({ color: 0x080d12 })); screenMesh.position.set(2.2, 1.8, 2.495); scene.add(screenMesh);
const cabinet=cube([.9,1.4,.32],[-2.8,.7,1.45],0x60717b);
const doorPivot=new THREE.Group();doorPivot.position.set(-3.25,.7,1.63);scene.add(doorPivot);
const cabinetDoor=new THREE.Mesh(new THREE.BoxGeometry(.9,1.4,.04),new THREE.MeshStandardMaterial({color:0x8298a3,metalness:.6,roughness:.5}));cabinetDoor.position.set(.45,0,0);doorPivot.add(cabinetDoor);doorPivot.rotation.y=-1.5;
cube([.65,.36,.22],[-2.8,.28,1.65],0x25333a);
const fuseVisual=cube([.12,.22,.08],[-2.65,.85,1.64],0x78bc86),switchVisual=cube([.14,.22,.08],[-2.98,.85,1.64],0x78bc86);
function cable(points,color){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const m=new THREE.Mesh(new THREE.TubeGeometry(curve,30,.016,6,false),new THREE.MeshStandardMaterial({color}));scene.add(m);return m;}
const feedCable=cable([[-2.6,.7,1.64],[-2.5,.05,1.7],[1.8,.04,2.3],[2.2,.9,2.42]],0xb06142);
cable([[-2.9,.4,1.64],[-3,.035,1.8],[1.9,.03,2.1],[2.3,.8,2.42]],0x253c50);
const host = createHost({ THREE, scene, renderer, camera, quality: 2 });
const cameras = await host.load(camerasExtension); if (!cameras) throw new Error('Cameras extension failed');
for(const [id, position, target] of [['west', [-3, 2.3, 1.8], [-1.3, .7, -.4]], ['east', [3.2, 2.3, .5], [1.6, 1, -1]], ['overhead', [0, 6, .1], [0, 0, 0]]]) {
  const feed = new THREE.PerspectiveCamera(60, 16 / 9, .05, 30); feed.name=`security:${id}`;feed.position.set(...position); feed.lookAt(...target); scene.add(feed); cameras.addFeed(id, { camera: feed });
  cube([.13, .09, .2], position, 0x15222b);
}
cameras.addScreen('main', { mesh: screenMesh, feedId: 'west' });
const network=createElectricitySystem();
network.add('battery',{kind:'battery',a:'positive',b:'ground',capacityWh:2,energyWh:2,voltage:12,resistance:.08});
network.add('switch',{kind:'switch',a:'positive',b:'switched',resistance:.04});
network.add('wire',{kind:'wire',a:'switched',b:'fused',resistance:.04});
network.add('fuse',{kind:'fuse',a:'fused',b:'bus',resistance:.02,rating:5});
network.add('display',{a:'bus',b:'ground',resistance:6});network.add('camera',{a:'bus',b:'ground',resistance:12});
network.add('short',{a:'bus',b:'ground',resistance:.1,enabled:false});network.evaluate();
const battery=network.batteryAdapter('battery');battery.capture=()=>network.state('battery');
const checkpoint = await host.load(checkpointExtension, { sceneId: 'security-station-v2' }); checkpoint.register('cameras', cameras); checkpoint.register('electricity', network);
let paused = false, clock = 0, saved = null;
checkpoint.register('application', { capture() { return { clock, paused, speed: +$('speed').value }; }, prepareRestore(data) {
  if (!Number.isFinite(data.clock) || data.clock < 0 || typeof data.paused !== 'boolean' || ![1, 20].includes(data.speed)) throw new Error('Invalid surveillance application state');
  return { commit() { clock = data.clock; paused = data.paused; $('speed').value = data.speed; }, notify: updateStatus };
} });
function updateStatus() {
  const screen = cameras.screenState('main'), feed = cameras.feedState(screen.feedId), energy = battery.state(), stats = cameras.stats();
  const powered=network.state('display').volts>=6&&energy.energyWh>0;
  screenMesh.visible = powered; moving.position.x = Math.sin(clock) * .6;
  feedCable.material.color.set(network.state('wire').enabled?0xb06142:0x404850);
  fuseVisual.material.color.set(network.state('fuse').blown?0xc24e3c:0x78bc86);switchVisual.material.color.set(network.state('switch').enabled?0x78bc86:0x404850);
  $('feed').value = screen.feedId; $('screen').textContent = screen.enabled ? 'Sluk skærm' : 'Tænd skærm'; $('camera').textContent = feed.enabled ? 'Sluk kamera' : 'Tænd kamera'; $('pause').textContent = paused ? 'Fortsæt' : 'Pause';
  $('status').textContent = `Feed: ${screen.feedId}\n${feed.width} × ${feed.height} · højst ${stats.fps} billeder/s\nBatteri: ${energy.energyWh.toFixed(3)} / ${energy.capacityWh} Wh\nRendret: ${stats.frames} feed-billeder${energy.energyWh <= 0 ? '\nBatteriet er tomt. Oplad for at fortsætte.' : ''}`;
  $('power-status').textContent=`Bus: ${network.state('display').volts.toFixed(2)} V · sikring: ${network.state('fuse').blown?'sprunget':'hel'}\nSkærm: ${network.state('display').power.toFixed(1)} W · kamera: ${network.state('camera').power.toFixed(1)} W`;
  $('main-switch').textContent=network.state('switch').enabled?'Afbryd strøm':'Tilslut strøm';$('wire').textContent=network.state('wire').enabled?'Tag ledning ud':'Sæt ledning i';$('short').textContent=network.state('short').enabled?'Fjern fejl':'Lav kortslutning';
}
function syncLoads(){const s=cameras.screenState('main');network.setEnabled('display',s.enabled);network.setEnabled('camera',cameras.feedState(s.feedId).enabled);network.evaluate();}
$('feed').onchange = () => {cameras.switchFeed('main', $('feed').value);syncLoads();};
$('screen').onclick = () => {cameras.setScreenEnabled('main', !cameras.screenState('main').enabled);syncLoads();};
$('camera').onclick = () => { const id = cameras.screenState('main').feedId; cameras.setFeedEnabled(id, !cameras.feedState(id).enabled);syncLoads(); };
$('quality').onchange = () => host.setQuality(+$('quality').value);
$('charge').onclick = () => {battery.charge(2);network.evaluate();};
$('main-switch').onclick=()=>{network.setEnabled('switch',!network.state('switch').enabled);network.evaluate();};
$('wire').onclick=()=>{network.setEnabled('wire',!network.state('wire').enabled);network.evaluate();};
$('short').onclick=()=>{network.setEnabled('short',!network.state('short').enabled);network.evaluate();};
$('fuse').onclick=()=>{network.replaceFuse('fuse');network.evaluate();};
$('cabinet').onclick=()=>{doorPivot.rotation.y=doorPivot.rotation.y===0?-1.5:0;};
$('pause').onclick = () => { paused = !paused; };
$('save').onclick = () => { saved = checkpoint.capture(); };
$('restore').onclick = () => { if (saved) checkpoint.restore(saved); };
const timer = new THREE.Clock(); const animate=() => {
  const dt = Math.min(timer.getDelta(), .05);
  if (!paused) {
    const simDt = dt * +$('speed').value, display = cameras.screenState('main'); clock += simDt;
    network.setEnabled('display',display.enabled);network.setEnabled('camera',cameras.feedState(display.feedId).enabled);network.step(simDt);
  }
  updateStatus();host.update(dt);renderer.render(scene, camera);
};renderer.setAnimationLoop(animate);
window.__security = { host, cameras, battery, network, checkpoint, scene, renderer, camera, screenMesh, state: () => ({ cameras: cameras.capture(), battery: battery.capture(), electricity:network.capture(), paused }) };
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
window.__pageLifecycle=bindPageLifecycle({suspend:()=>renderer.setAnimationLoop(null),resume:()=>renderer.setAnimationLoop(animate),resetClock:()=>timer.getDelta(),dispose:()=>{host.dispose();network.dispose();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.dispose();});renderer.dispose();}});
