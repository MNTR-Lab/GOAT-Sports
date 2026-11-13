/* Provider-issued sessions only; token lifetimes and server permission checks are unchanged. */
(()=>{'use strict';const nativeFetch=window.fetch.bind(window);
window.GoatSessionManager={create(config){
 let current=null,flight=null;const key=config.key;
 function read(){try{const raw=localStorage.getItem(key);current=raw?JSON.parse(raw):null;}catch{}return current;}
 function save(data){current={access_token:data.access_token,refresh_token:data.refresh_token||null,expires_at:Number(data.expires_at)||Date.now()+Number(data.expires_in||3600)*1000};localStorage.setItem(key,JSON.stringify(current));config.onSession?.(current);return current;}
 function clear(){current=null;localStorage.removeItem(key);config.onSession?.(null);}
 function peek(){const s=read();return s?.access_token&&s.expires_at>Date.now()?s.access_token:null;}
 async function ensure(){
  const state=read();if(!state?.access_token)return null;
  if(state.expires_at>Date.now()+60000)return state.access_token;
  if(!state.refresh_token){if(state.expires_at>Date.now())return state.access_token;config.onMissingRefresh?.();return null;}
  if(flight)return flight;
  const renew=async()=>{
   const s=read();if(!s?.access_token)return null;if(s.expires_at>Date.now()+60000)return s.access_token;
   try{const fresh=await config.renew(s,nativeFetch);
    // A sign-out or a different login must not be resurrected by an in-flight renewal.
    const latest=read();if(!latest||latest.refresh_token!==s.refresh_token)return peek();
    if(!fresh?.access_token)throw Error('Session renewal returned no access token');
    save({...fresh,refresh_token:fresh.refresh_token||s.refresh_token});return current.access_token;
   }catch(e){
    const latest=read();if(e.terminal&&latest?.refresh_token===s.refresh_token){clear();config.onInvalid?.(e);}
    throw e;
   }
  };
  flight=(navigator.locks?.request?navigator.locks.request('goat-session:'+key,renew):renew()).finally(()=>{flight=null});return flight;
 }
 function installFetch(hosts){const previous=window.fetch.bind(window);window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),headers=new Headers(init.headers||(typeof input==='object'?input.headers:undefined));
  const auth=headers.get('authorization')||'',s=read();
  if(!url.pathname.startsWith('/auth/v1/token')&&hosts.includes(url.hostname)&&s?.access_token&&(auth==='Bearer '+s.access_token||auth===s.access_token)){
   const next=await ensure();if(!next)throw Error('Sign in is required to continue.');headers.set('authorization',auth.startsWith('Bearer ')?'Bearer '+next:next);
   return previous(input,{...init,headers});
  }
  return previous(input,init);
 };}
 read();if(current)config.onSession?.(current);
 const wake=()=>{if(!document.hidden)ensure().catch(()=>{});};
 const timer=setInterval(wake,30000);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
 window.addEventListener('storage',e=>{if(e.key===key){const s=read();config.onSession?.(s);if(!s)config.onSignedOut?.();}});
 return {set:save,clear,peek,ensure,read,installFetch,stop:()=>clearInterval(timer)};
}};
})();
