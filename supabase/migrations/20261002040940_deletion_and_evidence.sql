alter table public.profiles add column deleted_at timestamptz, add column phone text not null default '', add column contact_email text not null default '', add column profile_note text not null default '';
alter table public.rounds add column deleted_at timestamptz;
alter table public.charges add column deleted_at timestamptz;
alter table public.payments add column deleted_at timestamptz;
alter table public.expenses add column deleted_at timestamptz;
drop index public.one_open_payment_per_charge;
create unique index one_open_payment_per_charge on public.payments(charge_id) where status in ('pending','review') and deleted_at is null;

create function public.set_record_deleted(p_entity text,p_id uuid,p_deleted boolean,p_reason text,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare table_name text; old_record jsonb; new_record jsonb; actor_name text; charge_id_to_lock uuid; received numeric; target charges;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'กรุณาระบุเหตุผล';end if;
 table_name:=case p_entity when 'member' then 'profiles' when 'round' then 'rounds' when 'charge' then 'charges' when 'payment' then 'payments' when 'expense' then 'expenses' else null end;
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

create function public.delete_records(p_entity text,p_ids uuid[],p_deleted boolean,p_reason text,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare item uuid;
begin
 if coalesce(array_length(p_ids,1),0)<1 or array_length(p_ids,1)>500 then raise exception 'เลือก 1–500 รายการ';end if;
 for item in select distinct unnest(p_ids) order by 1 loop
  perform public.set_record_deleted(p_entity,item,p_deleted,p_reason,p_actor);
 end loop;
end;$$;
revoke all on function public.delete_records(text,uuid[],boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_records(text,uuid[],boolean,text,uuid) to service_role;

create function public.update_own_profile(p_actor uuid,p_name text,p_year text,p_phone text,p_email text)
returns void language plpgsql security invoker set search_path=public as $$
declare old_record jsonb; new_record jsonb;
begin
 select to_jsonb(p) into old_record from profiles p where id=p_actor and active and deleted_at is null for update;
 if old_record is null then raise exception 'ไม่มีสิทธิ์';end if;
 update profiles set name=p_name,year=p_year,phone=p_phone,contact_email=p_email where id=p_actor;
 select to_jsonb(p) into new_record from profiles p where id=p_actor;
 insert into audit(actor,action,details) values(old_record->>'name','แก้ไขโปรไฟล์ของตนเอง',jsonb_build_object('before',old_record,'after',new_record));
end;$$;
revoke all on function public.update_own_profile(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.update_own_profile(uuid,text,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.decide_payment(p_id uuid, p_decision text, p_note text, p_ref text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p payments; c charges; received numeric;
begin
 -- Lock the charge first for consistent lock ordering with reserve_payment.
 select * into c from charges where id=(select charge_id from payments where id=p_id) for update;
 select * into p from payments where id=p_id for update;
 if p.id is null or p.deleted_at is not null or p.status not in ('pending','review') then raise exception 'รายการถูกดำเนินการแล้ว';end if;
 if p_decision not in ('approved','rejected') then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_actor is not null and not exists(select 1 from profiles where id=p_actor and active and deleted_at is null and role='admin') then raise exception 'ไม่มีสิทธิ์';end if;
 if p_decision='approved' then
  if c.deleted_at is not null or exists(select 1 from rounds where id=c.round_id and deleted_at is not null) or exists(select 1 from profiles where id=p.profile_id and deleted_at is not null) then raise exception 'รายการหรือผู้ใช้ถูกลบแล้ว กรุณากู้คืนก่อนยืนยัน';end if;
  if p.drive_file_id is null or nullif(trim(p_ref),'') is null then raise exception 'ต้องมีหลักฐานและเลขอ้างอิง';end if;
  select coalesce(sum(amount),0) into received from payments where charge_id=p.charge_id and status='approved' and deleted_at is null;
  if received+p.amount>c.amount then raise exception 'ยอดเกินเรียกเก็บ';end if;
 end if;
 update payments set status=p_decision,note=p_note,trans_ref=case when p_decision='approved' then trim(p_ref) else trans_ref end,reviewed_by=p_actor,reviewed_at=now() where id=p_id;
 insert into audit(actor,action) values(coalesce((select name from profiles where id=p_actor),'SlipOK'),p_decision||': '||p_id::text);
end;$function$;

CREATE OR REPLACE FUNCTION public.manage_record(p_entity text, p_id uuid, p_patch jsonb, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare old_record jsonb; new_record jsonb; actor_name text; charge_record charges; old_amount numeric;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 if p_entity='round' then
  select to_jsonb(r) into old_record from rounds r where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรอบ'; end if;
  -- Same lock order as payment reservation/approval; lock every charge first.
  perform id from charges where round_id=p_id order by id for update;
  if (p_patch->>'amount')::numeric<>(old_record->>'amount')::numeric and exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review') and p.deleted_at is null) then
   raise exception 'รอบนี้มีการชำระหรือรอตรวจแล้ว แก้ได้เฉพาะชื่อ รายละเอียด และวันที่';
  end if;
  update rounds set title=p_patch->>'title',description=p_patch->>'description',due_date=(p_patch->>'due_date')::date,amount=(p_patch->>'amount')::numeric,archived=(p_patch->>'archived')::boolean where id=p_id;
  if (p_patch->>'amount')::numeric<>(old_record->>'amount')::numeric then update charges set amount=(p_patch->>'amount')::numeric where round_id=p_id;end if;
  select to_jsonb(r) into new_record from rounds r where id=p_id;
 elsif p_entity='member' then
  perform pg_advisory_xact_lock(7086301);
  select to_jsonb(p) into old_record from profiles p where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบสมาชิก'; end if;
  if p_id=p_actor and ((p_patch->>'role')<>'admin' or not (p_patch->>'active')::boolean) then raise exception 'ไม่สามารถปิดหรือถอดสิทธิ์แอดมินของตนเอง';end if;
  update profiles set name=p_patch->>'name',year=p_patch->>'year',role=p_patch->>'role',phone=coalesce(p_patch->>'phone',phone),contact_email=coalesce(p_patch->>'contact_email',contact_email),profile_note=coalesce(p_patch->>'profile_note',profile_note),active=(p_patch->>'active')::boolean where id=p_id;
  select to_jsonb(p) into new_record from profiles p where id=p_id;
 elsif p_entity='expense' then
  select to_jsonb(e) into old_record from expenses e where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรายจ่าย';end if;
  update expenses set title=p_patch->>'title',category=p_patch->>'category',amount=(p_patch->>'amount')::numeric,spent_on=(p_patch->>'spent_on')::date,note=p_patch->>'note',voided=(p_patch->>'voided')::boolean,drive_file_id=coalesce(nullif(p_patch->>'drive_file_id',''),drive_file_id) where id=p_id;
  select to_jsonb(e) into new_record from expenses e where id=p_id;
 elsif p_entity='payment' then
  select to_jsonb(p) into old_record from payments p where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรายการ';end if;
  update payments set note=p_patch->>'note' where id=p_id;
  select to_jsonb(p) into new_record from payments p where id=p_id;
 elsif p_entity='charge' then
  select * into charge_record from charges where id=p_id for update;
  if charge_record.id is null then raise exception 'ไม่พบรายการ';end if;
  if exists(select 1 from payments where charge_id=p_id and status in ('approved','pending','review')) then raise exception 'มีการชำระหรือรอตรวจแล้ว ไม่สามารถเปลี่ยนยอด';end if;
  old_record=to_jsonb(charge_record);
  update charges set amount=(p_patch->>'amount')::numeric where id=p_id;
  select to_jsonb(x) into new_record from charges x where id=p_id;
 else raise exception 'ชนิดรายการไม่ถูกต้อง';
 end if;
 insert into audit(actor,action,details) values(actor_name,'แก้ไข '||p_entity||': '||p_id::text,jsonb_build_object('before',old_record,'after',new_record,'reason',p_patch->>'reason'));
end;$function$;

CREATE OR REPLACE FUNCTION public.reserve_payment(p_profile uuid, p_charge uuid, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c charges; received numeric; pid uuid;
begin
 select * into c from charges where id=p_charge for update;
 if c.id is null or c.deleted_at is not null or c.profile_id<>p_profile then raise exception 'รายการไม่ถูกต้อง';end if;
 if exists(select 1 from rounds where id=c.round_id and (archived or deleted_at is not null)) then raise exception 'รอบนี้ปิดรับชำระแล้ว';end if;
 if not exists(select 1 from profiles where id=p_profile and active and deleted_at is null) then raise exception 'บัญชีถูกปิดหรือลบแล้ว';end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_charge and status='approved' and deleted_at is null;
 if p_amount<=0 or p_amount>c.amount-received then raise exception 'ยอดเกินค้างชำระ';end if;
 insert into payments(profile_id,charge_id,amount) values(p_profile,p_charge,p_amount) returning id into pid;
 return pid;
end;$function$;

CREATE OR REPLACE FUNCTION public.save_settings(p_values jsonb, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare previous jsonb; actor_name text;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 select data into previous from site_settings where id=true for update;
 update site_settings set data=p_values where id=true;
 insert into audit(actor,action,details) values(actor_name,'แก้ไขการตั้งค่าเว็บ',jsonb_build_object('before',previous||jsonb_build_object('paymentQrUrl',case when previous->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else previous->>'paymentQrUrl' end),'after',p_values||jsonb_build_object('paymentQrUrl',case when p_values->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else p_values->>'paymentQrUrl' end)));
end;$function$;


create or replace function public.create_round(p_title text,p_description text,p_amount numeric,p_due date,p_actor text)
returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid;
begin
 insert into rounds(title,description,amount,due_date) values(p_title,p_description,p_amount,p_due) returning id into rid;
 insert into charges(profile_id,round_id,amount) select id,rid,p_amount from profiles where role='member' and active and deleted_at is null;
 insert into audit(actor,action) values(p_actor,'สร้างรอบเก็บเงิน: '||p_title);
 return rid;
end;$$;
create or replace function public.consume_line_code(p_hash text,p_line_user text)
returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
 delete from line_link_codes where code_hash=p_hash and expires_at>now() returning profile_id into pid;
 if pid is null then return null;end if;
 if not exists(select 1 from profiles where id=pid and active and deleted_at is null) then return null;end if;
 insert into line_accounts(profile_id,line_user_id) values(pid,p_line_user) on conflict(profile_id) do update set line_user_id=excluded.line_user_id;
 delete from line_link_codes where profile_id=pid;
 return pid;
end;$$;
