alter table public.charges add column drive_file_id text;

-- Only the authenticated Edge Function's service role can call this wrapper.
-- The bill change and attachment reference commit or roll back together.
create function public.admin_bill_with_evidence(p_charge uuid,p_actor uuid,p_file text,p_patch jsonb default null,p_status text default null,p_reason text default null,p_expected_paid numeric default null,p_expected_balance numeric default null,p_request uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; old_file text;
begin
 perform pg_advisory_xact_lock(7086301);
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_file is null or p_file not like 'sb:%' or not exists(select 1 from evidence_files where path=substr(p_file,4) and state='active') then raise exception 'ไม่พบไฟล์หลักฐาน';end if;
 if p_patch is not null then
  perform manage_record('charge',p_charge,p_patch,p_actor);
  result:='{"ok":true}'::jsonb;
 else
  result:=admin_set_bill_status(p_charge,p_status,p_reason,p_actor,p_expected_paid,p_expected_balance,p_request);
 end if;
 if p_patch is null and p_status='approved' then
  select drive_file_id into old_file from payments where id=p_request and charge_id=p_charge;
  update payments set drive_file_id=p_file where id=p_request and charge_id=p_charge;
  if not found then raise exception 'ไม่พบรายการชำระเงิน';end if;
 else
  select drive_file_id into old_file from charges where id=p_charge;
  update charges set drive_file_id=p_file where id=p_charge;
 end if;
 insert into audit(actor,action,details) select name,'แนบสลิปประกอบการจัดการบิล',jsonb_build_object('charge_id',p_charge,'actor_id',p_actor,'before',jsonb_build_object('drive_file_id',old_file),'after',jsonb_build_object('drive_file_id',p_file)) from profiles where id=p_actor;
 if old_file is not null and old_file<>p_file and not exists(select 1 from charges where drive_file_id=old_file) and not exists(select 1 from payments where drive_file_id=old_file) then
  insert into trash_cleanup_queue(kind,target) values('drive',old_file) on conflict do nothing;
 end if;
 return result;
end $$;
revoke all on function public.admin_bill_with_evidence(uuid,uuid,text,jsonb,text,text,numeric,numeric,uuid) from public,anon,authenticated;
grant execute on function public.admin_bill_with_evidence(uuid,uuid,text,jsonb,text,text,numeric,numeric,uuid) to service_role;

create function public.queue_charge_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.drive_file_id is not null and not exists(select 1 from payments where drive_file_id=old.drive_file_id) then
  insert into trash_cleanup_queue(kind,target) values('drive',old.drive_file_id) on conflict do nothing;
 end if;
 return old;
end $$;
revoke all on function public.queue_charge_evidence() from public,anon,authenticated;
grant execute on function public.queue_charge_evidence() to service_role;
create trigger delete_charge_evidence after delete on public.charges for each row execute function public.queue_charge_evidence();
