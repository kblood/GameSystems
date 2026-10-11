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
const output=resolve(root,'test-results/cameras');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5297,strictPort:true}});let browser,page;const errors=[],checks=[];
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1000}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5297/security.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__security?.cameras,{timeout:30000});
  await page.click('#pause');
  await page.evaluate(()=>{const s=window.__security,r=s.renderer,render=r.render.bind(r);window.__feedTargets={};r.render=(scene,camera)=>{if(camera.name.startsWith('security:'))window.__feedTargets[camera.name.slice(9)]=r.getRenderTarget();return render(scene,camera);};});
  const pixelHash=id=>page.evaluate(id=>{const s=window.__security,t=window.__feedTargets[id],pixels=new Uint8Array(t.width*t.height*4);s.renderer.readRenderTargetPixels(t,0,0,t.width,t.height,pixels);let hash=2166136261,lo=255,hi=0;for(let i=0;i<pixels.length;i+=16){hash=Math.imul(hash^pixels[i],16777619);lo=Math.min(lo,pixels[i]);hi=Math.max(hi,pixels[i]);}return {hash,range:hi-lo};},id);
  await page.waitForFunction(()=>window.__feedTargets.west);const west=await pixelHash('west');assert.ok(west.range>20);await page.screenshot({path:resolve(output,'workshop-feed.png')});checks.push('real render target contains workshop image, not a blank texture');
  await page.select('#feed','east');await page.waitForFunction(()=>window.__feedTargets.east&&window.__security.screenMesh.material.map===window.__security.cameras.texture('east'));
  const east=await pixelHash('east');assert.ok(east.range>20);assert.notEqual(west.hash,east.hash);await page.screenshot({path:resolve(output,'warehouse-feed.png')});checks.push('native feed selector shows a distinct rendered warehouse image');
  await page.select('#feed','overhead');await page.waitForFunction(()=>window.__feedTargets.overhead);const overhead=await pixelHash('overhead');assert.notEqual(east.hash,overhead.hash);checks.push('third overhead feed renders and shares the same monitor');
  await page.click('#screen');const off=await page.evaluate(()=>window.__security.cameras.stats().frames);await page.evaluate(()=>new Promise(r=>setTimeout(r,500)));assert.equal(await page.evaluate(()=>window.__security.cameras.stats().frames),off);checks.push('screen off halts unneeded feed rendering');await page.click('#screen');
  for(const q of ['0','1','2','3']){await page.select('#quality',q);const f=await page.evaluate(()=>window.__security.cameras.feedState('overhead'));assert.equal(f.width,[128,256,512,1024][+q]);}checks.push('all quality tiers resize the actual feed targets');
  await page.click('#wire');await page.waitForFunction(()=>!window.__security.screenMesh.visible);assert.equal(await page.evaluate(()=>window.__security.network.state('display').power),0);await page.click('#wire');await page.waitForFunction(()=>window.__security.screenMesh.visible);checks.push('removing and reconnecting the physical supply wire cuts and restores bus power');
  await page.click('#main-switch');const disconnected=await page.evaluate(()=>window.__security.battery.state().energyWh);await page.click('#pause');await page.evaluate(()=>new Promise(r=>setTimeout(r,500)));await page.click('#pause');assert.equal(await page.evaluate(()=>window.__security.battery.state().energyWh),disconnected);await page.click('#main-switch');checks.push('cabinet switch isolates loads and prevents battery drain');
  await page.click('#short');assert.equal(await page.evaluate(()=>window.__security.network.state('fuse').blown),true);await page.waitForFunction(()=>!window.__security.screenMesh.visible);await page.screenshot({path:resolve(output,'blown-fuse.png')});checks.push('real short circuit trips fuse and shuts down camera display');
  await page.click('#fuse');assert.equal(await page.evaluate(()=>window.__security.network.state('fuse').blown),true);checks.push('replacement fuse trips again while fault remains');
  await page.evaluate(()=>{window.__savedPower=window.__security.checkpoint.capture();});await page.click('#short');await page.click('#fuse');await page.waitForFunction(()=>window.__security.screenMesh.visible);checks.push('repairing fault and replacing fuse restores voltage and video');
  await page.evaluate(()=>window.__security.checkpoint.restore(window.__savedPower));assert.equal(await page.evaluate(()=>window.__security.network.state('fuse').blown),true);await page.click('#short');await page.click('#fuse');checks.push('checkpoint restores circuit topology state, fault and blown fuse');
  await page.click('#save');const saved=await page.evaluate(()=>window.__security.checkpoint.capture());await page.select('#feed','west');await page.click('#camera');await page.click('#restore');assert.deepEqual(await page.evaluate(()=>window.__security.checkpoint.capture()),saved);checks.push('checkpoint restores camera flags, screen selection and battery');
  await page.select('#speed','20');await page.click('#pause');await page.waitForFunction(()=>window.__security.battery.state().energyWh===0,{timeout:30000});assert.equal(await page.evaluate(()=>window.__security.screenMesh.visible),false);checks.push('finite battery powers down the monitor');
  await page.click('#charge');await page.waitForFunction(()=>window.__security.screenMesh.visible);checks.push('recharging restores live monitor output');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
