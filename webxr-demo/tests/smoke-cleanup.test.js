import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {closeSmokeResources} from '../scripts/smoke-cleanup.mjs';
const forever=()=>new Promise(()=>{});
function fixture({hang=false,owned=true,killWorks=true,reject=false}={}){
  const child=new EventEmitter();Object.assign(child,{spawnfile:'C:/Chrome/chrome.exe',spawnargs:[`--user-data-dir=C:/Temp/${owned?'puppeteer_dev_chrome_profile-task':'user-profile'}`],exitCode:null,signalCode:null});
  const calls={close:0,kill:0,disconnect:0,server:0,connections:0};
  child.kill=signal=>{calls.kill++;if(killWorks){child.signalCode=signal;child.emit('exit',null,signal);}return killWorks;};
  const browser={process:()=>child,async close(){calls.close++;if(reject)throw new Error('protocol failed');if(hang)return forever();child.exitCode=0;},disconnect(){calls.disconnect++;}};
  const server={httpServer:{closeAllConnections(){calls.connections++;},close(callback){calls.server++;callback();}}};
  return {browser,server,child,calls};
}
const deadlines={timeoutMs:10,killTimeoutMs:10};
test('smoke cleanup: graceful browser and dedicated server close without a kill',async()=>{
  const f=fixture(),r=await closeSmokeResources({...f,...deadlines});assert.equal(r.forced,false);assert.equal(f.calls.kill,0);assert.equal(f.calls.server,1);assert.equal(f.calls.connections,1);
});
test('smoke cleanup: a stalled owned temporary browser is killed, confirmed exited and disconnected',async()=>{
  const f=fixture({hang:true});let warned=0;const r=await closeSmokeResources({...f,...deadlines,onForced:()=>warned++});assert.equal(r.forced,true);assert.equal(f.calls.kill,1);assert.equal(f.calls.disconnect,1);assert.equal(warned,1);assert.equal(f.child.listenerCount('exit'),0);
});
test('smoke cleanup: protocol failure still cleans up the owned child and server',async()=>{
  const f=fixture({reject:true});const r=await closeSmokeResources({...f,...deadlines});assert.equal(r.closed,true);assert.equal(r.forced,true);assert.equal(f.calls.server,1);
});
test('smoke cleanup: unknown profile cannot be killed; remote browser is only disconnected',async()=>{
  const f=fixture({hang:true,owned:false});await assert.rejects(closeSmokeResources({...f,...deadlines}),AggregateError);assert.equal(f.calls.kill,0);assert.equal(f.calls.server,1);
  let closes=0,disconnects=0;const remote={process:()=>null,close(){closes++;},disconnect(){disconnects++;}};
  const r=await closeSmokeResources({browser:remote,...deadlines});assert.equal(r.detached,true);assert.equal(closes,0);assert.equal(disconnects,1);
});
test('smoke cleanup: failed termination is reported after deadline without leaking listeners',async()=>{
  const f=fixture({hang:true,killWorks:false});await assert.rejects(closeSmokeResources({...f,...deadlines}),AggregateError);assert.equal(f.calls.server,1);assert.equal(f.child.listenerCount('exit'),0);assert.equal(f.child.listenerCount('error'),0);
});
test('smoke cleanup: dev server and browser errors are independent and invalid deadlines do not touch owners',async()=>{
  const f=fixture();let devClose=0;f.server.close=async()=>{devClose++;};await closeSmokeResources({...f,dev:true,...deadlines});assert.equal(devClose,1);
  const g=fixture();g.server.httpServer.close=callback=>callback(new Error('server failed'));await assert.rejects(closeSmokeResources({...g,...deadlines}),AggregateError);assert.equal(g.calls.close,1);
  const h=fixture();await assert.rejects(closeSmokeResources({...h,timeoutMs:NaN}),RangeError);assert.equal(h.calls.close,0);assert.equal(h.calls.connections,0);
});
