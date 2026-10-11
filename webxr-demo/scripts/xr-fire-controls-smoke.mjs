import {closeSmokeResources} from './smoke-cleanup.mjs';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {preview} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(new URL('../../../NightfallContractsWebXR-interaction/package.json',import.meta.url));
const puppeteer=require('puppeteer-core'),executablePath=process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!executablePath)throw new Error('Set CHROME_PATH');
const output=resolve(root,'test-results/xr-fire-controls');mkdirSync(output,{recursive:true});const server=await preview({root,preview:{host:'127.0.0.1',port:5309,strictPort:true}});let browser,page;const checks=[],errors=[];
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1000}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5309/fire.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__fire?.missions);
  await page.evaluate(()=>{window.__fire.renderer.xr.dispatchEvent({type:'sessionstart'});window.__aimControl=(name,index=0,release=true)=>{const f=window.__fire,c=f.renderer.xr.getController(index),button=f.scene.getObjectByName(name);f.scene.updateMatrixWorld(true);c.position.set(0,1.6,0);c.parent.updateMatrixWorld(true);const target=c.parent.worldToLocal(button.getWorldPosition(button.position.clone()));c.quaternion.setFromRotationMatrix(c.matrix.clone().lookAt(c.position,target,c.up));c.updateMatrix();c.updateMatrixWorld(true);c.dispatchEvent({type:'selectstart'});if(release)c.dispatchEvent({type:'selectend'});};});
  assert.equal(await page.$eval('aside',el=>el.style.display),'none');await page.evaluate(()=>window.__aimControl('xr-action:challenge-level'));assert.equal(await page.$eval('#challenge-difficulty',el=>el.value),'hard');checks.push('controller raycast can select next difficulty with the desktop panel hidden');
  await page.evaluate(()=>window.__aimControl('xr-action:challenge-start'));await page.waitForFunction(()=>window.__fire?.missions.state().status==='active');assert.equal(await page.evaluate(()=>window.__fire.missions.state().timeLimit),60);checks.push('XR start creates the actual selected challenge');
  await page.evaluate(()=>window.__aimControl('xr-action:pour'));assert.equal(await page.evaluate(()=>window.__fire.state().pourClock),0);checks.push('XR diesel respects the same active-challenge editor lock');
  await page.evaluate(()=>window.__aimControl('xr-nozzle:hose',0,false));assert.equal(await page.evaluate(()=>window.__fire.flow.state('hose').active),true);
  await page.evaluate(()=>window.__aimControl('xr-action:pause',1));assert.equal(await page.evaluate(()=>window.__fire.state().paused),true);assert.equal(await page.evaluate(()=>window.__fire.flow.state('hose').active),false);checks.push('other-hand XR pause releases all held nozzle owners');
  await page.evaluate(()=>window.__aimControl('xr-nozzle:foam'));assert.equal(await page.evaluate(()=>window.__fire.flow.state('foam').active),false);checks.push('paused XR nozzle cannot dose fluid');
  await page.evaluate(()=>{const f=window.__fire;f.heat.configureRoom('west',{smoke:1});f.alarms.step(.6);window.__aimControl('xr-action:alarm-silence');});assert.equal(await page.evaluate(()=>window.__fire.alarms.state('west').silenced),true);checks.push('XR alarm acknowledgement works while simulation is paused');
  // Synthetic XR stops the desktop loop; allow the bounded text interval and refresh via a real control.
  await page.evaluate(()=>new Promise(r=>setTimeout(r,250)));await page.evaluate(()=>window.__aimControl('xr-action:challenge-level'));
  assert.match(await page.evaluate(()=>window.__fire.worldReadout.stats().text),/PAUSE[\s\S]*Udfordring/);
  assert.equal(await page.evaluate(()=>window.__fire.scene.getObjectByName('xr-action:pause').userData.text),'FORTSÆT');assert.match(await page.evaluate(()=>window.__fire.scene.getObjectByName('xr-action:challenge-level').userData.text),/LET 180/);
  await page.evaluate(()=>{const f=window.__fire;f.smoke.prime();f.camera.position.set(0,1.65,0);f.camera.fov=80;f.camera.updateProjectionMatrix();f.camera.parent.updateMatrixWorld(true);f.camera.lookAt(0,1.7,.8);f.renderer.render(f.scene,f.camera);});await page.screenshot({path:resolve(output,'xr-controls.png')});
  await page.evaluate(()=>window.__aimControl('xr-action:pause'));assert.equal(await page.evaluate(()=>window.__fire.state().paused),false);assert.equal(await page.evaluate(()=>window.__fire.flow.state('hose').active),false);checks.push('XR resume does not revive stale held input');
  await page.evaluate(()=>window.__aimControl('xr-action:challenge-stop'));assert.equal(await page.evaluate(()=>window.__fire.missions.state().status),'idle');await page.evaluate(()=>window.__aimControl('xr-action:pour'));assert.equal(await page.evaluate(()=>window.__fire.state().pourClock),2);checks.push('XR sandbox exits the objective and restores diesel tools');
  const disposed=await page.evaluate(()=>{let n=0;const f=window.__fire;f.scene.traverse(o=>{if(o.name.startsWith('xr-action:')||o.name.startsWith('xr-nozzle:'))for(const resource of [o.geometry,o.material,o.material.map])resource.addEventListener('dispose',()=>n++);});f.renderer.xr.dispatchEvent({type:'sessionend'});window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));return n;});assert.equal(disposed,24);checks.push('terminal cleanup releases all eight menu geometry/material/texture owners exactly once');
  assert.deepEqual(errors,[]);checks.push('no browser or shader errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server});}
