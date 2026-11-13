const SB=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,ANON=Deno.env.get('SUPABASE_ANON_KEY')!;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const out=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function rpc(name:string,body:any,authorization='Bearer '+KEY){const r=await fetch(SB+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.message||'Catalog access failed');return j;}
function productInput(p:any){
 const s=p.settings||{},price=Number(s.price);
 if(s.price===undefined||s.price===null||String(s.price).trim()===''||!Number.isFinite(price)||price<0)throw Error('Enter a selling price in Shopify setup first');
 if(!p.variants?.length||p.variants.length>250)throw Error('Between 1 and 250 variants are required');
 const weight=s.weight===''||s.weight==null?null:Number(s.weight);if(weight!==null&&(!Number.isFinite(weight)||weight<0))throw Error('Invalid shipping weight');
 const unit=s.weight_unit||'OUNCES';if(!['OUNCES','POUNDS','GRAMS','KILOGRAMS'].includes(unit))throw Error('Invalid weight unit');
 const colors=[...new Set(p.variants.map((v:any)=>v.color))],sizes=[...new Set(p.variants.map((v:any)=>v.size))];
 const images=Array.isArray(s.images)?s.images:[];if(images.length>10)throw Error('Use at most 10 product images');
 const files=images.map((image:string)=>{const u=new URL(image);if(u.protocol!=='https:'||u.username||u.password)throw Error('Image URLs must use public HTTPS links');return {originalSource:u.href,contentType:'IMAGE',alt:p.name};});
 return {title:p.name,handle:'crm-gs-'+p.number,status:'DRAFT',vendor:s.vendor||p.brand||'',productType:s.type||p.category,
 descriptionHtml:'<p>'+escapeHtml(String(s.description||'')).replace(/\n/g,'<br>')+'</p>',
 tags:['CRM-CATALOG','CRM-CATALOG-'+p.id,p.form,...String(s.tags||'').split(',').map((x:string)=>x.trim()).filter(Boolean)].slice(0,50),
 productOptions:[{name:'Color',position:1,values:colors.map(name=>({name}))},{name:'Size',position:2,values:sizes.map(name=>({name}))}],
 variants:p.variants.map((v:any)=>({sku:v.sku,price:price.toFixed(2),taxable:s.taxable!==false,optionValues:[{optionName:'Color',name:v.color},{optionName:'Size',name:v.size}],inventoryPolicy:'DENY',inventoryItem:{tracked:!!s.tracked,requiresShipping:s.shipping!==false,...(weight!==null?{measurement:{weight:{value:weight,unit}}}:{})}})),...(files.length?{files}:{})};
}
async function connectShopify(){
  const shop=Deno.env.get('SHOPIFY_SHOP_DOMAIN')||'';const clientId=Deno.env.get('GOAT_SHOPIFY_CLIENT_ID');const clientSecret=Deno.env.get('GOAT_SHOPIFY_CLIENT_SECRET');
  if(!shop.endsWith('.myshopify.com')||!clientId||!clientSecret)throw Error('Shopify connection is not configured');
  const tr=await fetch('https://'+shop+'/admin/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret})});const tj=await tr.json();if(!tr.ok||!tj.access_token)throw Error('Shopify authentication failed');
  const graphql=async(query:string,variables:any)=>{const r=await fetch('https://'+shop+'/admin/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':tj.access_token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(90000)});const j=await r.json();if(!r.ok||j.errors?.length)throw Error('Shopify: '+JSON.stringify(j.errors||r.status).slice(0,600));return j.data;};
 return {shop,graphql};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return out({error:'Method not allowed'},405);
 let id='',claimed=false,sent=false;
 try{
  const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return out({error:'Sign in required'},401);
  const body=await req.json();
  const u=await fetch(SB+'/auth/v1/user',{headers:{apikey:ANON,Authorization:authorization}});
  if(body.action==='check_connection'){
   if(u.ok)await rpc('crm_product_catalog',{p_action:'presets'},authorization);
   else await rpc('crm_catalog_shopify_state',{p_id:'00000000-0000-0000-0000-000000000000',p_state:'claim'},authorization);
   const {shop,graphql}=await connectShopify();
   const data=await graphql('query {currentAppInstallation{accessScopes{handle}}}',{});
   const scopes=data.currentAppInstallation?.accessScopes?.map((x:any)=>x.handle)||[];
   return out({ok:scopes.includes('write_products'),shop,canCreateDraftProducts:scopes.includes('write_products')});
  }
  if(!u.ok)return out({error:'CRM sign-in expired'},401);
  id=String(body.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return out({error:'Invalid product'},400);
  const p=await rpc('crm_product_catalog',{p_action:'get',p_payload:{id}},authorization);if(!p)return out({error:'Product not found'},404);
  if(p.shopify_id)return out({ok:true,id:p.shopify_id,url:p.shopify_url,existing:true});
  const input=productInput(p);
  claimed=await rpc('crm_catalog_shopify_state',{p_id:id,p_state:'claim'});if(!claimed)return out({error:'Shopify synchronization is already in progress. Refresh this record before retrying.'},409);
  const {shop,graphql}=await connectShopify();
  const found=await graphql('query Existing($q:String!){products(first:2,query:$q){nodes{id handle tags status}}}',{q:'handle:'+input.handle});
  const matches=found.products?.nodes||[];let product=matches[0];
  if(matches.length>1||product&&!product.tags.includes('CRM-CATALOG-'+id))throw Error('The Shopify handle is already used by another product. No product was changed.');
  if(!product){sent=true;const data=await graphql('mutation Draft($input:ProductSetInput!){productSet(input:$input,synchronous:true){product{id status} userErrors{field message}}}',{input});const result=data.productSet;if(result.userErrors?.length)throw Error(result.userErrors.map((x:any)=>x.message).join('; '));product=result.product;if(!product?.id)throw Error('Shopify did not return a product ID');}
  const url='https://'+shop+'/admin/products/'+product.id.split('/').pop();
  await rpc('crm_catalog_shopify_state',{p_id:id,p_state:'created',p_shopify_id:product.id,p_url:url});
  return out({ok:true,id:product.id,url,status:product.status,existing:!sent});
 }catch(e){const error=String((e as Error).message||e);if(claimed)await rpc('crm_catalog_shopify_state',{p_id:id,p_state:sent?'uncertain':'error',p_error:error}).catch(()=>{});return out({error},400);}
});
