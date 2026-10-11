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
const output=resolve(root,'test-results/flow');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5300,strictPort:true}});let browser,page;const errors=[],checks=[];
function comparable(data){for(const b of data.state.fire.bottles.bottles){delete b.lastPourAgo;delete b.lastImpactAgo;}return data;}
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1100}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5300/fire.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__fire?.flow,{timeout:30000});
  const water=()=>page.evaluate(()=>window.__fire.state().waterMl),held=()=>page.evaluate(()=>window.__fire.flow.state('hose').active);
  const press=async()=>{await page.hover('#hose-hold');await page.mouse.down();};
  await page.click('#ignite');await press();await page.waitForFunction(()=>window.__fire.flow.state('hose').emittedMl>60&&!window.__fire.heat.state('chair').burning,{timeout:15000});
  await page.screenshot({path:resolve(output,'held-hose.png')});await page.mouse.up();assert.equal(await held(),false);const released=await water();await page.evaluate(()=>new Promise(r=>setTimeout(r,250)));assert.equal(await water(),released);checks.push('actual mouse hold sprays and extinguishes; release stops source consumption');
  await page.click('#pause');const beforePulse=await water();await page.click('#water');assert.equal(await water(),beforePulse-80);checks.push('legacy 80 ml pulse still works as a paused scene edit');
  await page.click('#hose-refill');assert.equal(await water(),1200);checks.push('native refill uses finite supply capacity');await page.click('#pause');
  const beforeKey=await page.evaluate(()=>window.__fire.flow.state('hose').emittedMl);await page.focus('#hose-hold');await page.keyboard.down('Space');await page.waitForFunction(n=>window.__fire.flow.state('hose').emittedMl>n+20,{},beforeKey);await page.keyboard.up('Space');assert.equal(await held(),false);checks.push('native keyboard hold and release control the same nozzle');
  await press();await page.waitForFunction(()=>window.__fire.flow.state('hose').active);await page.$eval('#hose-hold',el=>{const owner=window.__fire.flow.state('hose').owners.find(o=>o.startsWith('pointer:'));el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:+owner.split(':')[1]}));});assert.equal(await held(),false);await page.mouse.up();checks.push('pointer cancellation cannot leave a held stream');
  await page.focus('#hose-hold');await page.keyboard.down('Enter');await page.waitForFunction(()=>window.__fire.flow.state('hose').active);await page.$eval('#hose-hold',el=>el.blur());await page.keyboard.up('Enter');assert.equal(await held(),false);checks.push('keyboard focus loss stops held flow');
  await press();await page.waitForFunction(()=>window.__fire.flow.state('hose').active);await page.evaluate(()=>document.getElementById('pause').click());assert.equal(await held(),false);await page.mouse.up();const paused=await water();await page.evaluate(()=>new Promise(r=>setTimeout(r,250)));assert.equal(await water(),paused);await page.click('#pause');assert.equal(await held(),false);checks.push('pause and resume cannot rearm a still-held nozzle');
  await press();await page.waitForFunction(()=>window.__fire.flow.state('hose').flowMlPerSecond>0);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await held(),false);await page.mouse.up();checks.push('window focus loss clears all input owners');
  await press();await page.waitForFunction(()=>window.__fire.flow.state('hose').flowMlPerSecond>0);
  const saved=await page.evaluate(()=>{document.getElementById('save').click();return window.__fire.checkpoint.decode(localStorage.getItem('gamesystems.fire-station.v1'));});
  await page.waitForFunction(n=>window.__fire.flow.state('hose').emittedMl>n+20,{},saved.state.fire.flow.emitters[0].emittedMl);
  const restored=await page.evaluate(()=>{document.getElementById('restore').click();return {data:window.__fire.checkpoint.capture(),active:window.__fire.flow.state('hose').active};});
  assert.deepEqual(comparable(restored.data),comparable(saved));assert.equal(restored.active,false);await page.mouse.up();checks.push('save during flow restores source, emitted volume and world while clearing held controls');
  await page.click('#pause');const before=await page.evaluate(()=>window.__fire.checkpoint.capture());assert.equal(await page.evaluate(()=>{const f=window.__fire,bad=f.checkpoint.capture();bad.state.fire.flow.emitters[0].emittedMl+=10000;try{f.checkpoint.restore(bad);return false;}catch{return true;}}),true);assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(before));checks.push('inconsistent emitted/source ledger is rejected atomically');
  await page.click('#hose-refill');await page.click('#pause');
  await page.$eval('#door',el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(()=>{const f=window.__fire,c=f.renderer.xr.getController(0);c.position.set(1.5,1.2,2.2);const goal=c.position.clone().set(1.5,0,1);c.quaternion.setFromRotationMatrix(c.matrix.clone().lookAt(c.position,goal,c.up));c.updateMatrix();c.updateMatrixWorld(true);c.dispatchEvent({type:'selectstart'});});
  await page.waitForFunction(()=>window.__fire.flow.state('hose').target?.targetId===null&&window.__fire.flow.state('hose').flowMlPerSecond>0);checks.push('XR controller event and real scene raycast can deposit onto floor');
  await page.evaluate(()=>{const f=window.__fire,c=f.renderer.xr.getController(0),goal=c.position.clone().set(...f.heat.state('chair').position);c.quaternion.setFromRotationMatrix(c.matrix.clone().lookAt(c.position,goal,c.up));c.updateMatrix();c.updateMatrixWorld(true);});
  await page.waitForFunction(()=>window.__fire.flow.state('hose').flowMlPerSecond===0);const blocked=await water();await page.evaluate(()=>new Promise(r=>setTimeout(r,200)));assert.equal(await water(),blocked);checks.push('actual closed door occludes controller stream without spending liquid');
  await page.$eval('#door',el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>window.__fire.flow.state('hose').target?.targetId==='chair'&&window.__fire.flow.state('hose').flowMlPerSecond>0);await page.evaluate(()=>window.__fire.renderer.xr.getController(0).dispatchEvent({type:'selectend'}));assert.equal(await held(),false);checks.push('opening door permits tracked aiming; selectend stops input');await page.click('#pause');
  await page.click('#hose-refill');await page.select('#speed','5');await page.click('#pause');await press();await page.waitForFunction(()=>window.__fire.state().waterMl===0,{timeout:15000});await page.waitForFunction(()=>window.__fire.flow.state('hose').flowMlPerSecond===0);await page.mouse.up();checks.push('finite tank runs dry and stops delivered flow');
  const balanced=await page.evaluate(()=>{const f=window.__fire,s=f.supply.state('hose-tank'),e=f.flow.state('hose');return Math.abs(s.drawnMl-e.emittedMl)<1e-6&&Math.abs(f.pools.all().reduce((n,p)=>n+Object.values(p.sources.hose??{}).reduce((a,b)=>a+b,0),0)-e.emittedMl)<1e-6;});assert.equal(balanced,true);checks.push('source draw and persistent hose provenance remain balanced');
  await page.click('#reset');await page.waitForFunction(()=>window.__fire?.flow&&window.__fire.state().waterMl===1200&&!window.__fire.flow.state('hose').active);checks.push('reset restores capacity and clears transient owners');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
