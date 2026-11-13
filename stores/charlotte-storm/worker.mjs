import PAGE from './index.html';
import APP from './app.txt';
const SHOP='186815-4c.myshopify.com';
export const belongs=title=>String(title||'').toLowerCase().includes('charlotte storm aau');
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function graphql(query,variables={},request){
 const headers={'Content-Type':'application/json'};
 const ip=request?.headers.get('CF-Connecting-IP');if(ip)headers['Shopify-Storefront-Buyer-IP']=ip;
 const r=await fetch(`https://${SHOP}/api/2026-10/graphql.json`,{method:'POST',headers,body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok||d.errors?.length)throw Error('Shopify is temporarily unavailable. Please try again.');return d.data;
}
export async function products(request){
 let cursor=null,all=[];
 do{
  const d=await graphql(`query StormProducts($cursor:String){products(first:100,after:$cursor,query:"title:\\"Charlotte Storm AAU\\""){nodes{id title handle availableForSale description productType featuredImage{url altText} variants(first:250){nodes{id title availableForSale price{amount currencyCode} selectedOptions{name value}} pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}}`,{cursor},request);
  const page=d.products;all.push(...page.nodes.filter(p=>belongs(p.title)));cursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
 }while(cursor);
 return all;
}
export async function checkout(request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Please checkout from the Charlotte Storm store.'},403);
 if(Number(request.headers.get('content-length'))>20000)return json({error:'Bag is too large.'},413);
 const text=await request.text();if(text.length>20000)return json({error:'Bag is too large.'},413);
 let body;try{body=JSON.parse(text)}catch{return json({error:'Invalid bag.'},400)}
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)return json({error:'Choose between 1 and 100 items.'},400);
 const lines=body.lines;
 if(lines.some(l=>!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(l.merchandiseId)||!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>99))return json({error:'Invalid item or quantity.'},400);
 // Revalidate title, publication and availability from Shopify at checkout, never trust the browser's catalog.
 const ids=[...new Set(lines.map(l=>l.merchandiseId))];
 const d=await graphql(`query StormVariants($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id availableForSale product{title}}}}`,{ids},request);
 const allowed=new Set(d.nodes.filter(v=>v&&v.availableForSale&&belongs(v.product?.title)).map(v=>v.id));
 if(lines.some(l=>!allowed.has(l.merchandiseId)))return json({error:'An item is no longer available in the Charlotte Storm AAU store. Refresh your bag.'},400);
 const created=await graphql(`mutation StormCart($input:CartInput!){cartCreate(input:$input){cart{checkoutUrl} userErrors{message}}}`,{input:{lines:lines.map(l=>({merchandiseId:l.merchandiseId,quantity:l.quantity})),attributes:[{key:'Team Store',value:'Charlotte Storm AAU'}]}},request);
 const result=created.cartCreate;if(result.userErrors?.length)return json({error:result.userErrors.map(e=>e.message).join(' ')},400);
 if(!result.cart?.checkoutUrl)throw Error('Unable to open checkout. Please try again.');
 return json({checkoutUrl:result.cart.checkoutUrl});
}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 try{
  if(path==='/api/products'&&request.method==='GET')return json({products:await products(request)});
  if(path==='/api/checkout'&&request.method==='POST')return await checkout(request);
  if(path.startsWith('/api/'))return json({error:'Not found'},404);
  if(['GET','HEAD'].includes(request.method)&&['/','/index.html','/app.js'].includes(path))return new Response(request.method==='HEAD'?null:path==='/app.js'?APP:PAGE,{headers:{'Content-Type':path==='/app.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
  return env.ASSETS.fetch(request);
 }catch(e){console.error(JSON.stringify({event:'storm-shopify-error',path,message:e.message}));return json({error:e.message||'Store temporarily unavailable.'},502)}
}};
