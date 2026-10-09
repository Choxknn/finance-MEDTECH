alter table public.expenses add column workflow_status text not null default 'settled' check(workflow_status in ('pending','awaiting_transfer','settled','other')),add column workflow_label text not null default '';
alter table public.manual_incomes add column workflow_status text not null default 'settled' check(workflow_status in ('pending','awaiting_transfer','settled','other')),add column workflow_label text not null default '';
create function public.set_fund_workflow(p_kind text,p_id uuid,p_status text,p_label text,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
declare old_row jsonb; target text;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 if p_kind is null or p_kind not in ('income','expense') or p_status not in ('pending','awaiting_transfer','settled','other') or p_status is null then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_status='other' and (p_label is null or char_length(trim(p_label)) not between 1 and 80) then raise exception 'ระบุสถานะอื่น ๆ 1–80 ตัวอักษร';end if;
 target:=case when p_kind='income' then 'manual_incomes' else 'expenses' end;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and deleted_at is null for update',target) into old_row using p_id;
 if old_row is null then raise exception 'ไม่พบรายการ';end if;
 execute format('update public.%I set workflow_status=$1,workflow_label=$2 where id=$3',target) using p_status,case when p_status='other' then trim(p_label) else '' end,p_id;
 insert into audit(actor,action,details) select name,'เปลี่ยนสถานะรายการการเงิน',jsonb_build_object('entity',p_kind,'id',p_id,'before',old_row->>'workflow_status','after',p_status,'label',p_label) from profiles where id=p_actor;
end;$$;
revoke all on function public.set_fund_workflow(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.set_fund_workflow(text,uuid,text,text,uuid) to service_role;
