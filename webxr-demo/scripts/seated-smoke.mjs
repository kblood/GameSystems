// Real browser + IWER (emulated Quest 3) check of the XR body height on the built demo: a seated player (eye 1.15 m)
// gets seated mode from the first calibration, the rig is lifted to the standing reference, the avatar is fitted to that
// reference and its hands reach controllers held at a seated arm's length; the right stick Y crouches and holds.
// ?posture=standing (the old behaviour: avatar fitted to the seated eye height) is measured as the baseline.
// Not headset acceptance. Needs `npm run build` first (serves dist/ with vite preview).
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
const output=resolve(root,'test-results/seated');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5311,strictPort:true}});let browser;const checks=[],errors=[],measured={};
const SEATED_EYE=1.15,HANDS={right:[.30,1.0,-.52],left:[-.30,1.0,-.52]};
const install=`<script type="module">import {XRDevice,metaQuest3} from '/__iwer.js';
const d=new XRDevice(metaQuest3,{stereoEnabled:false});d.installRuntime({forceInstall:true});
d.position.set(0,${SEATED_EYE},0);d.controllers.right.position.set(${HANDS.right});d.controllers.left.position.set(${HANDS.left});window.__iwer=d;</script>`;

async function session(query) {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    const url=new URL(request.url());
    if(url.pathname==='/__iwer.js')return request.respond({status:200,contentType:'text/javascript',body:iwer});
    if(url.pathname==='/'||url.pathname==='/index.html'){const html=await (await fetch(url)).text();return request.respond({status:200,contentType:'text/html',body:html.replace('<head>','<head>'+install)});}
    request.continue();
  });
  await page.goto(`http://127.0.0.1:5311/${query}`,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__avatar?.player&&window.__demo?.interaction,{timeout:180000});
  await page.click('#enter-xr');await page.waitForFunction(()=>window.__demo.renderer.xr.isPresenting,{timeout:30000});
  return page;
}
// Distance between the avatar's drawn hand bones and the tracked wrists they should sit on (m).
const handError=page=>page.evaluate(()=>{
  const {interaction}=window.__demo,a=window.__avatar,out={};
  for(const c of interaction.xrControllers){
    const side=c.handedness;if(!side)continue;const wrist=a.trackedWrist(c.index),bone=a.player.humanoid.bones[side+'Hand'];
    const p=bone.getWorldPosition(bone.position.clone());out[side]=Math.hypot(p.x-wrist.pos[0],p.y-wrist.pos[1],p.z-wrist.pos[2]);
  }
  return out;
});
const frames=(page,n)=>page.evaluate(n=>new Promise(r=>{const s=window.__demo.renderer.xr.getSession();let k=0;const f=()=>{if(++k>=n)r();else s.requestAnimationFrame(f);};s.requestAnimationFrame(f);}),n);

try{
  browser=await puppeteer.launch({executablePath,headless:true,protocolTimeout:600000,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:960,height:640}});

  const seated=await session('?avatar=1');
  await seated.waitForFunction(()=>window.__demo.interaction.body.decided,{timeout:240000});
  const body=await seated.evaluate(()=>window.__demo.interaction.body.telemetry());
  assert.equal(body.posture,'seated');checks.push(`first calibration at eye ${SEATED_EYE} m chooses seated mode`);
  await frames(seated,60);
  const lifted=await seated.evaluate(()=>({offset:window.__demo.interaction.body.originOffset(),rigY:window.__demo.rig.position.y,scale:window.__avatar.player.scale,eye:window.__demo.camera.getWorldPosition(window.__demo.camera.position.clone()).y}));
  measured.seated={...lifted,referenceEye:body.referenceEye};
  assert.ok(Math.abs(lifted.eye-body.referenceEye)<.02,`view lifted to the standing reference (${lifted.eye.toFixed(3)} vs ${body.referenceEye})`);checks.push('the view is lifted to the standing reference eye');
  assert.ok(lifted.scale>.95,`avatar fitted to the standing reference, scale ${lifted.scale.toFixed(3)}`);checks.push('the avatar is fitted to the standing reference, not the seated eye');
  measured.seated.hands=await handError(seated);
  await seated.screenshot({path:resolve(output,'seated.png')});

  // Right stick Y: down crouches and holds where released; the stick does not snap-turn meanwhile.
  const yaw0=await seated.evaluate(()=>window.__demo.rig.rotation.y);
  await seated.evaluate(()=>window.__iwer.controllers.right.updateAxes('thumbstick',0,0));await frames(seated,3);
  await seated.evaluate(()=>window.__iwer.controllers.right.updateAxes('thumbstick',0,1));await frames(seated,20);
  await seated.evaluate(()=>window.__iwer.controllers.right.updateAxes('thumbstick',0,0));await frames(seated,5);
  const crouch=await seated.evaluate(()=>({crouch:window.__demo.interaction.body.virtualCrouch,yaw:window.__demo.rig.rotation.y}));
  await frames(seated,10);const held=await seated.evaluate(()=>window.__demo.interaction.body.virtualCrouch);
  measured.crouch={...crouch,held};
  assert.ok(crouch.crouch>.05&&Math.abs(held-crouch.crouch)<1e-6&&crouch.yaw===yaw0,`stick crouch ${JSON.stringify(measured.crouch)}`);checks.push('right stick down crouches, holds when released and never snap-turns');
  await seated.close();

  const standing=await session('?avatar=1&posture=standing');
  await standing.waitForFunction(()=>window.__avatar.player.scale<.9,{timeout:240000}).catch(()=>{});
  await frames(standing,60);
  measured.baseline={scale:await standing.evaluate(()=>window.__avatar.player.scale),hands:await handError(standing)};
  await standing.screenshot({path:resolve(output,'baseline-standing.png')});
  checks.push(`baseline (forced standing, avatar fitted to the seated eye): scale ${measured.baseline.scale.toFixed(3)}, hand error ${JSON.stringify(measured.baseline.hands)}`);
  await standing.close();
  // The drawn hand bone sits a fixed few cm from the tracked wrist point even at full reach; what matters is that the seated
  // avatar's hands reach and do much better than an avatar shrunk to the seated eye height.
  const worst=h=>Math.max(h.left??Infinity,h.right??Infinity);
  assert.ok(worst(measured.seated.hands)<.05,`seated hands reach the tracked wrists: ${JSON.stringify(measured.seated.hands)}`);
  assert.ok(worst(measured.seated.hands)<worst(measured.baseline.hands),`seated mode reaches better than the shrunk baseline: ${JSON.stringify(measured)}`);
  checks.push('both avatar hands reach controllers at a seated arm\'s length, better than the shrunk baseline');

  assert.deepEqual(errors,[]);checks.push('no browser errors');
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,measured,errors,headsetTested:false},null,2));
  console.log(JSON.stringify({passed:true,checks,measured},null,2));
}catch(error){writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,measured,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server});}
