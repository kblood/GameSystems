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
const output=resolve(root,'test-results/pool-budget');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5298,strictPort:true}});let browser,page;const errors=[],checks=[];
function comparable(data){for(const b of data.state.fire.bottles.bottles){delete b.lastPourAgo;delete b.lastImpactAgo;}return data;}
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:1100}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('http://127.0.0.1:5298/fire.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__fire?.pools,{timeout:30000});await page.click('#pause');
  await page.evaluate(()=>{for(let i=0;i<140;i++)window.__fire.host.emit('liquid:deposit',{id:`budget-${i}`,ml:10,kind:'diesel',sourceKey:'test-supply',surfaceId:'floor-west',position:[-2.2+(i%12)*.17,.01,-1.1+Math.floor(i/12)*.17]});});
  const stats=await page.evaluate(()=>window.__fire.pools.stats());assert.deepEqual(stats,{records:140,active:128,dormant:12,maxActive:128});assert.equal(await page.evaluate(()=>window.__fire.pools.ledger().remainingMl),1400);checks.push('actual host deposits retain all 140 records and 1400 ml beyond active budget');
  assert.equal(await page.evaluate(()=>window.__fire.heat.objects().length),133);assert.equal(await page.evaluate(()=>window.__fire.pools.visible(128).length),128);
  await page.waitForFunction(()=>{let count=0;window.__fire.scene.traverse(o=>{if(o.isInstancedMesh&&o.geometry.type==='CylinderGeometry')count=o.count;});return count===128;});checks.push('thermal nodes and actual instanced graphics remain capped separately');
  await page.click('#save');const saved=await page.evaluate(()=>window.__fire.checkpoint.capture());await page.click('#show-dormant');
  await page.waitForFunction(()=>document.getElementById('target').value==='pool:budget-128');assert.equal(await page.evaluate(()=>window.__fire.pools.state('budget-128').active),true);assert.equal(await page.evaluate(()=>window.__fire.pools.stats().active),128);checks.push('native deferred-pool control activates retained fuel without exceeding budget');
  await page.click('#ignite');assert.equal(await page.evaluate(()=>window.__fire.heat.state('pool:budget-128').burning),true);checks.push('activated retained diesel can burn through the real thermal API');
  await page.click('#remove-dormant');assert.equal(await page.evaluate(()=>window.__fire.pools.ledger().removedMl),10);assert.equal(await page.evaluate(()=>window.__fire.pools.stats().records),139);checks.push('native collection debits dormant volume and its source');
  await page.click('#restore');assert.deepEqual(comparable(await page.evaluate(()=>window.__fire.checkpoint.capture())),comparable(saved));checks.push('whole building checkpoint restores all active and dormant records together');
  await page.waitForFunction(()=>document.getElementById('readout').textContent.includes('Væskeposter: 140 · hvilende: 12'));await page.screenshot({path:resolve(output,'retained-overflow.png')});
  for(const q of ['0','1','2','3'])await page.select('#quality',q);assert.equal(await page.evaluate(()=>window.__fire.pools.ledger().remainingMl),1400);checks.push('quality changes preserve retained volume and source identity');
  await page.click('#reset');await page.waitForFunction(()=>window.__fire?.pools&&window.__fire.pools.stats().records===0,{timeout:30000});assert.equal(await page.evaluate(()=>window.__fire.pools.ledger().remainingMl),0);checks.push('reset clears retained records and ledger');
  assert.deepEqual(errors,[]);checks.push('no browser, shader or HTTP errors');writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,errors,headsetTested:false},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server,onForced:()=>console.warn('Closed stalled owned test browser')});}
