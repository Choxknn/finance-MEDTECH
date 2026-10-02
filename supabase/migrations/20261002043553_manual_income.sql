create table public.manual_incomes (
 id uuid primary key default gen_random_uuid(),title text not null,category text not null,
 amount numeric(12,2) not null check(amount>0 and amount<=1000000),received_on date not null,
 note text not null default '',created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),deleted_at timestamptz
);
alter table public.manual_incomes enable row level security;
revoke all on public.manual_incomes from public,anon,authenticated;
grant all on public.manual_incomes to service_role;
create function public.save_manual_income(p_id uuid,p_patch jsonb,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare actor_name text; old_record jsonb; new_record jsonb; target_id uuid;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if nullif(trim(p_patch->>'title'),'') is null or nullif(trim(p_patch->>'category'),'') is null then raise exception 'กรุณาระบุรายการและประเภทรายรับ';end if;
 if p_id is null then
  insert into manual_incomes(title,category,amount,received_on,note,created_by) values(p_patch->>'title',p_patch->>'category',(p_patch->>'amount')::numeric,(p_patch->>'received_on')::date,coalesce(p_patch->>'note',''),p_actor) returning id into target_id;
 else
  if nullif(trim(p_patch->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล';end if;
  select to_jsonb(i) into old_record from manual_incomes i where id=p_id and deleted_at is null for update;
  if old_record is null then raise exception 'ไม่พบรายการ';end if;
  target_id:=p_id;
  update manual_incomes set title=p_patch->>'title',category=p_patch->>'category',amount=(p_patch->>'amount')::numeric,received_on=(p_patch->>'received_on')::date,note=coalesce(p_patch->>'note','') where id=p_id;
 end if;
 select to_jsonb(i) into new_record from manual_incomes i where id=target_id;
 insert into audit(actor,action,details) values(actor_name,case when p_id is null then 'เพิ่มรายรับกองกลาง' else 'แก้ไขรายรับกองกลาง' end,jsonb_build_object('before',old_record,'after',new_record,'reason',p_patch->>'reason'));
 return target_id;
end;$$;
revoke all on function public.save_manual_income(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_manual_income(uuid,jsonb,uuid) to service_role;
create or replace function public.set_record_deleted(p_entity text,p_id uuid,p_deleted boolean,p_reason text,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare table_name text; old_record jsonb; new_record jsonb; actor_name text; charge_id_to_lock uuid; received numeric; target charges;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'กรุณาระบุเหตุผล';end if;
 table_name:=case p_entity when 'member' then 'profiles' when 'round' then 'rounds' when 'charge' then 'charges' when 'payment' then 'payments' when 'expense' then 'expenses' when 'income' then 'manual_incomes' else null end;
 if table_name is null then raise exception 'ชนิดรายการไม่ถูกต้อง';end if;
 if p_entity='payment' then
  select charge_id into charge_id_to_lock from payments where id=p_id;
  select * into target from charges where id=charge_id_to_lock for update;
 elsif p_entity='round' then
  perform id from rounds where id=p_id for update;
  perform id from charges where round_id=p_id order by id for update;
 end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',table_name) into old_record using p_id;
 if old_record is null then raise exception 'ไม่พบรายการ';end if;
 if p_entity='member' and p_deleted then
  if p_id=p_actor then raise exception 'ไม่สามารถลบบัญชีของตนเอง';end if;
  if old_record->>'role'='admin' and not exists(select 1 from profiles where id<>p_id and role='admin' and active and deleted_at is null) then raise exception 'ต้องเหลือแอดมินที่ใช้งานได้อย่างน้อยหนึ่งคน';end if;
 end if;
 if not p_deleted and p_entity='payment' and old_record->>'status' in ('pending','review') and exists(select 1 from payments where charge_id=charge_id_to_lock and status in ('pending','review') and deleted_at is null and id<>p_id) then raise exception 'กู้คืนไม่ได้ มีรายการรอตรวจในบิลนี้อยู่แล้ว';end if;
 if not p_deleted and p_entity='payment' and old_record->>'status'='approved' then
  select coalesce(sum(amount),0) into received from payments where charge_id=charge_id_to_lock and status='approved' and deleted_at is null and id<>p_id;
  if received+(old_record->>'amount')::numeric>target.amount then raise exception 'กู้คืนไม่ได้ ยอดที่ยืนยันจะเกินยอดเรียกเก็บ';end if;
 end if;
 if (old_record->>'deleted_at' is not null)=p_deleted then return;end if;
 execute format('update public.%I set deleted_at=$1 where id=$2',table_name) using case when p_deleted then now() else null end,p_id;
 execute format('select to_jsonb(t) from public.%I t where id=$1',table_name) into new_record using p_id;
 insert into audit(actor,action,details) values(actor_name,(case when p_deleted then 'ลบ ' else 'กู้คืน ' end)||p_entity||': '||p_id::text,jsonb_build_object('before',old_record,'after',new_record,'reason',p_reason));
end;$$;
revoke all on function public.set_record_deleted(text,uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.set_record_deleted(text,uuid,boolean,text,uuid) to service_role;

