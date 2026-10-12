-- Cancelled by owner before release. Preserve every business record.
do $$ begin if exists(select 1 from public.classrooms where not is_initial) then raise exception 'Additional classrooms exist; manual merge required';end if;end $$;
drop function public.classroom_create(uuid,text,uuid);
drop function public.classroom_rpc(uuid,uuid,text,jsonb);
alter function public.consume_line_code(text,text) security definer;
create or replace function public.evidence_storage_usage() returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object('used_bytes',coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id='finance-evidence'),0),'file_count',(select count(*) from storage.objects where bucket_id='finance-evidence'),'budget_bytes',budget_bytes,'auto_cleanup',auto_cleanup,'trigger_percent',90,'target_percent',80) from evidence_storage_settings where id;
$$;
do $$ declare f record;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='manage_payment_qr' loop execute replace(pg_get_functiondef(f.oid),'on conflict(classroom_id,amount_cents)','on conflict(amount_cents)');end loop;
end $$;
do $$ declare t record;begin
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='classroom_id' loop execute format('alter table public.%I drop column classroom_id cascade',t.table_name);end loop;
end $$;
alter table public.site_settings add primary key(id);
alter table public.evidence_storage_settings add primary key(id);
alter table public.payment_qrs add unique(amount_cents);
drop function public.request_classroom();
drop table public.classroom_admins;
drop table public.classrooms;
drop policy if exists classroom_slip_refs on public.used_slip_refs;
drop policy if exists classroom_recovery_limits on public.account_access_limits;
drop owned by finance_classroom;
revoke finance_classroom from service_role;
drop role finance_classroom;
