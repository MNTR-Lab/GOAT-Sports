const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const configured=Deno.env.get('GOAT_CRM_LOCKER_BRIDGE_SECRET')||'';
 const supplied=req.headers.get('x-goat-bridge-secret')||'';
 if(configured.length<32||supplied!==configured)return reply({error:'Unauthorized'},401);
 try{
  const b=await req.json(),org=String(b.organizationMondayId||''),action=String(b.action||'');
  if(!/^\d{5,20}$/.test(org)||!['list','grant','revoke','reactivate'].includes(action))return reply({error:'Invalid organization or action'},400);
  if(!/^[0-9a-f-]{36}$/i.test(String(b.actor?.id||''))||!String(b.actor?.email||''))return reply({error:'Administrator identity required'},400);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  const r=await fetch(url+'/rest/v1/rpc/goat_locker_manage_customer_access',{method:'POST',headers:auth,body:JSON.stringify({p_org:org,p_action:action,p_email:String(b.email||''),p_access_id:b.accessId??null,p_actor:b.actor.id,p_actor_email:b.actor.email})});
  const data=await r.json();if(!r.ok)return reply({error:data.message||'Access update failed'},400);
  if(action!=='list')return reply(data);
  const qr=await fetch(url+'/rest/v1/goat_locker_crm_quotes?select=quote_number,status,published_at&organization_monday_id=eq.'+org+'&order=published_at.desc',{headers:auth});
  if(!qr.ok)return reply({error:'Customer quote status unavailable'},503);
  return reply({ok:true,access:data,quotes:await qr.json(),lockerUrl:'https://locker.begoativated.com/',previewUrl:'https://locker.begoativated.com/?previewOrganization='+org});
 }catch(e){return reply({error:String((e as Error).message||e)},500)}
});
