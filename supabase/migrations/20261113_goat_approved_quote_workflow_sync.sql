begin;
create table public.goat_crm_approval_sync (
 quote_id uuid primary key references public.goat_crm_quotes(id) on delete cascade,
 snapshot jsonb not null, source text not null, state text not null default 'pending',
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.goat_crm_monday_job_sync (
 job_id uuid primary key references public.goat_crm_jobs(id) on delete cascade,
 monday_item_id text, payload_hash text, last_error text, updated_at timestamptz not null default now()
);
create table public.goat_crm_workflow_lease (id boolean primary key default true check(id), owner uuid not null, expires_at timestamptz not null);
alter table public.goat_crm_approval_sync enable row level security;
alter table public.goat_crm_monday_job_sync enable row level security;
alter table public.goat_crm_workflow_lease enable row level security;
revoke all on public.goat_crm_approval_sync,public.goat_crm_monday_job_sync,public.goat_crm_workflow_lease from public,anon,authenticated;
grant all on public.goat_crm_approval_sync,public.goat_crm_monday_job_sync,public.goat_crm_workflow_lease to service_role;
create function public.goat_workflow_sync_lease(p_owner uuid,p_release boolean default false) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_release then delete from public.goat_crm_workflow_lease where id and owner=p_owner; return true; end if;
 insert into public.goat_crm_workflow_lease(id,owner,expires_at) values(true,p_owner,now()+interval '150 seconds')
 on conflict(id) do update set owner=excluded.owner,expires_at=excluded.expires_at where public.goat_crm_workflow_lease.expires_at<now();
 return found;
end $$;
revoke all on function public.goat_workflow_sync_lease(uuid,boolean) from public,anon,authenticated;
grant execute on function public.goat_workflow_sync_lease(uuid,boolean) to service_role;
create function public.goat_queue_approval_workflow() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.organization_id='c8746565-e4e4-438a-b7a1-2a5ea015e0b3'::uuid and new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
  insert into public.goat_crm_approval_sync(quote_id,snapshot,source) values(new.id,to_jsonb(new),'approved_status_transition')
  on conflict(quote_id) do update set snapshot=excluded.snapshot,state=case when exists(select 1 from public.goat_quote_shopify_drafts d where d.quote_id=new.id and d.status='created') then 'review_required' else 'pending' end,last_error=null,updated_at=now();
 end if;
 return new;
end $$;
revoke all on function public.goat_queue_approval_workflow() from public,anon,authenticated;
create trigger goat_queue_approval_workflow after insert or update of status on public.goat_crm_quotes for each row execute function public.goat_queue_approval_workflow();
-- Repair only already authorized, verified organization links. This also catches
-- quotes that predate verification without editing any quote or approval.
insert into public.goat_locker_quote_outbox(quote_id,crm_client_id,locker_organization_monday_id,quote_number)
select q.id,q.business_client_id,m.locker_organization_monday_id,q.quote_number from public.goat_crm_quotes q
join public.goat_crm_locker_mapping m on m.crm_client_id=q.business_client_id and m.crm_organization_id=q.organization_id and m.status='verified'
where q.organization_id='c8746565-e4e4-438a-b7a1-2a5ea015e0b3' and q.status in ('sent','approved','changes_requested') on conflict(quote_id) do nothing;
-- The user requested recovery of this latest approved quote for payment.
insert into public.goat_crm_approval_sync(quote_id,snapshot,source)
select id,to_jsonb(q),'user_requested_recovery_2026_11_13' from public.goat_crm_quotes q where quote_number='Q-M1MZ7Y5J' and status='approved';
commit;
