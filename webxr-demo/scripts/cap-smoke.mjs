// Real browser + IWER (emulated Quest 3) check of the two-hand cap removal on the built demo: the right controller grabs
// a capped bottle, the left squeezes at the cap, twists it loose and pulls; the bottle opens and the cap meshes hide.
// Squeezing at the mouth again puts the cap back. Not headset acceptance. Needs `npm run build` first.
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
const output=resolve(root,'test-results/cap');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5312,strictPort:true}});let browser,page;const checks=[],errors=[],measured={};
const install=`<script type="module">import {XRDevice,metaQuest3} from '/__iwer.js';
const d=new XRDevice(metaQuest3,{stereoEnabled:false});d.installRuntime({forceInstall:true});d.position.set(0,1.62,0);window.__iwer=d;</script>`;
const frames=n=>page.evaluate(n=>new Promise(r=>{const s=window.__demo.renderer.xr.getSession();let k=0;const f=()=>{if(++k>=n)r();else s.requestAnimationFrame(f);};s.requestAnimationFrame(f);}),n);
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
  await page.goto('http://127.0.0.1:5312/?avatar=0&posture=standing',{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__demo?.interaction&&window.__demo.factory.bottles.size>0,{timeout:180000});
  await page.click('#enter-xr');await page.waitForFunction(()=>window.__demo.renderer.xr.isPresenting,{timeout:30000});await frames(10);

  // Right controller 15 cm in front of a capped bottle, pointing at it (rig-local = IWER space).
  const picked=await page.evaluate(async()=>{
    const {interaction,factory,rig}=window.__demo;const THREE={Vector3:rig.position.constructor,Quaternion:rig.quaternion.constructor,Matrix4:rig.matrixWorld.constructor};
    const b=[...factory.bottles].find(b=>!b.open&&!b.broken&&interaction._capOf(b));if(!b)return null;window.__capBottle=b;
    const target=new THREE.Vector3(0,b.height*.45,0).applyMatrix4(b.root.matrixWorld);rig.updateMatrixWorld(true);const local=rig.worldToLocal(target.clone());
    window.__iwer.controllers.right.position.set(local.x,local.y,local.z+.15);window.__iwer.controllers.right.quaternion.set(0,0,0,1);
    window.__setCapHand=(twist,lift)=>{ // left grip at an eccentric cap grip, turned `twist` about the neck and lifted `lift`
      const cap=interaction._capOf(b).center,q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),twist);
      const pos=new THREE.Vector3(.03,.01,0).applyQuaternion(q).add(new THREE.Vector3(cap[0],cap[1]+lift,cap[2]));
      const world=interaction._bottleFrame(b).multiply(new THREE.Matrix4().compose(pos,q,new THREE.Vector3(1,1,1)));
      rig.updateMatrixWorld(true);const m=rig.matrixWorld.clone().invert().multiply(world),p=new THREE.Vector3(),r=new THREE.Quaternion();m.decompose(p,r,new THREE.Vector3());
      window.__iwer.controllers.left.position.copy(p);window.__iwer.controllers.left.quaternion.copy(r);
    };
    return {id:b.id,design:b.design||null};
  });
  assert.ok(picked,'a capped bottle in the scene');measured.bottle=picked;
  await frames(4);await page.evaluate(()=>window.__iwer.controllers.right.updateButtonValue('squeeze',1));await frames(30);
  const rightIdx=await page.evaluate(()=>window.__demo.interaction.xrControllers.findIndex(c=>c.handedness==='right'));
  assert.equal(await page.evaluate(i=>window.__demo.interaction.held.get(i)?.bottle===window.__capBottle,rightIdx),true);checks.push('right controller holds a capped bottle');

  // A one-handed squeeze at the cap of a bottle nobody else holds is a normal grab, so the cap needs the support hand.
  await page.evaluate(()=>window.__setCapHand(0,0));await frames(6);
  await page.evaluate(()=>window.__iwer.controllers.left.updateButtonValue('squeeze',1));await frames(3);
  const leftIdx=await page.evaluate(()=>window.__demo.interaction.xrControllers.findIndex(c=>c.handedness==='left'));
  assert.equal(await page.evaluate(i=>window.__demo.interaction.caps.has(i),leftIdx),true);checks.push('a left squeeze at the cap grips the cap, not the bottle');
  for(let k=1;k<=24;k++){await page.evaluate(t=>window.__setCapHand(t,0),k*(Math.PI/3+.15)/24);await frames(1);}
  const twisted=await page.evaluate(i=>window.__demo.interaction.caps.get(i)?.gesture.state(),leftIdx);measured.twisted=twisted;
  assert.ok(twisted&&twisted.status==='active'&&twisted.twist>Math.PI/3,`twist ${JSON.stringify(twisted)}`);
  assert.equal(await page.evaluate(()=>window.__capBottle.open),false);checks.push('twisting loosens without opening by itself');
  for(let k=1;k<=12;k++){await page.evaluate(l=>window.__setCapHand(Math.PI/3+.15,l),k*.025/12);await frames(1);}
  await frames(2);
  const opened=await page.evaluate(i=>({open:window.__capBottle.open,gripping:window.__demo.interaction.caps.has(i),capVisible:window.__demo.interaction._capOf(window.__capBottle).meshes.some(m=>m.visible)}),leftIdx);measured.opened=opened;
  assert.deepEqual(opened,{open:true,gripping:false,capVisible:false});checks.push('twist + pull opens the bottle and hides the cap');
  await page.screenshot({path:resolve(output,'opened.png')});

  await page.evaluate(()=>window.__iwer.controllers.left.updateButtonValue('squeeze',0));await frames(3);
  await page.evaluate(()=>window.__setCapHand(0,0));await frames(3);
  await page.evaluate(()=>window.__iwer.controllers.left.updateButtonValue('squeeze',1));await frames(3);
  assert.equal(await page.evaluate(()=>window.__capBottle.open),false);checks.push('a squeeze at the open mouth puts the cap back');
  await page.evaluate(()=>window.__iwer.controllers.left.updateButtonValue('squeeze',0));await frames(3);
  assert.equal(await page.evaluate(i=>window.__demo.interaction.held.get(i)?.bottle===window.__capBottle,rightIdx),true,'the support hand still holds the bottle');

  assert.deepEqual(errors,[]);checks.push('no browser errors');
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,measured,errors,headsetTested:false},null,2));
  console.log(JSON.stringify({passed:true,checks,measured},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,measured,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server});}
