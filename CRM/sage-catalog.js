/* GOAT quote catalog: reuse the existing read-only SAGE connection. */
(() => {
 'use strict';
 const get = id => document.getElementById(id);
 const panel = get('qbSageCatalog');
 if (!panel) return;
 const endpoint = 'https://qpavspvpdebtbbffdcmo.supabase.co/functions/v1/ai-apparel-sage-products';
 let products = [], visible = 30, selected = null, detail = null, breaks = [], epoch = 0, controller = null, priceEdited = false;
 const money = value => Number(value).toLocaleString('en-US',{style:'currency',currency:'USD'});
 const numeric = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).replace(/[$,]/g,'').trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
 };
 const imageUrl = value => {try {const u=new URL(String(value));return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
 const message = (value,bad=false) => {get('sageMessage').textContent=value;get('sageMessage').classList.toggle('error',bad)};
 function tab(source) {
  for (const button of document.querySelectorAll('[data-goat-catalog]')) {
   const active=button.dataset.goatCatalog===source;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  }
  get('qbShopifyCatalog').classList.toggle('hidden',source!=='shopify');
  panel.classList.toggle('hidden',source!=='sage');
 }
 for(const button of document.querySelectorAll('[data-goat-catalog]')){
  button.addEventListener('click',()=>tab(button.dataset.goatCatalog));
  button.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'shopify':e.key==='End'?'sage':button.dataset.goatCatalog==='sage'?'shopify':'sage';tab(next);document.querySelector('[data-goat-catalog="'+next+'"]').focus()}});
 }
 async function request(params,signal) {
  const r=await fetch(endpoint+'?'+new URLSearchParams(params),{signal});
  const data=await r.json();
  if(!r.ok||!data.ok)throw Error(data.error||data.errMsg||'SAGE catalog could not be loaded');
  return data;
 }
 function renderResults() {
  get('sageResults').innerHTML=products.slice(0,visible).map((p,i)=>{
   const image=imageUrl(p.image);
   return '<article class="catalog-product">'+(image?'<img loading="lazy" src="'+escapeHTML(image)+'" alt="">':'')+
   '<h4>'+escapeHTML(p.name||'Promotional product')+'</h4><small>'+escapeHTML(p.code||p.id||'')+'</small>'+
   '<small>Catalog price: '+escapeHTML(p.price||'Request pricing')+'</small>'+
   '<button class="btn small" type="button" data-sage-view="'+i+'">View details &amp; pricing</button></article>';
  }).join('');
  get('sageMore').classList.toggle('hidden',visible>=products.length);
 }
 async function search() {
  const query=get('sageQuery').value.trim();
  if(query.length<2){message('Enter at least 2 characters.',true);return}
  if(controller)controller.abort();controller=new AbortController();const current=++epoch;
  get('sageSearch').disabled=true;get('sageResults').replaceChildren();get('sageDetail').classList.add('hidden');get('sageMore').classList.add('hidden');
  selected=null;products=[];message('Searching SAGE catalog…');
  try{
   const data=await request({q:query},controller.signal);if(current!==epoch)return;
   products=Array.isArray(data.products)?data.products.filter(p=>p&&p.id):[];visible=30;renderResults();
   message(products.length?'Showing '+Math.min(visible,products.length)+' of '+products.length+' results. Refine your search or view more products.':'No matching products. Try another item name or product code.');
  }catch(e){if(e.name!=='AbortError'&&current===epoch)message(e.message+'. You can still add a custom product.',true)}
  finally{if(current===epoch)get('sageSearch').disabled=false}
 }
 function tierFor(quantity) {return breaks.filter(b=>b.qty<=quantity).at(-1)||breaks[0]}
 function updateReference() {
  const quantity=Number(get('sageQuantity').value),tier=tierFor(quantity);
  if(!priceEdited&&tier)get('sageSellingPrice').value=tier.price.toFixed(2);
  get('sageQuantityNote').textContent=breaks.length&&quantity<breaks[0].qty?'Catalog pricing starts at '+breaks[0].qty+' units. Confirm lower-quantity pricing with the supplier.':'Confirm decoration, setup and freight before saving.';
 }
 function showDetail() {
  const d=detail||{},p=selected;
  const qty=Array.isArray(d.qty)?d.qty:[],prices=Array.isArray(d.prc)?d.prc:[];
  breaks=prices.map((price,i)=>({price:numeric(price),qty:Number(qty[i])})).filter(b=>b.price!==null&&Number.isInteger(b.qty)&&b.qty>0).sort((a,b)=>a.qty-b.qty);
  const colors=String(d.colors||'').split(',').map(c=>c.trim()).filter(Boolean);
  const name=d.prName||d.name||p.name||'Promotional product';
  const code=d.itemNum||d.itemNumber||d.spc||p.code||'';
  const initial=breaks[0]||{qty:1,price:numeric(p.price)??0};
  const notes=[d.lineName?'Catalog line: '+d.lineName:'',d.priceIncludes?'Price includes: '+d.priceIncludes:'',d.setupChg?'Catalog setup charge: '+d.setupChg:'',d.prodTime?'Production: '+d.prodTime:''].filter(Boolean);
  get('sageDetail').innerHTML='<h4>'+escapeHTML(name)+'</h4><p class="muted">'+escapeHTML(code)+'</p>'+
   (d.description?'<p class="sage-description">'+escapeHTML(d.description)+'</p>':'')+
   (notes.length?'<p class="sage-reference">'+notes.map(escapeHTML).join('<br>')+'</p>':'')+
   '<div class="sage-fields">'+
   '<label class="field"><span>Catalog quantity pricing</span><select id="sageTier"><option value="">Custom quantity / price</option>'+breaks.map((b,i)=>'<option value="'+i+'">'+b.qty+'+ units · '+money(b.price)+' each</option>').join('')+'</select></label>'+
   '<label class="field"><span>Color / variation</span><input id="sageColor" maxlength="100" list="sageColors" placeholder="Enter color or variation"><datalist id="sageColors">'+colors.map(c=>'<option value="'+escapeHTML(c)+'"></option>').join('')+'</datalist></label>'+
   '<label class="field"><span>Quote quantity</span><input id="sageQuantity" type="number" min="1" max="100000" step="1" value="'+initial.qty+'"></label>'+
   '<label class="field"><span>Your unit selling price ($)</span><input id="sageSellingPrice" type="number" min="0" max="100000000" step=".01" value="'+initial.price.toFixed(2)+'"></label></div>'+
   '<p id="sageQuantityNote" class="catalog-message"></p><button class="btn small" id="sageAdd" type="button">+ Add to quote</button>';
  get('sageDetail').classList.remove('hidden');priceEdited=false;get('sageTier').value=breaks.length?'0':'';
  get('sageTier').addEventListener('change',()=>{
   const i=get('sageTier').value;if(i==='')return;const b=breaks[Number(i)];if(!b)return;
   get('sageQuantity').value=b.qty;get('sageSellingPrice').value=b.price.toFixed(2);priceEdited=false;updateReference();
  });
  get('sageQuantity').addEventListener('input',updateReference);
  get('sageSellingPrice').addEventListener('input',()=>{priceEdited=true;get('sageTier').value=''});
  get('sageAdd').addEventListener('click',add);
  updateReference();
 }
 async function view(index) {
  const p=products[index];if(!p)return;
  if(controller)controller.abort();controller=new AbortController();const current=++epoch;
  selected=p;detail=null;get('sageDetail').classList.add('hidden');message('Loading SAGE product details…');
  try {
   const data=await request({productId:String(p.id)},controller.signal);if(current!==epoch)return;
   detail=data.product?.product||data.product||{};showDetail();message('Choose quantity and selling price, then add this product to your GOAT quote.');
  }catch(e){if(e.name!=='AbortError'&&current===epoch){showDetail();message('Detailed pricing is unavailable. Confirm the quantity and selling price before adding.',true)}}
 }
 function add() {
  if(!selected)return;
  const qty=Number(get('sageQuantity').value),price=numeric(get('sageSellingPrice').value),color=get('sageColor').value.trim();
  if(!Number.isInteger(qty)||qty<1||qty>100000||price===null||price>100000000){message('Enter a whole-number quantity and a valid nonnegative selling price.',true);return}
  const d=detail||{},name=d.prName||d.name||selected.name||'Promotional product';
  const code=d.itemNum||d.itemNumber||d.spc||selected.code||'';
  const line={name:(name+(code?' · '+code:'')+(color?' — '+color:'')).slice(0,200),qty,price,
   source:'sage',sage_product_id:String(selected.id),sage_product_code:String(selected.code||''),sku:String(code),variant:color,
   shopify_product_id:null,shopify_variant_id:null};
  qbLines=qbLines.filter(r=>String(r.name||'').trim()||Number(r.price)>0);qbLines.push(line);qbDrawLines();
  message('Added '+name+' to this GOAT quote. Quantity and selling price can be edited below.');
  const last=get('qbItems').querySelector('tr:last-child');last?.querySelector('[data-qfield="price"]')?.focus();
 }
 window.goatSageReset=()=>{
  ++epoch;if(controller)controller.abort();products=[];selected=null;detail=null;breaks=[];priceEdited=false;
  get('sageQuery').value='';get('sageResults').replaceChildren();get('sageDetail').replaceChildren();get('sageDetail').classList.add('hidden');get('sageMore').classList.add('hidden');get('sageSearch').disabled=false;
  message('Search promotional products by keyword or product code. Catalog prices are references; confirm your selling price.');tab('shopify');
 };
 get('sageSearch').addEventListener('click',search);
 get('sageQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search()}});
 get('sageResults').addEventListener('click',e=>{const button=e.target.closest('[data-sage-view]');if(button)view(Number(button.dataset.sageView))});
 get('sageMore').addEventListener('click',()=>{visible+=30;renderResults();message('Showing '+Math.min(visible,products.length)+' of '+products.length+' results.')});
 get('quoteDialog').addEventListener('close',()=>window.goatSageReset());
})();
