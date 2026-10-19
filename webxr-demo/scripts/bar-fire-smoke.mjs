// Real browser check of fire in the bottle demo (bar-fire.js) on the built page: a broken whisky bottle's spirits land as
// a burnable pool, a shot into that pool lights it, flames are drawn and the pool's liquid burns down; a wine spill does
// not light. Desktop only (the shot path is the same 'shot' event XR emits). Needs `npm run build` first.
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
const output=resolve(root,'test-results/bar-fire');mkdirSync(output,{recursive:true});
const server=await preview({root,preview:{host:'127.0.0.1',port:5313,strictPort:true}});let browser,page;const checks=[],errors=[],measured={};
try{
  browser=await puppeteer.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1200,height:800}});
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
  await page.goto('http://127.0.0.1:5313/?avatar=0',{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__demo?.fire&&window.__demo.factory.bottles.size>=29,{timeout:240000});
  const kinds=await page.evaluate(()=>[...window.__demo.factory.bottles].map(b=>b.liquidKind??null));
  assert.ok(kinds.includes('spirits')&&kinds.includes('diesel')&&kinds.includes('wine'),`kinds ${kinds}`);checks.push('catalog bottles are tagged spirits / diesel / wine');

  // Break a whisky and a distant wine bottle; their spills become pools on whatever they land on (wine poured into the
  // spirits would dilute and cool it, so they are kept apart here).
  await page.evaluate(()=>{const {factory,breakage}=window.__demo,all=[...factory.bottles];
    window.__whisky=all.find(b=>b.liquidKind==='spirits'&&b.fillMl>100);const w=window.__whisky.root.getWorldPosition(window.__whisky.root.position.clone()); // a wine bottle far away, so the spills stay apart
    window.__wine=all.find(b=>b.liquidKind==='wine'&&b.fillMl>100&&b.root.getWorldPosition(b.root.position.clone()).distanceTo(w)>1.2);
    breakage.breakBottle(window.__whisky,8);breakage.breakBottle(window.__wine,8);});
  await page.waitForFunction(()=>{const p=window.__demo.fire.pools.all();return p.some(x=>x.components.spirits>20)&&p.some(x=>x.components.wine>20);},{timeout:60000});
  const pools=await page.evaluate(()=>window.__demo.fire.pools.all().map(p=>({id:p.id,ml:+p.ml.toFixed(1),position:p.position.map(v=>+v.toFixed(2)),components:p.components,fuelJ:p.fuelJ})));
  measured.pools=pools;checks.push('broken bottles leave spirits and wine pools');

  // A shot straight down into each pool: the wine one does not light, the spirits one does.
  const shoot=kind=>page.evaluate(kind=>{const {fire,host}=window.__demo,p=fire.pools.all().filter(p=>(p.components[kind]??0)>20).sort((a,b)=>b.ml-a.ml)[0];
    host.emit('shot',{owner:'desktop',origin:{x:p.position[0],y:p.position[1]+1.2,z:p.position[2]},direction:{x:0,y:-1,z:0},hit:false});return p.id;},kind);
  const wineId=await shoot('wine');await page.evaluate(()=>new Promise(r=>setTimeout(r,300)));
  assert.equal(await page.evaluate(id=>window.__demo.fire.pools.state(id).burning,wineId),false);checks.push('a shot into spilled wine does not light it');
  const spiritsId=await shoot('spirits');
  await page.waitForFunction(id=>window.__demo.fire.pools.state(id).burning&&window.__demo.fire.stats().burning>0,{timeout:10000},spiritsId);
  const before=await page.evaluate(()=>window.__demo.fire.pools.ledger().burnedMl);
  await page.evaluate(()=>new Promise(r=>setTimeout(r,2500)));
  const fire=await page.evaluate(id=>{const {fire,scene}=window.__demo,s=fire.pools.state(id),flames=scene.getObjectByName('bar-fire');
    return {burning:s.burning,ml:s.ml,burnedMl:fire.pools.ledger().burnedMl,visibleFlames:flames.children.filter(c=>c.isGroup&&c.visible).length,light:flames.children.find(c=>c.isPointLight).intensity};},spiritsId);
  measured.fire={...fire,before};
  assert.ok(fire.visibleFlames>=1&&fire.light>0,`flames ${JSON.stringify(fire)}`);assert.ok(fire.burning&&fire.burnedMl>before,`the spirits burn down (ledger ${before} -> ${fire.burnedMl})`); // later drips still feed the pool, so its ml can grow
  checks.push('a shot into the spirits pool lights it: flames, light, and the liquid burns down');
  await page.evaluate(id=>{const {fire,camera}=window.__demo,p=fire.pools.state(id).position;camera.position.set(0,1.6,0);camera.parent.position.set(p[0]+.9,0,p[2]+.9);camera.parent.updateMatrixWorld(true);camera.lookAt(p[0],p[1]+.1,p[2]);},spiritsId);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:resolve(output,'burning.png')});

  assert.deepEqual(errors,[]);checks.push('no browser errors');
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,checks,measured,errors},null,2));
  console.log(JSON.stringify({passed:true,checks,measured},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:false,checks,measured,errors,failure:error.stack},null,2));throw error;}
finally{await closeSmokeResources({browser,server});}
