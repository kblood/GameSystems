// Real browser + IWER (emulated Quest 3) check of the pistol on the built demo: it starts in the holster on the right hip,
// the right controller squeezes there and draws it, the laser dot lands on the aimed bottle, the trigger breaks it along
// the barrel, a shot at the wall leaves a hole; let go in front of the chest it drops to the floor (and counts down to its
// return), it can be picked up from the floor, and let go at the hip it is holstered. The 20 s return itself is unit tested
// (tests/pistol.test.js): software rendering is too slow to wait it out here. Not headset acceptance. Needs `npm run build`.
import {closeSmokeResources} from './smoke-cleanup.mjs';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {preview} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url)),contracts=new URL('../../../NightfallContractsWebXR-interaction/package.json',import.meta.url),require=createRequire(contracts);
const puppeteer=require('puppeteer-core'),executablePath=process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!executablePath)throw new Error('Set CHROME_PATH');
const iwer=readFileSync(fileURLToPath(new URL('node_modules/iwer/build/iwer.module.js',contracts)),'utf8');
const output=resolve(root,'test-results/pistol');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5314,strictPort:true}});let browser,page;const checks=[],errors=[],measured={};
const install=`<script type="module">import {XRDevice,metaQuest3} from '/__iwer.js';
const d=new XRDevice(metaQuest3,{stereoEnabled:false});d.installRuntime({forceInstall:true});d.position.set(0,1.62,0);window.__iwer=d;</script>`;
const frames=n=>page.evaluate(n=>new Promise(r=>{const s=window.__demo.renderer.xr.getSession();let k=0;const f=()=>{if(++k>=n)r();else s.requestAnimationFrame(f);};s.requestAnimationFrame(f);}),n);
const press=async button=>{await page.evaluate(b=>window.__iwer.controllers.right.updateButtonValue(b,1),button);await frames(3);await page.evaluate(b=>window.__iwer.controllers.right.updateButtonValue(b,0),button);await frames(3);};
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:960,height:640}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    const url=new URL(request.url());
    if(url.pathname==='/__iwer.js')return request.respond({status:200,contentType:'text/javascript',body:iwer});
    if(url.pathname==='/'||url.pathname==='/index.html'){const html=await (await fetch(url)).text();return request.respond({status:200,contentType:'text/html',body:html.replace('<head>','<head>'+install)});}
    request.continue();
  });
  await page.goto('http://127.0.0.1:5314/?avatar=0&posture=standing',{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__demo?.pistol&&window.__demo.factory.bottles.size>=29,{timeout:240000});
  await page.click('#enter-xr');await page.waitForFunction(()=>window.__demo.renderer.xr.isPresenting,{timeout:30000});await frames(10);

  // Helpers: put the right controller's grip at a world pose (converted into rig-local = IWER space).
  await page.evaluate(()=>{
    const {rig}=window.__demo,T={V:rig.position.constructor,Q:rig.quaternion.constructor,M:rig.matrixWorld.constructor};
    window.__T=T;
    // IWER poses the target ray; the grip space sits at a fixed offset from it (measured below as window.__gripOffset).
    window.__setRight=(pos,quat)=>{rig.updateMatrixWorld(true);const m=rig.matrixWorld.clone().invert().multiply(new T.M().compose(pos,quat,new T.V(1,1,1))).multiply(window.__gripOffset.clone().invert()),p=new T.V(),q=new T.Q();m.decompose(p,q,new T.V());
      window.__iwer.controllers.right.position.copy(p);window.__iwer.controllers.right.quaternion.copy(q);};
    // A grip pose whose barrel line (muzzle 7.4 cm above the fist) passes through `target`, `distance` back towards `from`.
    window.__aimAt=(target,from,distance=0.7)=>{const dir=target.clone().sub(from).normalize(),eye=target.clone().addScaledVector(dir,-distance);
      const q=new T.Q().setFromRotationMatrix(new T.M().lookAt(eye,target,new T.V(0,1,0)));window.__setRight(eye.sub(new T.V(0,.074,0).applyQuaternion(q)),q);};
  });
  const rightIdx=await page.evaluate(()=>window.__demo.interaction.xrControllers.findIndex(c=>c.handedness==='right'));
  await page.evaluate(()=>{window.__iwer.controllers.right.position.set(0,1,-.3);window.__iwer.controllers.right.quaternion.set(0,0,0,1);});await frames(4);
  await page.evaluate(i=>{const T=window.__T,g=window.__demo.interaction.xrControllers[i].grip;g.updateMatrix();
    window.__gripOffset=new T.M().makeTranslation(0,-1,.3).multiply(g.matrix);},rightIdx); // grip in the target-ray frame
  // It starts in the holster on the right hip, below and right of the head.
  const hip=await page.evaluate(()=>{const {pistol,camera}=window.__demo,T=window.__T,e=camera.getWorldPosition(new T.V()),h=pistol.holsterPoint(),local=camera.worldToLocal(h.clone());
    return {state:pistol.state,drop:+(e.y-h.y).toFixed(3),right:+local.x.toFixed(3),inHolster:pistol.gripPoint().distanceTo(h)<1e-4};});measured.hip=hip;
  assert.ok(hip.state==='holstered'&&hip.inHolster&&hip.drop>.5&&hip.right>.15,`hip ${JSON.stringify(hip)}`);checks.push('the pistol starts in a holster on the right hip');
  // Reach down to the holster and squeeze.
  await page.evaluate(()=>{const p=window.__demo.pistol.gripPoint();window.__setRight(p.add(new window.__T.V(0,.04,.03)),new window.__T.Q());});await frames(4);
  await page.evaluate(()=>window.__iwer.controllers.right.updateButtonValue('squeeze',1));await frames(4);
  assert.equal(await page.evaluate(()=>window.__demo.pistol.owner),rightIdx);checks.push('a squeeze at the hip draws it from the holster');
  assert.equal(await page.evaluate(i=>window.__demo.interaction.xrControllers[i].ray.visible,rightIdx),false);checks.push('the pistol hand hides its pointer ray');

  // Aim at a wine bottle on the bar: the laser dot lands on it.
  measured.target=await page.evaluate(()=>{const {factory}=window.__demo,T=window.__T;const b=[...factory.bottles].find(b=>b.id==='bottle_wine'&&!b.broken);window.__target=b;
    const c=new T.V(0,b.height*.45,0).applyMatrix4(b.root.matrixWorld);window.__aimAt(c,c.clone().add(new T.V(-.5,.15,.6)));return {id:b.id,center:c.toArray().map(v=>+v.toFixed(3))};});
  await frames(4);
  const laser=await page.evaluate(()=>{const {scene}=window.__demo,dot=scene.getObjectByName('pistol-laser-dot'),beam=scene.getObjectByName('pistol-laser');
    const b=window.__target,local=b.root.worldToLocal(dot.position.clone());
    return {beam:beam.visible,dot:dot.visible,length:+beam.scale.z.toFixed(3),onBottle:Math.hypot(local.x,local.z)<.08&&local.y>0&&local.y<b.height+.02};});
  measured.laser=laser;
  assert.ok(laser.beam&&laser.dot&&laser.onBottle&&laser.length<1,`laser ${JSON.stringify(laser)}`);checks.push('the laser dot lands on the aimed bottle');
  await page.screenshot({path:resolve(output,'laser.png')});
  await press('trigger');await frames(15);
  const shot=await page.evaluate(()=>({broken:!!window.__target.broken||!window.__demo.factory.bottles.has(window.__target),shots:window.__demo.pistol.shots}));measured.shot=shot;
  assert.ok(shot.shots===1&&shot.broken,`shot ${JSON.stringify(shot)}`);checks.push('the trigger fires along the barrel and breaks the bottle');

  // At the wall left of the bar: a bullet hole.
  await page.evaluate(()=>{const T=window.__T,t=new T.V(1.95,1.55,-.45);window.__aimAt(t,t.clone().add(new T.V(0,0,1)),1.2);});await frames(4);
  await press('trigger');
  const wall=await page.evaluate(()=>({shots:window.__demo.pistol.shots,holes:window.__demo.pistol.holes,hole:window.__demo.scene.getObjectByName('bullet-holes').children.at(-1)?.position.toArray().map(v=>+v.toFixed(3))}));measured.wall=wall;
  assert.ok(wall.shots===2&&wall.holes===1&&Math.abs(wall.hole[2]+.45)<.01,`wall ${JSON.stringify(wall)}`);checks.push('a shot at the wall leaves a bullet hole');

  // In view: held at chest height in front of the headset, aimed at a shelf bottle.
  await page.evaluate(()=>{const {camera}=window.__demo,T=window.__T,eye=camera.getWorldPosition(new T.V()),f=camera.getWorldDirection(new T.V());
    const b=[...window.__demo.factory.bottles].filter(b=>!b.broken).sort((a,c)=>a.root.getWorldPosition(new T.V()).distanceTo(eye.clone().addScaledVector(f,2))-c.root.getWorldPosition(new T.V()).distanceTo(eye.clone().addScaledVector(f,2)))[0];
    const t=new T.V(0,b.height*.5,0).applyMatrix4(b.root.matrixWorld),from=eye.clone().add(new T.V(.18,-.3,-.35));window.__aimAt(t,from,t.distanceTo(from));});
  await frames(6);await page.screenshot({path:resolve(output,'held.png')});
  // Let go in front of the chest: it drops to the floor and counts down to its return.
  await page.evaluate(()=>window.__iwer.controllers.right.updateButtonValue('squeeze',0));await frames(3);
  const dropped=await page.evaluate(()=>({state:window.__demo.pistol.state,beam:window.__demo.scene.getObjectByName('pistol-laser').visible}));
  assert.deepEqual(dropped,{state:'falling',beam:false});checks.push('let go away from the hip, it drops (laser off)');
  await page.waitForFunction(()=>window.__demo.pistol.state==='dropped',{timeout:60000});
  const lying=await page.evaluate(()=>({y:+window.__demo.pistol.gripPoint().y.toFixed(3),returnIn:+window.__demo.pistol.returnIn.toFixed(2)}));measured.lying=lying;
  assert.ok(lying.y<.05&&lying.returnIn>0&&lying.returnIn<20,`lying ${JSON.stringify(lying)}`);checks.push('it lands on the floor and counts down to the holster');
  await page.evaluate(()=>window.__iwer.quaternion.set(-.53,-.2,-.13,.81));await frames(6); // look down and right: holster + floor
  await page.screenshot({path:resolve(output,'dropped.png')});
  await page.evaluate(()=>window.__iwer.quaternion.set(0,0,0,1));await frames(6);
  // Pick it up from the floor, then let go at the hip.
  await page.evaluate(()=>{const p=window.__demo.pistol.gripPoint();window.__setRight(p.add(new window.__T.V(0,.06,0)),new window.__T.Q());});await frames(4);
  await page.evaluate(()=>window.__iwer.controllers.right.updateButtonValue('squeeze',1));await frames(4);
  assert.equal(await page.evaluate(()=>window.__demo.pistol.owner),rightIdx);checks.push('a dropped pistol can be picked up from the floor');
  await page.evaluate(()=>{const p=window.__demo.pistol.holsterPoint();window.__setRight(p.add(new window.__T.V(0,.08,0)),new window.__T.Q());});await frames(4);
  await page.evaluate(()=>window.__iwer.controllers.right.updateButtonValue('squeeze',0));await frames(4);
  const back=await page.evaluate(()=>({state:window.__demo.pistol.state,inHolster:window.__demo.pistol.gripPoint().distanceTo(window.__demo.pistol.holsterPoint())<1e-3,beam:window.__demo.scene.getObjectByName('pistol-laser').visible}));
  assert.deepEqual(back,{state:'holstered',inHolster:true,beam:false});checks.push('let go at the hip, it is holstered');

  assert.deepEqual(errors,[]);checks.push('no browser errors');
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,measured,errors,headsetTested:false},null,2));
  console.log(JSON.stringify({passed:true,checks,measured},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,measured,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server});}
