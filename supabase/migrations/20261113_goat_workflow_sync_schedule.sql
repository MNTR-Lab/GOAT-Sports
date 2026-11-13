select cron.schedule('goat-crm-workflow-sync','*/2 * * * *',$job$
select net.http_post(
url:='https://lbheezjanvalalinqxcd.supabase.co/functions/v1/goat-crm-workflow-sync',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goat_cron_service_role_key' limit 1)),
body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
select cron.schedule('goat-crm-locker-quote-delivery','*/2 * * * *',$job$
insert into public.goat_locker_quote_outbox(quote_id,crm_client_id,locker_organization_monday_id,quote_number)
select q.id,q.business_client_id,m.locker_organization_monday_id,q.quote_number
from public.goat_crm_quotes q join public.goat_crm_locker_mapping m on m.crm_client_id=q.business_client_id and m.crm_organization_id=q.organization_id and m.status='verified'
where q.organization_id='c8746565-e4e4-438a-b7a1-2a5ea015e0b3' and q.status in ('sent','approved','changes_requested')
on conflict(quote_id) do nothing;
select net.http_post(url:='https://lbheezjanvalalinqxcd.supabase.co/functions/v1/goat-crm-locker-delivery',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goat_cron_service_role_key' limit 1)),
body:='{}'::jsonb);
$job$);