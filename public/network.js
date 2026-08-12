(()=>{'use strict';
const nativeFetch=window.fetch.bind(window);const API_RE=/^\/api\//;let wakePromise=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chip=()=>document.getElementById('providerChip');const status=()=>document.getElementById('searchStatus');
function setState(text,message){const c=chip();if(c)c.textContent=text;if(message){const s=status();if(s)s.textContent=message}}
async function rawWithTimeout(input,init={},timeoutMs=25000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await nativeFetch(input,{...init,signal:controller.signal})}finally{clearTimeout(timer)}}
async function wakeBackend(show=false){
  if(wakePromise)return wakePromise;
  wakePromise=(async()=>{let last;for(let i=0;i<6;i++){if(i){if(show)setState('waking research engine…',`Research engine is waking… retry ${i}/5. Free Render services can need a moment after sleeping.`);await sleep(Math.min(7500,1500*Math.pow(1.55,i-1)))}try{const r=await rawWithTimeout('/api/health',{cache:'no-store'},i?26000:18000);if(r.ok){setState('research engine online');return true}last=new Error(`Health check HTTP ${r.status}`)}catch(e){last=e}}setState('research engine unavailable');throw last||new Error('Research engine unavailable')})().finally(()=>{wakePromise=null});
  return wakePromise;
}
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:(input&&input.url)||'';if(!API_RE.test(url))return nativeFetch(input,init);
  const method=String(init.method||(input&&input.method)||'GET').toUpperCase();
  if(url==='/api/health')return nativeFetch(input,init);
  if(method!=='GET'&&method!=='HEAD'){
    try{await wakeBackend(true)}catch{return new Response(JSON.stringify({error:'Could not wake the crawler backend. The interface is online, but Render did not answer after several retries. Try again shortly.'}),{status:503,headers:{'content-type':'application/json'}})}
    try{return await rawWithTimeout(input,init,30000)}catch{return new Response(JSON.stringify({error:'The crawler backend disconnected while starting the request. It may still be waking up. Try once more; the page itself is fine.'}),{status:503,headers:{'content-type':'application/json'}})}
  }
  let last;for(let i=0;i<4;i++){if(i){setState('reconnecting…',`Connection dipped. Reconnecting to the research engine… ${i}/3`);await sleep(Math.min(5000,1000*Math.pow(1.7,i-1)))}try{const r=await rawWithTimeout(input,init,i?22000:15000);if(![502,503,504].includes(r.status)){setState('research engine online');return r}last=new Error(`Temporary backend HTTP ${r.status}`)}catch(e){last=e}}
  setState('research engine unavailable');return new Response(JSON.stringify({error:`Research engine could not be reached after retries${last?.message?`: ${last.message}`:''}.`}),{status:503,headers:{'content-type':'application/json'}})
};
window.addEventListener('DOMContentLoaded',()=>{wakeBackend(false).catch(()=>{})},{once:true});
})();
