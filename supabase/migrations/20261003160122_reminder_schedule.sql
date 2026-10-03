-- Recovery hashes are bearer credentials: notifications has RLS and no direct member access.
-- They are never selected by the browser API; retaining the hash avoids invalidating a link on a delivery retry.
alter table public.notifications add column recovery_token_hash text;
select cron.schedule('finance-due-reminders','* * * * *',$job$
 select net.http_post(
 url:='https://sdegiugcttarbsnqvusm.supabase.co/functions/v1/due-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='finance_reminder_worker')),
 body:='{}'::jsonb,timeout_milliseconds:=60000
 );
$job$);
