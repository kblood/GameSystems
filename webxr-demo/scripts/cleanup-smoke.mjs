import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {closeSmokeResources} from './smoke-cleanup.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(new URL('../../../NightfallContractsWebXR-interaction/package.json',import.meta.url));
const puppeteer=require('puppeteer-core'),executablePath=process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!executablePath)throw new Error('Set CHROME_PATH');
const output=resolve(root,'test-results/smoke-cleanup');mkdirSync(output,{recursive:true});let browser,server;
try{
  server=await preview({root,preview:{host:'127.0.0.1',port:5306,strictPort:true}});
  browser=await puppeteer.launch({executablePath,headless:true});const child=browser.process();
  const stalled={process:()=>child,close:()=>new Promise(()=>{}),disconnect:()=>browser.disconnect()};
  const result=await closeSmokeResources({browser:stalled,server,timeoutMs:250,killTimeoutMs:2000});server=null;
  assert.equal(result.forced,true);assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(browser.connected,false);
  // Rebinding proves the old dedicated HTTP listener is gone, not merely marked as closed.
  server=await preview({root,preview:{host:'127.0.0.1',port:5306,strictPort:true}});
  await closeSmokeResources({server});server=null;
  writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:true,forced:true,browserExited:true,portRebound:true},null,2));
  console.log(JSON.stringify({passed:true,forced:true,browserExited:true,portRebound:true,output},null,2));
}finally{await closeSmokeResources({browser,server});}
