import {basename} from 'node:path';

async function settleWithin(action,ms){
  let timer;try{return await Promise.race([Promise.resolve().then(action).then(value=>({value}),error=>({error})),new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),ms);})]);}finally{clearTimeout(timer);}
}
function exited(child){return child.exitCode!==null&&child.exitCode!==undefined||child.signalCode!==null&&child.signalCode!==undefined;}
function ownedTemporaryBrowser(child){
  const executable=basename(child?.spawnfile??'').toLowerCase();
  return ['chrome.exe','chrome','chromium','chromium-browser','msedge.exe','msedge'].includes(executable)&&child.spawnargs?.some(arg=>/^--user-data-dir=.*[\\/]puppeteer_dev_chrome_profile[-_]/.test(arg));
}
async function closeBrowser(browser,timeoutMs,killTimeoutMs){
  if(!browser)return {closed:true,forced:false};
  const child=browser.process?.();
  if(!child){const detached=await settleWithin(()=>browser.disconnect(),killTimeoutMs);if(detached.timeout||detached.error)throw new Error('Could not disconnect unowned browser',{cause:detached.error});return {closed:false,forced:false,detached:true};}
  const graceful=await settleWithin(()=>browser.close(),timeoutMs);
  if(!graceful.timeout&&!graceful.error)return {closed:true,forced:false};
  if(!ownedTemporaryBrowser(child)){await settleWithin(()=>browser.disconnect(),killTimeoutMs);throw new Error('Browser cleanup failed; refusing to kill an unverified browser',{cause:graceful.error});}
  let forced=false;
  if(!exited(child)){
    let onExit,onError;
    const exit=new Promise((resolve,reject)=>{onExit=()=>resolve();onError=reject;child.once('exit',onExit);child.once('error',onError);});
    try{forced=child.kill('SIGKILL');const stopped=exited(child)?{}:await settleWithin(()=>exit,killTimeoutMs);if(stopped.timeout||stopped.error||!exited(child))throw new Error('Owned browser did not terminate',{cause:stopped.error});}
    finally{child.removeListener('exit',onExit);child.removeListener('error',onError);}
  }
  const detached=await settleWithin(()=>browser.disconnect(),killTimeoutMs);if(detached.timeout||detached.error)throw new Error('Browser client cleanup failed',{cause:detached.error});
  return {closed:true,forced};
}
async function closeServer(server,dev,timeoutMs){
  if(!server)return;
  const closed=await settleWithin(async()=>{server.httpServer?.closeAllConnections?.();if(dev)await server.close();else await new Promise((resolve,reject)=>server.httpServer.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));},timeoutMs);
  if(closed.timeout||closed.error)throw new Error('Smoke server cleanup failed',{cause:closed.error});
}
export async function closeSmokeResources({browser,server,dev=false,timeoutMs=5000,killTimeoutMs=2000,onForced=()=>{}}={}){
  for(const duration of [timeoutMs,killTimeoutMs])if(!Number.isFinite(duration)||duration<=0||duration>60000)throw new RangeError('Invalid cleanup deadline');
  // Closing the dedicated server concurrently avoids stranding it if Chrome fails to shut down.
  const [browserResult,serverResult]=await Promise.allSettled([closeBrowser(browser,timeoutMs,killTimeoutMs),closeServer(server,dev,timeoutMs)]);
  const errors=[browserResult,serverResult].filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Smoke resource cleanup failed');
  if(browserResult.value.forced)onForced();return {...browserResult.value,serverClosed:true};
}
