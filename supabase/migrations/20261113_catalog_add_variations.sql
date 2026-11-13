create or replace function sku_catalog.append_variants(p_id uuid,p_colors jsonb,p_sizes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item sku_catalog.products; colors text[]; sizes text[]; c text; s text; candidate text; prefix text; count_added int=0; affected int;
begin
 select * into item from sku_catalog.products where id=p_id for update;
 if item.id is null then raise exception 'Product not found';end if;
 select array_agg(distinct trim(value)) into colors from jsonb_array_elements_text(p_colors) where length(trim(value)) between 1 and 60;
 select array_agg(distinct trim(value)) into sizes from jsonb_array_elements_text(p_sizes) where length(trim(value)) between 1 and 40;
 if coalesce(cardinality(colors),0)=0 or coalesce(cardinality(sizes),0)=0 or cardinality(colors)*cardinality(sizes)>250 then raise exception 'Select colors and sizes, up to 250 combinations';end if;
 if (select count(*) from sku_catalog.variants where product_id=p_id)+(select count(*) from unnest(colors) cc(color) cross join unnest(sizes) ss(size) where not exists(select 1 from sku_catalog.variants v where v.product_id=p_id and v.color=cc.color and v.size=ss.size))>250 then raise exception 'A product can contain at most 250 variants';end if;
 prefix='GS-'||case item.category when 'Apparel' then 'A' when 'Promotional' then 'P' when 'Service' then 'S' else 'O' end||item.number;
 foreach c in array colors loop foreach s in array sizes loop
  if exists(select 1 from sku_catalog.variants v where v.product_id=p_id and v.color=c and v.size=s) then continue;end if;
  candidate=prefix||'-'||coalesce(nullif(left(regexp_replace(upper(c),'[^A-Z0-9]','','g'),10),''),'NA')||'-'||coalesce(nullif(left(regexp_replace(upper(s),'[^A-Z0-9]','','g'),8),''),'OS');
  if exists(select 1 from sku_catalog.variants v where v.sku=candidate) then candidate=candidate||'-'||upper(left(md5(c||'|'||s),6));end if;
  insert into sku_catalog.variants(product_id,color,size,sku) values(p_id,c,s,candidate) on conflict(product_id,color,size) do nothing;
  get diagnostics affected=row_count;count_added=count_added+affected;
 end loop;end loop;
 return jsonb_build_object('added',count_added,'shopify_update_required',item.shopify_id is not null);
end $$;
revoke all on function sku_catalog.append_variants(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function sku_catalog.append_variants(uuid,jsonb,jsonb) to service_role;
create or replace function sku_catalog.api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif p_action='add_variants' then
  return sku_catalog.append_variants((p_payload->>'id')::uuid,p_payload->'colors',p_payload->'sizes');
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
