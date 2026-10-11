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
const output=resolve(root,'test-results/lifecycle');mkdirSync(output,{recursive:true});const server=await preview({root,preview:{host:'127.0.0.1',port:5305,strictPort:true}});let browser;const errors=[],checks=[],navigation=[];
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1000}});
  for(const [file,hook]of [['security','__security'],['vehicle','__vehicleLab'],['fire','__fire'],['systems','__systems']]){
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(`${file}: ${e.message}`));page.on('console',m=>{if(m.type()==='error')errors.push(`${file}: ${m.text()}`);});
    await page.goto(`http://127.0.0.1:5305/${file}.html`,{waitUntil:'networkidle0'});await page.waitForFunction(h=>window[h]&&(h!=='__vehicleLab'||window[h].ready),{},hook);
    const data=await page.evaluate(h=>{const app=window[h];if(h==='__fire')app.flow.start('hose','lifecycle-test');if(h==='__vehicleLab')app.api.setControls('aster',{throttle:.7,steer:.2});window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));const snapshot=app.checkpoint?app.checkpoint.capture():app.station.state();return {snapshot,frame:app.renderer.info.render.frame,state:window.__pageLifecycle.state(),held:h==='__fire'?app.flow.state('hose').active:false};},hook);
    assert.equal(data.state.suspended,true);assert.equal(data.state.disposed,false);assert.equal(data.held,false);
    await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));const frozen=await page.evaluate(h=>{const app=window[h];return {frame:app.renderer.info.render.frame,snapshot:app.checkpoint?app.checkpoint.capture():app.station.state()};},hook);
    // Bottle debounce ages are wall time; owners' simulation state must remain frozen.
    const normalize=d=>{const bottles=d.state?.fire?.bottles?.bottles;for(const b of bottles??[]){delete b.lastPourAgo;delete b.lastImpactAgo;}return d;};
    assert.equal(frozen.frame,data.frame);assert.deepEqual(normalize(frozen.snapshot),normalize(data.snapshot));checks.push(`${file}: persisted hide releases input and freezes rendering/simulation without disposing owners`);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.waitForFunction((h,frame)=>window[h].renderer.info.render.frame>frame,{},hook,data.frame);assert.equal(await page.evaluate(()=>window.__pageLifecycle.state().disposed),false);
    await page.evaluate(h=>{const app=window[h];if(h==='__security')app.network.state('battery');else if(h==='__vehicleLab')app.api.state('aster');else if(h==='__fire')app.heat.roomState('west');else app.station.state();},hook);checks.push(`${file}: persisted return resumes a usable runtime`);
    // Exercise actual history traversal too; browsers may cache or perform a fresh reload.
    await page.evaluate(()=>{window.__historyMarker=Math.random();window.addEventListener('pageshow',e=>window.__returnedFromCache=e.persisted);});const marker=await page.evaluate(()=>window.__historyMarker);
    await page.goto('http://127.0.0.1:5305/index.html?avatar=off',{waitUntil:'networkidle0'});await page.goBack({waitUntil:'networkidle0'});await page.waitForFunction(h=>window[h]&&(h!=='__vehicleLab'||window[h].ready),{},hook);const result=await page.evaluate(old=>({reused:window.__historyMarker===old,persisted:window.__returnedFromCache??false,disposed:window.__pageLifecycle.state().disposed}),marker);assert.equal(result.disposed,false);navigation.push({file,...result});checks.push(`${file}: actual away/back navigation returns a usable runtime`);
    await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});assert.equal(await page.evaluate(()=>window.__pageLifecycle.state().disposed),true);checks.push(`${file}: terminal pagehide cannot be revived`);await page.close();
  }
  assert.deepEqual(errors,[]);checks.push('no page or shader errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,navigation,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,navigation,output},null,2));
}finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
