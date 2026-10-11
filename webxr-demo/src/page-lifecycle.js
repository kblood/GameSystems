// Temporary suspension retains owners for page-cache reuse; terminal cleanup runs once.
export function bindPageLifecycle({window:win=globalThis.window,document:doc=globalThis.document,suspend,resume,releaseInput=()=>{},resetClock=()=>{},dispose,keepActiveWhenHidden=()=>false,onError=e=>console.error(e)}={}){
  if(!win?.addEventListener||!doc?.addEventListener)throw new TypeError('Page lifecycle needs window/document event targets');
  for(const callback of [suspend,resume,releaseInput,resetClock,dispose,keepActiveWhenHidden,onError])if(typeof callback!=='function')throw new TypeError('Lifecycle callbacks must be functions');
  let suspended=false,cached=false,disposed=false,errors=0;
  function invoke(fn){try{fn();}catch(e){errors++;try{onError(e);}catch(reportError){errors++;console.error(reportError);}}}
  function refresh(){if(disposed)return;const next=cached||(doc.hidden&&!keepActiveWhenHidden());if(next===suspended)return;suspended=next;
    invoke(releaseInput);if(next)invoke(suspend);else{invoke(resetClock);invoke(resume);}
  }
  function finish(){if(disposed)return;disposed=true;suspended=true;detach();invoke(releaseInput);invoke(suspend);invoke(dispose);}
  function hide(event){if(event.persisted){cached=true;refresh();}else finish();}
  function show(event){if(event.persisted){cached=false;refresh();}}
  function detach(){win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);doc.removeEventListener('visibilitychange',refresh);}
  win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);doc.addEventListener('visibilitychange',refresh);refresh();
  return {refresh,dispose:finish,state:()=>({suspended,cached,disposed,errors})};
}
