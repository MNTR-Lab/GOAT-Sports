const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
async function mondayJobs(){
 const key=Deno.env.get("MONDAY_API_TOKEN");if(!key)throw Error("MONDAY_CONFIG");
 const items=[];
 let cursor=null;
 const seen=new Set();
 do{
  const query=cursor
   ?'query($cursor:String!){next_items_page(limit:500,cursor:$cursor){cursor items{id name column_values{id text value ... on BoardRelationValue{linked_item_ids}}}}}'
   :'query{boards(ids:[18434382163]){items_page(limit:500){cursor items{id name column_values{id text value ... on BoardRelationValue{linked_item_ids}}}}}}';
  const result=await getJson("https://api.monday.com/v2",{method:"POST",headers:{"Authorization":key,"Content-Type":"application/json","API-Version":"2025-10"},body:JSON.stringify({query,variables:cursor?{cursor}:{}})});
  if(result.errors?.length)throw Error("MONDAY_QUERY");
  const page=cursor?result.data?.next_items_page:result.data?.boards?.[0]?.items_page;
  if(!page)throw Error("MONDAY_DATA");
  items.push(...(page.items||[]));
  const next=page.cursor||null;
  if(next&&seen.has(next))throw Error("MONDAY_CURSOR_LOOP");
  if(next)seen.add(next);
  cursor=next;
 }while(cursor);
 return items;
}
const cv=(x,id)=>x.column_values?.find(c=>c.id===id);
const val=(x,id)=>String(cv(x,id)?.text||"").trim();
function related(x){
 const relations=x.column_values?.filter(c=>["board_relation_mm7xkgt6","board_relation_mm7xkhqf"].includes(c.id))||[];
 const ids=new Set();
 for(const c of relations){
  for(const id of c.linked_item_ids||[])ids.add(String(id));
  try{for(const o of JSON.parse(c.value||"{}").linkedPulseIds||[])ids.add(String(o.linkedPulseId));}catch{}
 }
 return ids;
}

Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const configured=Deno.env.get('GOAT_CRM_LOCKER_BRIDGE_SECRET')||'';
 const supplied=req.headers.get('x-goat-bridge-secret')||'';
 if(configured.length<32||supplied!==configured)return reply({error:'Unauthorized'},401);
 try{
  const b=await req.json(),org=String(b.organizationMondayId||''),action=String(b.action||'');
  if(!/^\d{5,20}$/.test(org)||!['list','preview','grant','revoke','reactivate'].includes(action))return reply({error:'Invalid organization or action'},400);
  if(!/^[0-9a-f-]{36}$/i.test(String(b.actor?.id||''))||!String(b.actor?.email||''))return reply({error:'Administrator identity required'},400);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  if(action==='preview'){
   const results=await Promise.allSettled([
    (async()=>{const r=await fetch(url+'/rest/v1/goat_locker_crm_quotes?select=crm_quote_id,quote_number,status,description,total,items,published_at&organization_monday_id=eq.'+org+'&status=in.(sent,approved,changes_requested)&order=published_at.desc',{headers:auth});if(!r.ok)throw Error('Quotes unavailable');return r.json();})(),
    (async()=>{const r=await fetch(url+'/rest/v1/goat_locker_organization_profiles?organization_monday_id=eq.'+org+'&limit=1',{headers:auth});if(!r.ok)throw Error('Profile unavailable');return (await r.json())[0]||{};})(),
    mondayJobs()
   ]);
   const quotes=results[0].status==='fulfilled'?results[0].value:[];
   const profile=results[1].status==='fulfilled'?results[1].value:{};
   const items=results[2].status==='fulfilled'?results[2].value:[];
   const jobs=items.filter((x:any)=>related(x).has(org)).map((x:any)=>({
    id:String(x.id),name:String(x.name),jobId:val(x,'text_mm7xv2st')||String(x.id),
    status:val(x,'color_mm7x2v3r'),productionStatus:val(x,'color_mm7xhebj'),artworkStatus:val(x,'color_mm7x1v7h'),quoteStatus:val(x,'color_mm7x8f5a'),paymentStatus:val(x,'color_mm7xqsr'),targetDate:val(x,'date_mm7xp7z2'),customerNotes:val(x,'long_text_mm7xas82'),quoteNumber:val(x,'text_mm7xa5gq'),invoiceNumber:val(x,'text_mm7x3289'),quoteAmount:val(x,'numeric_mm7xtq7p'),invoiceAmount:val(x,'numeric_mm7xs3yy'),trackingNumber:val(x,'text_mm7xz3na')
   }));
   // Match the customer invoice feed, including its current production-quote filter.
   const invoices=quotes.filter((q:any)=>q.crm_quote_id==='58b31257-3b2e-4c34-a5ef-610af178a581'&&Number(q.total)===500&&q.status==='approved').map((q:any)=>({id:q.crm_quote_id,number:q.quote_number,amount:Number(q.total),currency:'USD',status:'pending_invoice',sentAt:null,paidAt:null,url:null,description:q.description||''}));
   return reply({ok:true,quotes,profile,jobs,invoices,errors:results.flatMap((r:any,i:number)=>r.status==='rejected'?[['Quotes','Organization profile','Monday jobs'][i]+' unavailable']:[]),asOf:new Date().toISOString()});
  }
  const r=await fetch(url+'/rest/v1/rpc/goat_locker_manage_customer_access',{method:'POST',headers:auth,body:JSON.stringify({p_org:org,p_action:action,p_email:String(b.email||''),p_access_id:b.accessId??null,p_actor:b.actor.id,p_actor_email:b.actor.email})});
  const data=await r.json();if(!r.ok)return reply({error:data.message||'Access update failed'},400);
  if(action!=='list')return reply(data);
  const qr=await fetch(url+'/rest/v1/goat_locker_crm_quotes?select=quote_number,status,published_at&organization_monday_id=eq.'+org+'&order=published_at.desc',{headers:auth});
  if(!qr.ok)return reply({error:'Customer quote status unavailable'},503);
  return reply({ok:true,access:data,quotes:await qr.json(),lockerUrl:'https://locker.begoativated.com/',previewUrl:'https://locker.begoativated.com/?previewOrganization='+org});
 }catch(e){return reply({error:String((e as Error).message||e)},500)}
});

