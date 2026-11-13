const SB=Deno.env.get('SUPABASE_URL')||'https://lbheezjanvalalinqxcd.supabase.co';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
const ORG='c8746565-e4e4-438a-b7a1-2a5ea015e0b3';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const headers={apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'};
const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function db(path:string,opts:RequestInit={}){const r=await fetch(SB+'/rest/v1/'+path,{...opts,headers:{...headers,...(opts.headers||{})}});const j=await r.json().catch(()=>null);if(!r.ok)throw Error(j?.message||j?.details||'Database request failed');return j;}
async function admin(req:Request){const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!jwt)throw Error('Sign in required');const r=await fetch(SB+'/auth/v1/user',{headers:{apikey:ANON,Authorization:'Bearer '+jwt}});if(!r.ok)throw Error('Session expired');const user=await r.json();const m=await db('memberships?select=role&organization_id=eq.'+ORG+'&user_id=eq.'+encodeURIComponent(user.id));if(!m.some((x:any)=>['admin','owner','super_admin'].includes(x.role)))throw Error('GOAT administrator access required');return user;}
function shopDomain(){const raw=(Deno.env.get('SHOPIFY_SHOP_DOMAIN')||'').trim();const host=raw.replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(!host.endsWith('.myshopify.com'))throw Error('SHOPIFY_SHOP_DOMAIN must be the .myshopify.com domain');return host;}
async function shopToken(domain:string){const id=Deno.env.get('GOAT_SHOPIFY_CLIENT_ID')||'';const secret=Deno.env.get('GOAT_SHOPIFY_CLIENT_SECRET')||'';if(!id||!secret)throw Error('GOAT Shopify credentials missing');const r=await fetch('https://'+domain+'/admin/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.access_token)throw Error('Shopify authentication failed: '+(j.error_description||j.error||r.status));return j.access_token as string;}
async function shopGraphql(domain:string,token:string,query:string,variables:any){const r=await fetch('https://'+domain+'/admin/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});const j=await r.json().catch(()=>({}));if(!r.ok||j.errors?.length)throw Error('Shopify API error: '+JSON.stringify(j.errors||j).slice(0,800));return j.data;}
const gid=(id:any)=>id==null?null:String(id).startsWith('gid://')?String(id):'gid://shopify/ProductVariant/'+String(id);
function draftLines(snapshot:any){const items=snapshot.line_items;if(!Array.isArray(items)||!items.length)throw Error('Approved quote has no line items');return items.map((v:any)=>{const quantity=Number(v.qty??v.quantity??1),price=Number(v.price??v.unit_price??0);if(!Number.isInteger(quantity)||quantity<1||!Number.isFinite(price)||price<0)throw Error('Invalid quantity or price in approved quote');const title=String(v.name||v.title||v.description||'Custom merchandise').slice(0,255);/* Use custom line items to preserve customer-approved prices exactly; variant IDs remain in the quote snapshot. */return {title,quantity,originalUnitPrice:price.toFixed(2),requiresShipping:true,taxable:true};});}
async function syncDraft(quoteId:string,snapshot:any){
 const existing=await db('goat_quote_shopify_drafts?select=*&quote_id=eq.'+quoteId);
 if(existing[0]?.status==='created'&&existing[0].shopify_draft_id)return {status:'created',draft_id:existing[0].shopify_draft_id};
 if(existing[0]?.status==='creating'||existing[0]?.status==='needs_reconciliation')throw Error('Draft order requires reconciliation before retry; no duplicate was created');
 const stamp=new Date().toISOString();
 if(!existing.length){try{await db('goat_quote_shopify_drafts',{method:'POST',body:JSON.stringify({quote_id:quoteId,organization_id:ORG,status:'creating',attempt_count:1,updated_at:stamp})});}catch{throw Error('Draft tracking already exists. Check its status before retrying');}}
 else {const changed=await db('goat_quote_shopify_drafts?quote_id=eq.'+quoteId+'&status=in.(pending,failed)',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'creating',last_error:null,attempt_count:existing[0].attempt_count+1,updated_at:stamp})});if(!changed.length)throw Error('Draft creation is already underway');}
 let sent=false;
 try{
  const domain=shopDomain(),token=await shopToken(domain);
  const tag='GQ-'+quoteId.replace(/-/g,'').slice(0,24);
  const prior=await shopGraphql(domain,token,'query Existing($q:String!){draftOrders(first:10,query:$q){nodes{id name invoiceUrl}}}',{q:'tag:'+tag});
  const matches=prior?.draftOrders?.nodes||[];
  if(matches.length>1)throw Error('Multiple Shopify drafts match this quote; reconcile before retry');
  if(matches.length===1){const d=matches[0];await db('goat_quote_shopify_drafts?quote_id=eq.'+quoteId,{method:'PATCH',body:JSON.stringify({status:'created',shopify_draft_id:d.id,shopify_draft_name:d.name,shopify_draft_url:d.invoiceUrl,last_error:null,updated_at:new Date().toISOString()})});return {status:'created',draft_id:d.id};}
  const lineItems=draftLines(snapshot);
  const subtotal=lineItems.reduce((sum:any,l:any)=>sum+Math.round(Number(l.originalUnitPrice)*l.quantity*100),0)/100;
  if(Math.abs(subtotal-Number(snapshot.amount))>0.005)throw Error('Approved total does not match line items; pricing review required');
  const email=String(snapshot.customer_email||'').trim();if(!email)throw Error('Approved quote has no customer email');
  const amount=Number(snapshot.discount_amount||0);if(amount>0)throw Error('Quote has a discount. Manual review required before Shopify creation to preserve approved total');
  if(Number(snapshot.tax_rate||0)>0)throw Error('Quote has an explicit tax rate. Manual review required before Shopify creation to avoid tax mismatch');
  const input={email,lineItems,note:'GOAT CRM approved quote '+String(snapshot.quote_number||quoteId)+' | CRM quote ID: '+quoteId,tags:['GOAT-CRM','GQ-'+quoteId.replace(/-/g,'').slice(0,24)]};
  sent=true;
  const data=await shopGraphql(domain,token,`mutation CreateDraft($input:DraftOrderInput!){draftOrderCreate(input:$input){draftOrder{id name invoiceUrl totalPriceSet{shopMoney{amount currencyCode}}}userErrors{field message}}}`,{input});
  const result=data?.draftOrderCreate;
  if(result?.userErrors?.length)throw Error(result.userErrors.map((e:any)=>e.message).join('; '));
  const d=result?.draftOrder;if(!d?.id)throw Error('Shopify returned no draft order ID');
  await db('goat_quote_shopify_drafts?quote_id=eq.'+quoteId,{method:'PATCH',body:JSON.stringify({status:'created',shopify_draft_id:d.id,shopify_draft_name:d.name||null,shopify_draft_url:d.invoiceUrl||null,last_error:null,updated_at:new Date().toISOString()})});
  return {status:'created',draft_id:d.id};
 }catch(e){const message=String((e as Error).message||e);await db('goat_quote_shopify_drafts?quote_id=eq.'+quoteId,{method:'PATCH',body:JSON.stringify({status:sent?'needs_reconciliation':'failed',last_error:message,updated_at:new Date().toISOString()})}).catch(()=>{});throw Error(message);}
}

const BOARD='18434382163';
async function monday(query:string,variables:any={}){
 const key=Deno.env.get('GOAT_MONDAY_API_TOKEN')||Deno.env.get('MONDAY_API_TOKEN')||'';
 if(!key)throw Error('Monday API token missing');
 const r=await fetch('https://api.monday.com/v2',{method:'POST',headers:{Authorization:key,'Content-Type':'application/json','API-Version':'2025-10'},body:JSON.stringify({query,variables})});
 const j=await r.json();if(!r.ok||j.errors?.length)throw Error('Monday: '+JSON.stringify(j.errors||r.status).slice(0,500));return j.data;
}
function jobPlacement(status:string){
 if(status==='archived')return {group:'group_mm7xjdqa',label:'Completed'};
 if(status==='completed')return {group:'group_mm7x1729',label:'Completed'};
 if(status==='cancelled')return {group:'group_mm7xjdqa',label:'Cancelled'};
 if(status==='awaiting_approval')return {group:'group_mm7xh2y9',label:'Awaiting Customer'};
 if(status==='in_production')return {group:'group_mm7xf6px',label:'Production'};
 if(status==='approved')return {group:'group_mm7xf6px',label:'Ready / Shipping'};
 if(status==='on_hold')return {group:'topics',label:'On Hold'};
 return {group:'topics',label:'Quote Approved'};
}

function terminal(value:any){return /^(complete(?:d)?|delivered|fulfilled)(?:$|\s*[-–—:/])/i.test(String(value||'').trim());}
function paymentLabel(order:any){return order?.displayFinancialStatus==='PAID'?'Paid':order?.displayFinancialStatus==='PARTIALLY_PAID'?'Partial Payment':order?.displayFinancialStatus==='PENDING'?'Invoiced':null;}
async function mondayJobs(){
 let cursor:any=null,items:any[]=[];
 do{
  const data=cursor?await monday('query Next($cursor:String!){next_items_page(limit:100,cursor:$cursor){cursor items{id group{id} column_values(ids:["text_mm7xv2st","color_mm7x2v3r","color_mm7xhebj"]){id text}}}}',{cursor}):await monday('query {boards(ids:[18434382163]){items_page(limit:100){cursor items{id group{id} column_values(ids:["text_mm7xv2st","color_mm7x2v3r","color_mm7xhebj"]){id text}}}}}');
  const page=cursor?data.next_items_page:data.boards?.[0]?.items_page;
  items.push(...(page?.items||[]));cursor=page?.cursor;
 }while(cursor);
 return items;
}
const column=(item:any,id:string)=>item?.column_values?.find((c:any)=>c.id===id)?.text||'';
async function reconcileCompletion(jobs:any[],drafts:any[],results:any){
 // Resolve exact saved draft IDs to orders. A completed draft alone is NOT fulfillment.
 const ids=[...new Set(drafts.filter((d:any)=>d.status==='created'&&d.shopify_draft_id).map((d:any)=>d.shopify_draft_id))];
 const orders=new Map();
 if(ids.length){
  const domain=shopDomain(),token=await shopToken(domain);
  for(let i=0;i<ids.length;i+=50){
   const data=await shopGraphql(domain,token,'query Completion($ids:[ID!]!){nodes(ids:$ids){... on DraftOrder{id order{id displayFinancialStatus displayFulfillmentStatus}}}}',{ids:ids.slice(i,i+50)});
   for(const d of data.nodes||[])if(d?.id&&d.order)orders.set(d.id,d.order);
  }
 }
 const items=await mondayJobs();
 for(const job of jobs){
  const draft=drafts.find((d:any)=>d.quote_id===job.quote_id);
  const order=orders.get(draft?.shopify_draft_id);job.shopifyOrder=order;
  const item=items.find((item:any)=>column(item,'text_mm7xv2st')===job.job_number);
  const finished=order?.displayFulfillmentStatus==='FULFILLED'||terminal(column(item,'color_mm7x2v3r'))||terminal(column(item,'color_mm7xhebj'));
  if(finished&&!['completed','archived'].includes(job.status)){
   // Conditional update cannot reopen or overwrite an administrator's concurrent change.
   const changed=await db('goat_crm_jobs?id=eq.'+job.id+'&organization_id=eq.'+ORG+'&status=eq.'+job.status,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'completed',updated_at:new Date().toISOString()})});
   if(changed.length){job.status='completed';results.completed.push(job.job_number);}
  }
  // Recheck Monday state even if our previous outgoing hash is unchanged.
  job.mondayDrift=!!item&&(column(item,'color_mm7x2v3r')!==jobPlacement(job.status).label||item.group?.id!==jobPlacement(job.status).group);
 }
 // Shopify imports are separate records too; completed jobs must leave Active Jobs.
 for(const item of items){
  if(!column(item,'text_mm7xv2st').startsWith('SHOPIFY-'))continue;
  if((terminal(column(item,'color_mm7x2v3r'))||terminal(column(item,'color_mm7xhebj')))&&item.group?.id!=='group_mm7x1729'){
   await monday('mutation Close($item:ID!,$values:JSON!){change_multiple_column_values(board_id:18434382163,item_id:$item,column_values:$values){id} move_item_to_group(item_id:$item,group_id:"group_mm7x1729"){id}}',{item:item.id,values:JSON.stringify({color_mm7x2v3r:{label:'Completed'}})});
  }
 }
}

async function syncMondayJob(job:any,q:any,map:any,draft:any){
 if(!map||map.status!=='verified'||!q.business_client_id)throw Error('Verified team Locker mapping required');
 const placement=jobPlacement(job.status);
 const vals:any={
  text_mm7xv2st:job.job_number,text_mm7xa5gq:q.quote_number,
  numeric_mm7xtq7p:String(q.amount),color_mm7x8f5a:{label:q.status==='approved'?'Approved':q.status==='sent'?'Sent':'Preparing'},
  color_mm7x2v3r:{label:placement.label},
  board_relation_mm7xkgt6:{item_ids:[Number(map.locker_organization_monday_id)]},
  long_text_mm7xh2ng:{text:(q.line_items||[]).map((l:any)=>(l.name||l.description||'Item')+' × '+(l.qty??l.quantity??1)).join('\n').slice(0,10000)}
 };
 if(draft?.status==='created'){
  vals.text_mm7yts4q=draft.shopify_draft_name;
  vals.link_mm7yx9mf={url:'https://'+shopDomain()+'/admin/draft_orders/'+draft.shopify_draft_id.split('/').pop(),text:'Open '+draft.shopify_draft_name};
  if(draft.shopify_draft_url)vals.link_mm7yddhe={url:draft.shopify_draft_url,text:'Shopify payment link'};
 }
 const payment=paymentLabel(job.shopifyOrder);
 if(payment)vals.color_mm7xqsr={label:payment};
 // Fulfilled means work complete; it does not establish carrier delivery or payment.
 const hash=await hex(JSON.stringify({vals,group:placement.group,title:job.title}));
 const tracking=(await db('goat_crm_monday_job_sync?job_id=eq.'+job.id))[0];
 if(tracking?.payload_hash===hash&&!tracking.last_error&&!job.mondayDrift)return false;
 let item=tracking?.monday_item_id;
 if(!item){
  const found=await monday('query Find($board:ID!,$value:String!){items_page_by_column_values(board_id:$board,columns:[{column_id:"text_mm7xv2st",column_values:[$value]}],limit:10){items{id}}}',{board:BOARD,value:job.job_number});
  const items=found?.items_page_by_column_values?.items||[];if(items.length>1)throw Error('Multiple Monday jobs match '+job.job_number);item=items[0]?.id;
 }
 if(!item){
  const result=await monday('mutation Create($board:ID!,$group:String!,$name:String!,$values:JSON!){create_item(board_id:$board,group_id:$group,item_name:$name,column_values:$values){id}}',{board:BOARD,group:placement.group,name:job.title,values:JSON.stringify(vals)});
  item=result?.create_item?.id;if(!item)throw Error('Monday returned no item ID');
 }else{
  await monday('mutation Update($board:ID!,$item:ID!,$values:JSON!){change_multiple_column_values(board_id:$board,item_id:$item,column_values:$values){id}}',{board:BOARD,item,values:JSON.stringify(vals)});
  await monday('mutation Move($item:ID!,$group:String!){move_item_to_group(item_id:$item,group_id:$group){id}}',{item,group:placement.group});
 }
 await db('goat_crm_monday_job_sync?on_conflict=job_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({job_id:job.id,monday_item_id:item,payload_hash:hash,last_error:null,updated_at:new Date().toISOString()})});
 return true;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return out({error:'Method not allowed'},405);
 // PostgREST verifies the JWT, and this RPC is executable only by service_role.
 // Valid rotated service credentials need not equal the runtime's current key.
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return out({error:'Unauthorized'},401);
 const owner=crypto.randomUUID();
 const auth=await fetch(SB+'/rest/v1/rpc/goat_workflow_sync_lease',{method:'POST',headers:{apikey:ANON,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({p_owner:owner})});
 if(!auth.ok)return out({error:'Unauthorized'},401);
 const locked=await auth.json();
 if(!locked)return out({ok:true,busy:true});
 const results:any={shopify:[],monday:[],completed:[],errors:[]};
 try{
  const pending=await db('goat_crm_approval_sync?state=in.(pending,error)&order=updated_at.asc&limit=10');
  for(const task of pending){
   try{
    const q=(await db('goat_crm_quotes?organization_id=eq.'+ORG+'&id=eq.'+task.quote_id))[0];
    if(!q||q.status!=='approved')throw Error('Quote is no longer approved');
    // Do not invoice a modified quote against an older approval snapshot.
    for(const field of ['line_items','amount','customer_email','business_client_id','discount_amount','tax_rate']){
     if(JSON.stringify(q[field])!==JSON.stringify(task.snapshot[field]))throw Error('Quote changed since approval; pricing review required');
    }
    const draft=await syncDraft(q.id,task.snapshot);
    await db('goat_crm_approval_sync?quote_id=eq.'+q.id,{method:'PATCH',body:JSON.stringify({state:'delivered',last_error:null,updated_at:new Date().toISOString()})});
    results.shopify.push({quote:q.quote_number,...draft});
   }catch(e){const error=String((e as Error).message||e);results.errors.push({quote:task.quote_id,error});await db('goat_crm_approval_sync?quote_id=eq.'+task.quote_id,{method:'PATCH',body:JSON.stringify({state:'error',last_error:error,updated_at:new Date().toISOString()})});}
  }
  const [jobs,quotes,maps,drafts]=await Promise.all([
   db('goat_crm_jobs?organization_id=eq.'+ORG+'&quote_id=not.is.null&order=created_at.asc&limit=1000'),
   db('goat_crm_quotes?organization_id=eq.'+ORG+'&limit=1000'),
   db('goat_crm_locker_mapping?crm_organization_id=eq.'+ORG+'&status=eq.verified'),
   db('goat_quote_shopify_drafts?organization_id=eq.'+ORG)
  ]);
  await reconcileCompletion(jobs,drafts,results);
  for(const job of jobs){
   const q=quotes.find((q:any)=>q.id===job.quote_id);if(!q?.business_client_id)continue;
   const map=maps.find((m:any)=>m.crm_client_id===q.business_client_id);if(!map)continue;
   try{if(await syncMondayJob(job,q,map,drafts.find((d:any)=>d.quote_id===q.id)))results.monday.push(q.quote_number);}
   catch(e){const error=String((e as Error).message||e);results.errors.push({job:job.job_number,error});await db('goat_crm_monday_job_sync?on_conflict=job_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({job_id:job.id,last_error:error,updated_at:new Date().toISOString()})});}
  }
  return out({ok:results.errors.length===0,...results});
 }catch(e){return out({error:String((e as Error).message||e)},500)}
 finally{await db('rpc/goat_workflow_sync_lease',{method:'POST',body:JSON.stringify({p_owner:owner,p_release:true})}).catch(()=>{});}
});
