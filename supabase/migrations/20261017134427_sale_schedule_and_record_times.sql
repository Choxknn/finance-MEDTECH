alter table public.shop_products add column sale_starts_at timestamptz, add column sale_ends_at timestamptz,
 add constraint shop_sale_window_valid check (sale_starts_at is null or sale_ends_at is null or sale_ends_at>sale_starts_at);
alter table public.rounds add column due_time time;
alter table public.expenses add column spent_time time;
alter table public.manual_incomes add column received_time time;
alter table public.attendance_sessions add column held_time time;
-- Existing stock reservation and this guard run in the same transaction.
create function public.guard_shop_sale_window() returns trigger language plpgsql security invoker set search_path=public as $$
declare p shop_products;
begin
 select * into p from shop_products where id=new.product_id for share;
 if not found or not p.active or p.deleted_at is not null then raise exception 'สินค้านี้ปิดขายแล้ว';end if;
 if p.sale_starts_at is not null and clock_timestamp()<p.sale_starts_at then raise exception 'ยังไม่ถึงเวลาเปิดขายสินค้า';end if;
 if p.sale_ends_at is not null and clock_timestamp()>=p.sale_ends_at then raise exception 'หมดเวลาขายสินค้าแล้ว';end if;
 return new;
end $$;
revoke all on function public.guard_shop_sale_window() from public,anon,authenticated;
grant execute on function public.guard_shop_sale_window() to service_role;
create trigger shop_sale_window before insert on public.shop_orders for each row execute function public.guard_shop_sale_window();

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
  if coalesce(array_length(array(select jsonb_array_elements_text(p_patch->'profile_ids')::uuid),1),0)=0 then raise exception 'เลือกสมาชิกอย่างน้อยหนึ่งคน';end if;
  select to_jsonb(r) into old_record from rounds r where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรอบ'; end if;
  if (p_patch->>'penalty_enabled')::boolean and (p_patch->>'penalty_max') is null and not ((old_record->>'penalty_enabled')::boolean and (old_record->>'penalty_max') is null) then raise exception 'ระบุค่าปรับสูงสุด';end if;
  -- Same lock order as payment reservation/approval; lock every charge first.
  perform id from charges where round_id=p_id order by id for update;
  if (p_patch->>'amount')::numeric<>(old_record->>'amount')::numeric and exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review') and p.deleted_at is null) then
   raise exception 'รอบนี้มีการชำระหรือรอตรวจแล้ว แก้ได้เฉพาะชื่อ รายละเอียด และวันที่';
  end if;
  if exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review') and p.deleted_at is null) and ((p_patch->>'penalty_enabled')::boolean<>(old_record->>'penalty_enabled')::boolean or (p_patch->>'penalty_per_day')::numeric<>(old_record->>'penalty_per_day')::numeric or ((p_patch->>'penalty_max')::numeric is distinct from (old_record->>'penalty_max')::numeric) or (p_patch->>'due_date')::date<>(old_record->>'due_date')::date) then raise exception 'มีการชำระหรือรอตรวจแล้ว ไม่สามารถเปลี่ยนกำหนดชำระหรือค่าปรับ';end if;
  if exists(select 1 from charges c join payments p on p.charge_id=c.id where c.round_id=p_id and c.deleted_at is null and not (p_patch->'profile_ids' ? c.profile_id::text) and p.status in ('approved','pending','review') and p.deleted_at is null) then raise exception 'ไม่สามารถนำสมาชิกที่ชำระหรือรอตรวจออกจากบิล';end if;
  if exists(select 1 from jsonb_array_elements_text(p_patch->'profile_ids') m where not exists(select 1 from profiles where id=m::uuid and role='member' and active and deleted_at is null) and not exists(select 1 from member_invites where id=m::uuid and status in ('draft','pending') and not exists(select 1 from profiles where student_id=member_invites.student_id))) then raise exception 'สมาชิกไม่ถูกต้อง';end if;
  update charges set deleted_at=now() where round_id=p_id and deleted_at is null and not (p_patch->'profile_ids' ? profile_id::text);
  insert into charges(profile_id,round_id,amount) select distinct m::uuid,p_id,(p_patch->>'amount')::numeric from jsonb_array_elements_text(p_patch->'profile_ids') m where exists(select 1 from profiles where id=m::uuid) on conflict(profile_id,round_id) do update set deleted_at=null;
  delete from prepared_bill_members where round_id=p_id;
  insert into prepared_bill_members(round_id,invite_id) select distinct p_id,m::uuid from jsonb_array_elements_text(p_patch->'profile_ids') m where exists(select 1 from member_invites where id=m::uuid);
  update rounds set penalty_max=(p_patch->>'penalty_max')::numeric,penalty_enabled=(p_patch->>'penalty_enabled')::boolean,penalty_per_day=(p_patch->>'penalty_per_day')::numeric,title=p_patch->>'title',description=p_patch->>'description',due_date=(p_patch->>'due_date')::date,due_time=case when p_patch ? 'due_time' then nullif(p_patch->>'due_time','')::time else due_time end,amount=(p_patch->>'amount')::numeric,archived=(p_patch->>'archived')::boolean where id=p_id;
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
  update expenses set responsible_name=coalesce(p_patch->>'responsible_name',responsible_name),receipt_file_id=coalesce(nullif(p_patch->>'receipt_file_id',''),receipt_file_id),title=p_patch->>'title',category=p_patch->>'category',amount=(p_patch->>'amount')::numeric,spent_on=(p_patch->>'spent_on')::date,spent_time=case when p_patch ? 'spent_time' then nullif(p_patch->>'spent_time','')::time else spent_time end,note=p_patch->>'note',voided=(p_patch->>'voided')::boolean,drive_file_id=coalesce(nullif(p_patch->>'drive_file_id',''),drive_file_id) where id=p_id;
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
end;$function$
;

CREATE OR REPLACE FUNCTION public.save_manual_income_core(p_id uuid, p_patch jsonb, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare actor_name text; old_record jsonb; new_record jsonb; target_id uuid;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if nullif(trim(p_patch->>'title'),'') is null or nullif(trim(p_patch->>'category'),'') is null then raise exception 'กรุณาระบุรายการและประเภทรายรับ';end if;
 if p_id is null then
  insert into manual_incomes(title,category,amount,received_on,note,created_by,responsible_name,drive_file_id,receipt_file_id) values(p_patch->>'title',p_patch->>'category',(p_patch->>'amount')::numeric,(p_patch->>'received_on')::date,coalesce(p_patch->>'note',''),p_actor,coalesce(p_patch->>'responsible_name',actor_name),p_patch->>'drive_file_id',p_patch->>'receipt_file_id') returning id into target_id;
 else
  if nullif(trim(p_patch->>'reason'),'') is null then raise exception 'กรุณาระบุเหตุผล';end if;
  select to_jsonb(i) into old_record from manual_incomes i where id=p_id and deleted_at is null for update;
  if old_record is null then raise exception 'ไม่พบรายการ';end if;
  target_id:=p_id;
  update manual_incomes set responsible_name=coalesce(p_patch->>'responsible_name',responsible_name),drive_file_id=coalesce(nullif(p_patch->>'drive_file_id',''),drive_file_id),receipt_file_id=coalesce(nullif(p_patch->>'receipt_file_id',''),receipt_file_id),title=p_patch->>'title',category=p_patch->>'category',amount=(p_patch->>'amount')::numeric,received_on=(p_patch->>'received_on')::date,note=coalesce(p_patch->>'note','') where id=p_id;
 end if;
 if p_patch ? 'received_time' then update manual_incomes set received_time=nullif(p_patch->>'received_time','')::time where id=target_id;end if;
 select to_jsonb(i) into new_record from manual_incomes i where id=target_id;
 insert into audit(actor,action,details) values(actor_name,case when p_id is null then 'เพิ่มรายรับกองกลาง' else 'แก้ไขรายรับกองกลาง' end,jsonb_build_object('before',old_record,'after',new_record,'reason',p_patch->>'reason'));
 return target_id;
end;$function$
;
