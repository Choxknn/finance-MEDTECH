-- Private evidence bucket. Only the authenticated finance API can access objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('finance-evidence','finance-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
create table public.evidence_storage_settings(id boolean primary key default true check(id),budget_bytes bigint not null default 1073741824 check(budget_bytes between 104857600 and 107374182400),auto_cleanup boolean not null default true,lease_id uuid,lease_until timestamptz);
insert into public.evidence_storage_settings(id) values(true);
create table public.evidence_files(path text primary key,name text not null,size bigint not null check(size>=0),mime_type text not null,created_at timestamptz not null default now(),state text not null default 'pending' check(state in ('pending','active','deleting','deleted')),deleted_at timestamptz,delete_reason text);
create index evidence_files_retention on public.evidence_files(state,created_at,path);
alter table public.evidence_storage_settings enable row level security;
alter table public.evidence_files enable row level security;
revoke all on public.evidence_storage_settings,public.evidence_files from public,anon,authenticated;
grant all on public.evidence_storage_settings,public.evidence_files to service_role;
create function public.evidence_storage_lock(p_id uuid,p_release boolean default false) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 if p_release then update evidence_storage_settings set lease_id=null,lease_until=null where id and lease_id=p_id;return found;end if;
 update evidence_storage_settings set lease_id=p_id,lease_until=now()+interval '10 minutes' where id and (lease_until is null or lease_until<now());return found;
end $$;
create function public.evidence_storage_usage() returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object('used_bytes',coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id='finance-evidence'),0),'file_count',(select count(*) from storage.objects where bucket_id='finance-evidence'),'budget_bytes',budget_bytes,'auto_cleanup',auto_cleanup,'trigger_percent',90,'target_percent',80) from evidence_storage_settings where id;
$$;
create function public.evidence_cleanup_candidates() returns setof public.evidence_files language sql security invoker set search_path=public as $$
 select f.* from evidence_files f where f.state='active' and f.created_at<now()-interval '1 hour'
 and not exists(select 1 from payments p where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and p.deleted_at is null)
 order by f.created_at,f.path limit 100;
$$;
create function public.queue_replaced_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
declare oldrow jsonb:=to_jsonb(old); newrow jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end; col text; target_id text;
begin
 foreach col in array array['drive_file_id','receipt_file_id'] loop
 target_id:=oldrow->>col;
 if target_id is not null and target_id is distinct from (newrow->>col) then
 insert into trash_cleanup_queue(kind,target) values('drive',target_id) on conflict do nothing;
 end if;end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger payments_evidence_cleanup after delete or update of drive_file_id on public.payments for each row execute function public.queue_replaced_evidence();
create trigger expenses_evidence_cleanup after delete or update of drive_file_id,receipt_file_id on public.expenses for each row execute function public.queue_replaced_evidence();
create trigger incomes_evidence_cleanup after delete or update of drive_file_id,receipt_file_id on public.manual_incomes for each row execute function public.queue_replaced_evidence();
revoke all on function public.evidence_storage_lock(uuid,boolean),public.evidence_storage_usage(),public.evidence_cleanup_candidates(),public.queue_replaced_evidence() from public,anon,authenticated;
grant execute on function public.evidence_storage_lock(uuid,boolean),public.evidence_storage_usage(),public.evidence_cleanup_candidates(),public.queue_replaced_evidence() to service_role;
select cron.schedule('finance-evidence-maintenance','*/10 * * * *',$job$
 select net.http_post(url:='https://sdegiugcttarbsnqvusm.supabase.co/functions/v1/evidence-maintenance',headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='finance_reminder_worker')),body:='{}'::jsonb,timeout_milliseconds:=60000);
$job$);

update public.payments set drive_file_id=null where drive_file_id is not null and drive_file_id not like 'sb:%';
update public.expenses set drive_file_id=case when drive_file_id like 'sb:%' then drive_file_id else null end,receipt_file_id=case when receipt_file_id like 'sb:%' then receipt_file_id else null end where (drive_file_id is not null and drive_file_id not like 'sb:%') or (receipt_file_id is not null and receipt_file_id not like 'sb:%');
update public.manual_incomes set drive_file_id=case when drive_file_id like 'sb:%' then drive_file_id else null end,receipt_file_id=case when receipt_file_id like 'sb:%' then receipt_file_id else null end where (drive_file_id is not null and drive_file_id not like 'sb:%') or (receipt_file_id is not null and receipt_file_id not like 'sb:%');
