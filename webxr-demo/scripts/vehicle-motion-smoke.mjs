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
const output=resolve(root,'test-results/vehicle-motion');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5303,strictPort:true}});let browser,page;const errors=[],checks=[];
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1100}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5303/vehicle.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__vehicleLab?.ready,{timeout:30000});
  const locking=page.waitForFunction(()=>{const p=window.__vehicleLab.api.state('aster').parts.hood;if(p.fraction>.1&&p.fraction<.8){document.getElementById('lock-panels').click();return true;}return false;});await page.click('[data-part="hood"]');await locking;
  const locked=await page.evaluate(()=>({fraction:window.__vehicleLab.api.state('aster').parts.hood.fraction,angle:window.__vehicleLab.root.getObjectByName('Hood').rotation.x}));await page.evaluate(()=>new Promise(r=>setTimeout(r,400)));assert.deepEqual(await page.evaluate(()=>({fraction:window.__vehicleLab.api.state('aster').parts.hood.fraction,angle:window.__vehicleLab.root.getObjectByName('Hood').rotation.x})),locked);checks.push('native lock freezes interrupted logical animation and real GLB hinge');
  await page.click('[data-part="hood"]');assert.equal(await page.evaluate(()=>window.__vehicleLab.api.state('aster').parts.hood.target),1);await page.click('#lock-panels');await page.waitForFunction(()=>window.__vehicleLab.api.state('aster').parts.hood.fraction===1);checks.push('locked commands cannot retarget; unlock resumes pending panel target');await page.screenshot({path:resolve(output,'unlocked-hood.png')});
  await page.click('#ignition');await page.click('#drive');await page.$eval('#throttle',e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>window.__vehicleLab.api.state('aster').speed>1);await page.click('#open-all');assert.equal(await page.evaluate(()=>window.__vehicleLab.api.state('aster').parts.door_fl.target),0);checks.push('moving car refuses new opening targets');
  await page.click('#pause');const frozen=await page.evaluate(()=>window.__vehicleLab.checkpoint.capture());await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));assert.deepEqual(await page.evaluate(()=>window.__vehicleLab.checkpoint.capture()),frozen);await page.click('#pause');assert.equal(await page.evaluate(()=>window.__vehicleLab.api.state('aster').controls.throttle),0);checks.push('native pause freezes motion and reserves; resume keeps inputs neutral');
  await page.click('#brake');await page.waitForFunction(()=>window.__vehicleLab.api.state('aster').speed===0);const stopped=await page.evaluate(()=>window.__vehicleLab.api.state('aster').position);await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));assert.deepEqual(await page.evaluate(()=>window.__vehicleLab.api.state('aster').position),stopped);checks.push('native brake reaches rest without backwards jitter');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
