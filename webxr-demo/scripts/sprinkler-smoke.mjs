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
const output=resolve(root,'test-results/sprinklers');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5296,strictPort:true}});let browser,page;const errors=[],checks=[];
// Debounce ages use performance.now even while simulation is paused; compare gameplay state separately.
function comparable(data){for(const b of data.state.fire.bottles.bottles){delete b.lastPourAgo;delete b.lastImpactAgo;}return data;}
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1100}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5296/fire.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__fire?.sprinklers,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__fire.supply.state('sprinkler-tank').ml),0);checks.push('finite sprinkler tank and two independent heads load');
  await page.click('#sprinkler-fill');await page.click('#sprinkler-valve');await page.click('#ignite');
  await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond>0,{timeout:30000});
  await page.screenshot({path:resolve(output,'spraying.png')});checks.push('native controls fill tank, open valve and heat triggers visible spray');
  await page.waitForFunction(()=>!window.__fire.heat.state('chair').burning&&window.__fire.heat.state('chair').wetMl>0,{timeout:30000});checks.push('sprinkler water extinguishes the actual thermal chair');
  await page.select('#speed','5');await page.waitForFunction(()=>window.__fire.supply.state('sprinkler-tank').ml<.001,{timeout:15000});
  await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond===0);checks.push('running dry stops flow and keeps persistent water pools');
  assert.ok(await page.evaluate(()=>window.__fire.pools.all().some(p=>p.components.water>0)));
  await page.click('#pause');await page.click('#save');const saved=await page.evaluate(()=>window.__fire.checkpoint.capture());
  await page.select('#sprinkler-liquid','diesel');await page.click('#sprinkler-fill');await page.click('#restore');
  assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(saved));checks.push('whole checkpoint restores supply and sprinkler phase together');
  await page.click('#sprinkler-fill');await page.click('#pause');
  await page.waitForFunction(()=>window.__fire.pools.all().some(p=>p.components.diesel>1),{timeout:10000});checks.push('diesel refill preserves liquid identity on the floor');
  await page.click('#pause');const before=await page.evaluate(()=>window.__fire.checkpoint.capture());
  assert.equal(await page.evaluate(()=>{const f=window.__fire,bad=f.checkpoint.capture();bad.state.fire.supply.tanks[0].drawnMl+=10;try{f.checkpoint.restore(bad);return false;}catch{return true;}}),true);
  assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(before));checks.push('invalid supply ledger rejects complete checkpoint atomically');
  await page.click('#pump-wire');const disconnected=await page.evaluate(()=>window.__fire.supply.state('sprinkler-tank').ml);await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond===0);await page.click('#pause');assert.equal(await page.evaluate(()=>window.__fire.supply.state('sprinkler-tank').ml),disconnected);checks.push('disconnected pump wire stops spray without consuming liquid');
  await page.click('#pump-wire');await page.click('#pump-switch');const energy=await page.evaluate(()=>window.__fire.power.state('battery').energyWh);await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond===0);await page.click('#pause');assert.equal(await page.evaluate(()=>window.__fire.power.state('battery').energyWh),energy);checks.push('pump switch prevents both flow and battery drain');
  await page.click('#pump-switch');await page.click('#pump-fault');assert.equal(await page.evaluate(()=>window.__fire.power.state('fuse').blown),true);await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond===0);await page.click('#pause');await page.screenshot({path:resolve(output,'pump-fuse.png')});checks.push('pump circuit fault blows fuse and cuts sprinkler flow');
  await page.click('#pump-fuse');assert.equal(await page.evaluate(()=>window.__fire.power.state('fuse').blown),true);checks.push('new pump fuse trips again until fault is cleared');
  const faultSnapshot=await page.evaluate(()=>window.__fire.checkpoint.capture());await page.click('#pump-fault');await page.click('#pump-fuse');await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond>0);await page.click('#pause');checks.push('repairing pump circuit restores flow from remaining supply');
  await page.evaluate(data=>window.__fire.checkpoint.restore(data),faultSnapshot);assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(faultSnapshot));checks.push('whole checkpoint restores pump receipt, network, fault and fluid together');
  await page.click('#pump-fault');await page.click('#pump-fuse');await page.evaluate(()=>{const p=window.__fire.power;p.draw('battery',p.state('battery').energyWh);p.evaluate();});const flatVolume=await page.evaluate(()=>window.__fire.supply.state('sprinkler-tank').ml);await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond===0);await page.click('#pause');assert.equal(await page.evaluate(()=>window.__fire.supply.state('sprinkler-tank').ml),flatVolume);
  await page.click('#pump-charge');await page.click('#pause');await page.waitForFunction(()=>window.__fire.sprinklers.state('west').flowMlPerSecond>0);await page.click('#pause');checks.push('flat battery preserves remaining liquid; native charge restores pump');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});const debug=page?await page.evaluate(()=>window.__fire?{state:window.__fire.state(),heads:window.__fire.sprinklers.all(),supply:window.__fire.supply.capture(),power:window.__fire.power?.capture(),pump:window.__fire.pump?.capture()}:null).catch(()=>null):null;writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack,debug},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
