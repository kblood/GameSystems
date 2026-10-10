// Minimal loopback-only static server for the WebXR probe page. Usage: node probe_server.mjs <port>
import http from 'node:http';
const port = Number(process.argv[2] || 5291);
const page = `<!doctype html><meta charset=utf-8><title>xr-probe</title><button id=b>Enter VR (hand-tracking)</button><pre id=o></pre>
<script>
async function probe(){const r={secure:isSecureContext,href:location.href,hasXR:'xr' in navigator,ua:navigator.userAgent};
if(navigator.xr){for(const m of ['immersive-vr','immersive-ar','inline'])r[m]=await navigator.xr.isSessionSupported(m).catch(e=>'ERR '+e);}
document.getElementById('o').textContent=JSON.stringify(r,null,1);return r;}
window.probe=probe;probe();
document.getElementById('b').onclick=async()=>{try{const s=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['hand-tracking','local-floor']});
window.lastSession={enabledFeatures:s.enabledFeatures,inputs:[...s.inputSources].map(i=>({h:i.handedness,hand:!!i.hand,profiles:i.profiles}))};
document.getElementById('o').textContent+=' || SESSION '+JSON.stringify(window.lastSession);setTimeout(()=>s.end(),3000);}catch(e){document.getElementById('o').textContent+=' || ERR '+e;}};
</script>`;
http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(page); }).listen(port, '127.0.0.1', () => console.log('probe on', port));
