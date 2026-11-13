create schema if not exists locker_admin;
revoke all on schema locker_admin from public,anon,authenticated;
grant usage on schema locker_admin to service_role;
create table locker_admin.access_audit(
 id bigint generated always as identity primary key,
 organization_monday_id text not null,action text not null,
 actor_user_id uuid not null,actor_email text not null,customer_email text not null,
 before_record jsonb,after_record jsonb,created_at timestamptz not null default now()
);
alter table locker_admin.access_audit enable row level security;
revoke all on locker_admin.access_audit from public,anon,authenticated;
grant all on locker_admin.access_audit to service_role;
grant usage on all sequences in schema locker_admin to service_role;
create function locker_admin.manage_access(p_org text,p_action text,p_email text default '',p_access_id bigint default null,p_actor uuid default null,p_actor_email text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.goat_locker_organization_access; after_row public.goat_locker_organization_access; email text; result jsonb;
begin
 if p_org !~ '^[0-9]{5,20}$' then raise exception 'Invalid organization';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(a) order by a.active desc,a.customer_email),'[]') into result from public.goat_locker_organization_access a where a.organization_monday_id=p_org;
  return result;
 end if;
 if p_actor is null or length(p_actor_email)=0 then raise exception 'Verified administrator identity required';end if;
 if p_action='grant' then
  email=lower(trim(p_email));
  if length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid customer email';end if;
  select * into before_row from public.goat_locker_organization_access where organization_monday_id=p_org and customer_email=email for update;
  insert into public.goat_locker_organization_access(organization_monday_id,customer_email,role,active,updated_at)
  values(p_org,email,'Customer',true,now()) on conflict(customer_email,organization_monday_id) do update set active=true,updated_at=now()
  returning * into after_row;
 elsif p_action in ('revoke','reactivate') then
  select * into before_row from public.goat_locker_organization_access where id=p_access_id and organization_monday_id=p_org for update;
  if before_row.id is null then raise exception 'Access record not found for this organization';end if;
  update public.goat_locker_organization_access set active=(p_action='reactivate'),updated_at=now() where id=p_access_id and organization_monday_id=p_org returning * into after_row;
 else raise exception 'Unsupported access action';end if;
 insert into locker_admin.access_audit(organization_monday_id,action,actor_user_id,actor_email,customer_email,before_record,after_record)
 values(p_org,p_action,p_actor,lower(p_actor_email),after_row.customer_email,case when before_row.id is null then null else to_jsonb(before_row) end,to_jsonb(after_row));
 return jsonb_build_object('ok',true,'access',to_jsonb(after_row));
end $$;
revoke all on function locker_admin.manage_access(text,text,text,bigint,uuid,text) from public,anon,authenticated;
grant execute on function locker_admin.manage_access(text,text,text,bigint,uuid,text) to service_role;
create function public.goat_locker_manage_customer_access(p_org text,p_action text,p_email text default '',p_access_id bigint default null,p_actor uuid default null,p_actor_email text default '') returns jsonb language sql security invoker set search_path='' as $$
select locker_admin.manage_access(p_org,p_action,p_email,p_access_id,p_actor,p_actor_email)
$$;
revoke all on function public.goat_locker_manage_customer_access(text,text,text,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.goat_locker_manage_customer_access(text,text,text,bigint,uuid,text) to service_role;
