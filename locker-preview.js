/* Read-only review of the actual Locker UI using the administrator's own login.
   This is a UI safeguard, not an alternative authorization mechanism. Every read
   still passes the existing server-side Shopify identity and organization checks. */
(()=>{'use strict';
const key='goat_locker_preview_org';const param=new URL(location.href).searchParams.get('previewOrganization');
if(param&&/^\d{5,20}$/.test(param))sessionStorage.setItem(key,param);
const org=param&&/^\d{5,20}$/.test(param)?param:sessionStorage.getItem(key)||'';
let enabled=false,selectedName='',installed=false;
const active=()=>/^\d{5,20}$/.test(org);
const message='Customer Preview is read-only. Exit preview to make changes using your own account.';
const reads={
 'goat-locker-access':['me'],'goat-artwork-library':['list','get','open','file','download','list_jobs','list_versions'],
 'goat-locker-directory':['list','list_test'],'goat-locker-jobs':['list','list_test_jobs'],
 'goat-locker-shopify-order':[''],'goat-customer-artwork':['list','get','open','file','download','list_jobs','list_versions','read'],
 'goat-locker-proof':['','get','open'],'goat-locker-artwork':['list','open','file','get'],
 'goat-crm-customer-library':[''],'goat-locker-crm-quotes':[''],'goat-crm-locker-artwork':[''],
 'goat-locker-invoices':[''],'goat-locker-organization-profile':['get']
};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
 if(active()){
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=String(init.method||input.method||'GET').toUpperCase();
  if(url.hostname.endsWith('.supabase.co')&&!['GET','HEAD','OPTIONS'].includes(method)){
   let body={};try{body=JSON.parse(String(init.body||''))}catch{}
   const name=url.pathname.split('/functions/v1/')[1];
   if(method!=='POST'||!name||!reads[name]?.includes(String(body.action||'')))throw Error(message);
   // Team-specific reads cannot be redirected to a different organization.
   for(const field of ['organizationId','organizationMondayId'])if(body[field]!=null&&String(body[field])!==org)throw Error('Preview is restricted to the selected organization.');
  }
 }
 return originalFetch(input,init);
};
function banner(){
 if(!active())return;
 let el=document.getElementById('goat-customer-preview-banner');
 if(!el){el=document.createElement('div');el.id='goat-customer-preview-banner';el.style.cssText='position:sticky;top:0;z-index:12000;padding:12px 22px;background:#fff3d6;border-bottom:2px solid #c68c25;color:#4f370b;font:14px/1.5 system-ui;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap';el.innerHTML='<div><strong id="goat-preview-title"></strong><div style="font-size:12px">Your own account · Actual customer pages · Approvals, edits, and payment links disabled</div></div><button type="button" id="goat-preview-exit" style="padding:8px 13px;border-radius:8px;border:1px solid #b28a40;background:white;cursor:pointer">Exit preview</button>';document.body.prepend(el);document.getElementById('goat-preview-exit').onclick=()=>{sessionStorage.removeItem(key);const u=new URL(location.href);u.searchParams.delete('previewOrganization');location.assign(u.href);};}
 document.getElementById('goat-preview-title').textContent='CUSTOMER PREVIEW'+(selectedName?' · '+selectedName:' · Sign in with your Locker admin account');
}
function restrictControls(){
 banner();if(!active())return;
 for(const el of document.querySelectorAll('#content button,#content a,#content input,#content textarea,#content select')){
  const action=el.getAttribute('onclick')||'',href=el.getAttribute('href')||'';
  const writes=/submitCrmLockerDecision|artDecide|artUpload|artSend|qsave|qcreate|qsend|qattach|qsync|goatSave|goatProfileSave|goatOpenProfile|goatEditProfile|openGoatArtworkLibrary|goatQuoteResponse/i.test(action);
  const payment=/\/invoices\/|checkout|[?&]pay(?:ment)?=/i.test(href);
  const formControl=['INPUT','TEXTAREA','SELECT'].includes(el.tagName);
  if(writes||payment||formControl){el.setAttribute('data-goat-preview-blocked','true');el.setAttribute('title',message);if('disabled' in el)el.disabled=true;else{el.setAttribute('aria-disabled','true');el.style.opacity='.5';}}
 }
}
async function activate(){
 if(!active())return;banner();
 if(!customerToken()||!lockerIdentity||!directoryState.loaded)return;
 const selected=directoryState.organizations.find(x=>String(x.mondayItemId)===org);
 if(!selected){enabled=false;document.getElementById('content').innerHTML='<div class="panel"><h2>Preview unavailable</h2><p>This account does not have access to the requested organization. Sign in with your GOAT Locker administrator account, or exit preview.</p></div>';return;}
 directoryState.organizations=[selected];directoryState.selected=selected;selectedName=selected.name;enabled=true;
 jobState={loading:false,loaded:false,jobs:[],error:'',organizationId:org};
 render();await Promise.allSettled([loadOrganizationJobs(),loadCrmLockerQuotes(true)]);render();
}
function install(){
 if(installed||!active())return;installed=true;
 const originalRender=render;
 render=function(){
  if(enabled){directoryState.organizations=directoryState.organizations.filter(x=>String(x.mondayItemId)===org);const selected=directoryState.organizations[0];if(selected)directoryState.selected=selected;}
  const identity=lockerIdentity,previousRole=identity?.adminRole,previousAccess=identity?.organizationAccess;
  try{
   // Project customer-only controls for rendering; requests retain the real admin session.
   if(enabled&&identity){identity.adminRole=null;identity.organizationAccess=[{organization_monday_id:org,role:'Customer',active:true}];}
   originalRender();
  }finally{if(identity){identity.adminRole=previousRole;identity.organizationAccess=previousAccess;}}
  if(!enabled){const content=document.getElementById('content');if(content)content.innerHTML='<div class="panel"><h2>Customer Preview</h2>'+authMessage()+'<p class="muted">The requested team will open after your Locker account access is verified.</p></div>';}
  restrictControls();
 };
 document.addEventListener('click',e=>{if(!active())return;const blocked=e.target.closest('[data-goat-preview-blocked]');if(blocked){e.preventDefault();e.stopImmediatePropagation();alert(message);}},true);
 document.addEventListener('submit',e=>{if(active()){e.preventDefault();e.stopImmediatePropagation();alert(message);}},true);
 restrictControls();
}
window.GoatLockerPreview={active,activate,install};
})();
