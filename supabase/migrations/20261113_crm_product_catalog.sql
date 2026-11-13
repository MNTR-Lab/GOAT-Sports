create schema if not exists sku_catalog;
revoke all on schema sku_catalog from public,anon;
grant usage on schema sku_catalog to authenticated,service_role;
create sequence sku_catalog.product_number start 100001;
create table sku_catalog.products(
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 number bigint not null default nextval('sku_catalog.product_number') unique,
 name text not null, category text not null check(category in ('Apparel','Promotional','Service','Other')),
 form text not null check(form in ('Blank','Decorated','Custom')),
 brand text not null default '', line text not null default '', design text not null default '',
 supplier text not null default '', supplier_code text not null default '',
 fingerprint text not null unique, settings jsonb not null default '{}',
 shopify_id text,shopify_url text,sync_state text not null default 'not_created',sync_error text,
 created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table sku_catalog.variants(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references sku_catalog.products(id),
 color text not null,size text not null,sku text not null unique,
 unique(product_id,color,size)
);
create table sku_catalog.presets(
 id uuid primary key default gen_random_uuid(),name text not null unique,settings jsonb not null,created_by uuid,created_at timestamptz default now()
);
alter table sku_catalog.products enable row level security;
alter table sku_catalog.variants enable row level security;
alter table sku_catalog.presets enable row level security;
revoke all on all tables in schema sku_catalog from public,anon,authenticated;
grant all on all tables in schema sku_catalog to service_role;
grant usage,select on all sequences in schema sku_catalog to service_role;
insert into sku_catalog.presets(name,settings) values
('Adult apparel','{"category":"Apparel","form":"Blank","type":"T-shirt","colors":["Black","White","Navy"],"sizes":["S","M","L","XL","2XL","3XL"]}'),
('Youth apparel','{"category":"Apparel","form":"Blank","type":"Youth apparel","colors":["Black","White"],"sizes":["YS","YM","YL","YXL"]}'),
('Custom sublimated apparel','{"category":"Apparel","form":"Custom","type":"Sublimated apparel","colors":["Custom"],"sizes":["S","M","L","XL","2XL","3XL"]}'),
('Promotional item','{"category":"Promotional","form":"Custom","type":"Promotional product","colors":["Custom"],"sizes":["One Size"]}'),
('Service / setup fee','{"category":"Service","form":"Custom","type":"Service","colors":["N/A"],"sizes":["N/A"],"shipping":false,"taxable":false}');
create function sku_catalog.authorized() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (exists(select 1 from public.memberships m where m.organization_id='c8746565-e4e4-438a-b7a1-2a5ea015e0b3' and m.user_id=auth.uid() and m.role in ('admin','owner','super_admin','employee')))
$$;
revoke all on function sku_catalog.authorized() from public,anon;
grant execute on function sku_catalog.authorized() to authenticated,service_role;
create function sku_catalog.api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare result jsonb; p sku_catalog.products; v_number bigint; v_prefix text; color text; size text; colors text[]; sizes text[]; v_fingerprint text; settings jsonb; rid uuid; textval text; candidate text;
begin
 if not sku_catalog.authorized() then raise exception 'CRM access required' using errcode='42501'; end if;
 if p_action='get' then
  select to_jsonb(t) into result from(select p.*,(select jsonb_agg(to_jsonb(v) order by v.sku) from sku_catalog.variants v where v.product_id=p.id) as variants from sku_catalog.products p where p.id=(p_payload->>'id')::uuid)t;return result;
 elsif p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from(
   select p.id,p.number,p.name,p.category,p.form,p.brand,p.line,p.design,p.supplier,p.supplier_code,p.settings,p.shopify_url,p.sync_state,p.sync_error,p.created_at,
   (select jsonb_agg(to_jsonb(v) order by v.sku) from sku_catalog.variants v where v.product_id=p.id) as variants
   from sku_catalog.products p where length(coalesce(p_payload->>'query',''))=0 or
   concat_ws(' ',p.name,p.brand,p.line,p.design,p.supplier_code) ilike '%'||left(p_payload->>'query',150)||'%' or
   exists(select 1 from sku_catalog.variants v where v.product_id=p.id and v.sku ilike '%'||left(p_payload->>'query',150)||'%')
   order by p.created_at desc limit 200
  )t;return result;
 elsif p_action='presets' then select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') into result from sku_catalog.presets t;return result;
 elsif p_action='save_preset' then
  textval=trim(p_payload->>'name');if coalesce(length(textval),0) not between 1 and 100 then raise exception 'Preset name is required';end if;
  insert into sku_catalog.presets(name,settings,created_by) values(textval,p_payload->'settings',auth.uid());return jsonb_build_object('ok',true);
 elsif p_action='settings' then
  if length(coalesce(p_payload->'settings'->>'description',''))>20000 then raise exception 'Description is too long';end if;
  update sku_catalog.products set settings=p_payload->'settings',updated_at=now() where id=(p_payload->>'id')::uuid returning * into p;
  if p.id is null then raise exception 'Product not found';end if;return to_jsonb(p);
 elsif p_action<>'create' then raise exception 'Unsupported catalog action';end if;
 if coalesce(length(trim(p_payload->>'name')),0) not between 1 and 200 then raise exception 'Product name is required (200 characters maximum)';end if;
 if p_payload->>'category' not in ('Apparel','Promotional','Service','Other') or p_payload->>'form' not in ('Blank','Decorated','Custom') then raise exception 'Choose a category and product form';end if;
 foreach textval in array array['brand','line','design','supplier','supplier_code'] loop
  if length(coalesce(p_payload->>textval,''))>200 then raise exception 'Product details must be at most 200 characters';end if;
 end loop;
 select array_agg(distinct trim(value) order by trim(value)) into colors from jsonb_array_elements_text(p_payload->'colors') where length(trim(value)) between 1 and 60;
 select array_agg(distinct trim(value) order by trim(value)) into sizes from jsonb_array_elements_text(p_payload->'sizes') where length(trim(value)) between 1 and 40;
 if coalesce(cardinality(colors),0)=0 or coalesce(cardinality(sizes),0)=0 or cardinality(colors)*cardinality(sizes)>250 then raise exception 'Choose colors and sizes (maximum 250 variations per product)';end if;
 rid=(p_payload->>'request_id')::uuid;
 v_fingerprint=md5(lower(concat_ws('|',trim(p_payload->>'name'),trim(p_payload->>'brand'),trim(p_payload->>'line'),p_payload->>'form',trim(p_payload->>'design'))));
 -- The fingerprint flags the same product; it does not allocate another number.
 select * into p from sku_catalog.products where request_id=rid or products.fingerprint=v_fingerprint;
 if p.id is not null then return jsonb_build_object('id',p.id,'duplicate',true,'name',p.name);end if;
 settings=coalesce(p_payload->'settings','{}');
 if length(coalesce(settings->>'description',''))>20000 then raise exception 'Description is too long';end if;
 insert into sku_catalog.products(request_id,name,category,form,brand,line,design,supplier,supplier_code,fingerprint,settings,created_by)
 values(rid,trim(p_payload->>'name'),p_payload->>'category',p_payload->>'form',trim(coalesce(p_payload->>'brand','')),trim(coalesce(p_payload->>'line','')),trim(coalesce(p_payload->>'design','')),trim(coalesce(p_payload->>'supplier','')),trim(coalesce(p_payload->>'supplier_code','')),v_fingerprint,settings,auth.uid()) returning * into p;
 v_prefix='GS-'||case p.category when 'Apparel' then 'A' when 'Promotional' then 'P' when 'Service' then 'S' else 'O' end||p.number;
 foreach color in array colors loop foreach size in array sizes loop
  candidate=v_prefix||'-'||coalesce(nullif(left(regexp_replace(upper(color),'[^A-Z0-9]','','g'),10),''),'NA')||'-'||coalesce(nullif(left(regexp_replace(upper(size),'[^A-Z0-9]','','g'),8),''),'OS');
  if exists(select 1 from sku_catalog.variants v where v.sku=candidate) then candidate=candidate||'-'||upper(left(md5(color||'|'||size),6));end if;
  insert into sku_catalog.variants(product_id,color,size,sku) values(p.id,color,size,candidate);
 end loop;end loop;
 return jsonb_build_object('id',p.id,'duplicate',false,'number',p.number,'variants',cardinality(colors)*cardinality(sizes));
exception when unique_violation then
 select * into p from sku_catalog.products where request_id=rid or products.fingerprint=v_fingerprint;
 if p.id is not null then return jsonb_build_object('id',p.id,'duplicate',true,'name',p.name);end if;
 raise;
end $$;
revoke all on function sku_catalog.api(text,jsonb) from public,anon;
grant execute on function sku_catalog.api(text,jsonb) to authenticated,service_role;
create function public.crm_product_catalog(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select sku_catalog.api(p_action,p_payload) $$;
revoke all on function public.crm_product_catalog(text,jsonb) from public,anon;
grant execute on function public.crm_product_catalog(text,jsonb) to authenticated,service_role;
create function sku_catalog.shopify_state(p_id uuid,p_state text,p_shopify_id text default null,p_url text default null,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_state='claim' then
  update sku_catalog.products set sync_state='creating',sync_error=null,updated_at=now() where id=p_id and shopify_id is null and (sync_state<>'creating' or updated_at<now()-interval '10 minutes');return found;
 elsif p_state in ('created','error','uncertain') then
  update sku_catalog.products set sync_state=p_state,shopify_id=coalesce(p_shopify_id,shopify_id),shopify_url=coalesce(p_url,shopify_url),sync_error=left(p_error,1000),updated_at=now() where id=p_id;return found;
 end if;
 raise exception 'Invalid synchronization state';
end $$;
revoke all on function sku_catalog.shopify_state(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function sku_catalog.shopify_state(uuid,text,text,text,text) to service_role;
create function public.crm_catalog_shopify_state(p_id uuid,p_state text,p_shopify_id text default null,p_url text default null,p_error text default null) returns boolean language sql security invoker set search_path='' as $$ select sku_catalog.shopify_state(p_id,p_state,p_shopify_id,p_url,p_error) $$;
revoke all on function public.crm_catalog_shopify_state(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_catalog_shopify_state(uuid,text,text,text,text) to service_role;
