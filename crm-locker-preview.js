/* Read-only rendering frame. Customer data arrives only from the authenticated
   CRM parent; no CRM tokens or customer credentials are accepted or transmitted. */
(()=>{'use strict';let snapshot=null,installed=false;const nativeFetch=window.fetch.bind(window);const text=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noWrite='This is a read-only CRM preview.';
window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);let b={};try{b=JSON.parse(String(init.body||''))}catch{}
 if(!snapshot)return Response.json({error:'Open the preview from GOAT CRM.'},{status:403});
 const org=snapshot.organization.mondayItemId;
 for(const field of ['organizationId','organizationMondayId'])if(b[field]&&String(b[field])!==org)return Response.json({error:'Different organization blocked in preview.'},{status:403});
 const name=url.pathname.split('/functions/v1/')[1];
 const result=name==='goat-locker-jobs'&&['list','list_test_jobs'].includes(b.action)?{jobs:snapshot.jobs,organizationId:org}:
 name==='goat-locker-crm-quotes'?{ok:true,quotes:snapshot.quotes}:
 name==='goat-crm-customer-library'?{ok:true,files:snapshot.library}:
 name==='goat-locker-organization-profile'&&b.action==='get'?{profile:snapshot.profile,logo:snapshot.profile?.logo_data||null}:
 name==='goat-locker-invoices'?{invoices:snapshot.invoices||[]}:
 name==='goat-locker-directory'&&['list','list_test'].includes(b.action)?{organizations:[snapshot.organization]}:
 name==='goat-locker-artwork'&&b.action==='list'?{proofs:[]}:null;
 if(result)return Response.json(result);
 if((snapshot.library||[]).some(f=>f.url===url.href)){const headers=new Headers(init.headers);headers.delete('authorization');headers.delete('apikey');return nativeFetch(input,{...init,headers,credentials:'omit'});}
 return Response.json({error:noWrite+' Open customer-only actions in the normal Locker.'},{status:403});
};
function restrict(){
 for(const el of document.querySelectorAll('#content button,#content input,#content textarea,#content select,#content a')){
  const action=el.getAttribute('onclick')||'',href=el.getAttribute('href')||'';
  if(/submitCrmLockerDecision|artDecide|artUpload|artSend|qsave|qcreate|qsend|qattach|qsync|goatSave|goatProfileSave|goatOpenProfile|goatEditProfile|customerLogin|lockerSignOut|openGoatArtworkLibrary/i.test(action)||/\/invoices\/|checkout|\/account/i.test(href)||['INPUT','TEXTAREA','SELECT'].includes(el.tagName)){
   el.setAttribute('data-crm-preview-blocked','true');el.title=noWrite;if('disabled' in el)el.disabled=true;else{el.style.pointerEvents='none';el.style.opacity='.5';el.setAttribute('aria-disabled','true');}
  }
 }
}
function apply(data){
 if(!data?.organization||!/^\d{5,20}$/.test(String(data.organization.mondayItemId)))return;
 snapshot=data;
 lockerIdentity={adminRole:null,lockerAccess:[],organizationAccess:[{organization_monday_id:data.organization.mondayItemId,role:'Customer',active:true}]};lockerError='';
 directoryState={loading:false,loaded:true,error:'',organizations:[data.organization],selected:data.organization};
 jobState={loading:false,loaded:true,error:data.errors?.includes('Monday jobs unavailable')?'Monday jobs unavailable':'',jobs:data.jobs||[],organizationId:data.organization.mondayItemId};
 crmLockerQuotes={organizationId:data.organization.mondayItemId,loading:false,loaded:true,quotes:data.quotes||[],error:''};
 crmCustomerLibrary={loaded:true,loading:false,error:'',files:data.library||[]};
 window.goatSeedPreviewProfile?.(data);
 window.goatSeedPreviewInvoices?.(data);
 active='dashboard';render();
}
window.GoatEmbeddedPreview={install(){if(installed)return;installed=true;
 customerToken=()=>snapshot?'crm-preview-render-only':null;
 customerLogin=async()=>{};lockerSignOut=()=>{};
 authMessage=()=>'<div class="notice"><strong>CRM administrator preview</strong><p class="muted">Customer layout · Read-only · No separate customer sign-in</p></div>';
 const original=render;render=function(){if(!snapshot){document.getElementById('content').innerHTML='<div class="panel"><h2>Locker preview</h2><p>Open this preview from your team inside GOAT CRM.</p></div>';return;}original();restrict();};
 const banner=document.createElement('div');banner.style.cssText='position:sticky;top:0;z-index:20000;padding:10px 20px;background:#fff1cc;color:#61420b;font:13px system-ui';banner.id='crm-preview-banner';document.body.prepend(banner);
 const updateBanner=()=>{banner.innerHTML=snapshot?'<strong>'+text(snapshot.organization.name)+' — CUSTOMER PREVIEW</strong> · Read-only snapshot · '+text(new Date(snapshot.asOf).toLocaleString())+(snapshot.errors?.length?'<div>'+snapshot.errors.map(text).join(' · ')+'</div>':''):'Waiting for authorized CRM preview data…';};
 window.addEventListener('message',e=>{if(e.source!==parent||parent===window||e.data?.type!=='goat-crm-locker-preview')return;const ref=document.referrer?new URL(document.referrer).origin:null;if(ref&&e.origin!==ref)return;apply(e.data.payload);updateBanner();});
 document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
 document.addEventListener('click',e=>{if(e.target.closest('[data-crm-preview-blocked]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 updateBanner();render();
}};
})();
