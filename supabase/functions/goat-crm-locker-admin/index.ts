const ORG='c8746565-e4e4-438a-b7a1-2a5ea015e0b3';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return reply({error:'Sign in required'},401);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const ur=await fetch(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}});if(!ur.ok)return reply({error:'CRM session expired'},401);
  const user=await ur.json();if(!user?.id||!user.email)return reply({error:'CRM session expired'},401);
  const auth={apikey:key,Authorization:'Bearer '+key};
  const mr=await fetch(url+'/rest/v1/memberships?select=role&organization_id=eq.'+ORG+'&user_id=eq.'+encodeURIComponent(user.id),{headers:auth});
  const members=mr.ok?await mr.json():[];
  if(!members.some((m:any)=>['owner','admin','super_admin'].includes(m.role)))return reply({error:'GOAT administrator access required'},403);
  const b=await req.json(),action=String(b.action||'list'),clientId=String(b.clientId||'');
  if(!['list','preview','grant','revoke','reactivate'].includes(action)||!/^[0-9a-f-]{36}$/i.test(clientId))return reply({error:'Invalid team or action'},400);
  const cr=await fetch(url+'/rest/v1/goat_crm_clients?select=id,name,inactive&organization_id=eq.'+ORG+'&id=eq.'+clientId,{headers:auth});
  const client=cr.ok?(await cr.json())[0]:null;if(!client||client.inactive)return reply({error:'Active GOAT team not found'},404);
  const lr=await fetch(url+'/rest/v1/goat_crm_locker_mapping?select=locker_organization_monday_id,status&crm_organization_id=eq.'+ORG+'&crm_client_id=eq.'+clientId,{headers:auth});
  const mappings=lr.ok?await lr.json():[];const mapping=mappings.length===1?mappings[0]:null;
  if(!mapping||mapping.status!=='verified')return reply({error:'Verify this team’s Locker organization connection first.'},409);
  const secret=Deno.env.get('GOAT_CRM_LOCKER_BRIDGE_SECRET')||'';if(secret.length<32)return reply({error:'Locker management connection is not configured'},503);
  const br=await fetch('https://qpavspvpdebtbbffdcmo.supabase.co/functions/v1/goat-locker-admin-bridge',{method:'POST',headers:{'Content-Type':'application/json','x-goat-bridge-secret':secret},body:JSON.stringify({action,organizationMondayId:mapping.locker_organization_monday_id,email:String(b.email||''),accessId:b.accessId??null,actor:{id:user.id,email:user.email}})});
  const result=await br.json();if(!br.ok)return reply({error:result.error||'Locker management unavailable'},br.status);
  if(action==='preview'){
   result.library=[];
   try{
    const ar=await fetch(url+'/rest/v1/goat_locker_artwork_library?select=id,title,file_name,storage_path,artwork_type,created_at,version&organization_id=eq.'+ORG+'&crm_client_id=eq.'+client.id+'&status=eq.active&order=created_at.desc&limit=100',{headers:auth});
    if(!ar.ok)throw Error('Shared artwork unavailable');
    for(const a of await ar.json()){
     const sr=await fetch(url+'/storage/v1/object/sign/goat-customer-artwork/'+a.storage_path,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
     const signed=await sr.json();if(sr.ok&&signed.signedURL){result.library.push({id:a.id,title:a.title,file_name:a.file_name,artwork_type:a.artwork_type,created_at:a.created_at,version:a.version,url:new URL(signed.signedURL.startsWith('/storage/v1/')?signed.signedURL:'/storage/v1/'+signed.signedURL.split('/').filter(Boolean).join('/'),url).href});}
    }
   }catch{result.errors=[...(result.errors||[]),'Shared artwork unavailable'];}
  }
  return reply({...result,client:{id:client.id,name:client.name},organizationMondayId:mapping.locker_organization_monday_id});
 }catch(e){return reply({error:'Locker management failed: '+String((e as Error).message||e)},500)}
});

