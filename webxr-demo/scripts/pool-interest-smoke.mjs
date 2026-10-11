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
const output=resolve(root,'test-results/pool-interest');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5299,strictPort:true}});let browser,page;const errors=[],checks=[];
function comparable(data){for(const b of data.state.fire.bottles.bottles){delete b.lastPourAgo;delete b.lastImpactAgo;}return data;}
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1100}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5299/fire.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__fire?.interest,{timeout:30000});await page.click('#pause');
  await page.$eval('#door',el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(()=>{const f=window.__fire;for(let i=0;i<128;i++)f.host.emit('liquid:deposit',{id:`cold-${i}`,ml:10,kind:'water',surfaceId:'floor-east',position:[1.7+(i%4)*.1,.01,-1+(i%12)*.15],sourceKey:'interest-test'});
    f.host.emit('liquid:deposit',{id:'latent',ml:20,kind:'diesel',surfaceId:'floor-west',position:[-.3,.01,.7],sourceKey:'interest-test'});f.heat.setPosition('metal',[.1,.25,.7],'east');});
  assert.equal(await page.evaluate(()=>window.__fire.pools.state('latent').active),false);checks.push('real liquid events preserve dormant diesel beyond 128 active pool slots');
  await page.select('#target','metal');await page.click('#heat');await page.click('#heat');await page.click('#pause');
  await page.waitForFunction(()=>window.__fire.interest.capture().sourceAfter==='metal',{timeout:10000});await page.click('#pause');assert.equal(await page.evaluate(()=>window.__fire.pools.state('latent').active),false);checks.push('native heat control cannot awaken fuel across closed room partition');
  await page.$eval('#door',el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('#pause');
  await page.waitForFunction(()=>window.__fire.pools.state('latent').active,{timeout:10000});assert.equal(await page.evaluate(()=>window.__fire.pools.stats().active),128);checks.push('opening partition automatically activates nearby retained fuel within budget');
  await page.waitForFunction(()=>window.__fire.heat.state('pool:latent').burning&&window.__fire.scene.getObjectByName('fire:pool:latent')?.visible,{timeout:20000});await page.click('#pause');
  assert.ok(await page.evaluate(()=>window.__fire.pools.ledger().burnedMl>0));checks.push('ordinary thermal conduction ignites fuel and updates its true burn ledger');
  const stats=await page.evaluate(()=>window.__fire.interest.stats());assert.ok(stats.checks<=64&&stats.cells<=64&&stats.activated<=1);checks.push('actual scheduler diagnostics obey inspection and activation limits');
  await page.evaluate(()=>{const c=window.__fire.camera;c.position.set(-4,4.2,6);c.lookAt(0,.7,0);});await page.screenshot({path:resolve(output,'automatic-fuel-fire.png')});await page.click('#save');const saved=await page.evaluate(()=>window.__fire.checkpoint.capture());
  await page.click('#reset');await page.waitForFunction(()=>window.__fire?.interest&&window.__fire.pools.stats().records===0);await page.click('#restore');
  assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(saved));checks.push('whole reset and checkpoint restore recover active fuel, query cursor and scheduler phase');
  for(const q of ['0','1','2','3'])await page.select('#quality',q);assert.equal(await page.evaluate(()=>window.__fire.pools.stats().active),128);checks.push('quality changes preserve logical activation and fuel');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});const debug=page?await page.evaluate(()=>window.__fire?{state:window.__fire.state(),interest:window.__fire.interest.capture(),latent:window.__fire.pools.has('latent')?window.__fire.pools.state('latent'):null}:null).catch(()=>null):null;writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack,debug},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
