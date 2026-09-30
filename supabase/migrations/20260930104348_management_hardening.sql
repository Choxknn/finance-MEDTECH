create or replace function public.manage_record(p_entity text,p_id uuid,p_patch jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare old_record jsonb; new_record jsonb; actor_name text; charge_record charges; old_amount numeric;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 if p_entity='round' then
  select to_jsonb(r) into old_record from rounds r where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรอบ'; end if;
  -- Same lock order as payment reservation/approval; lock every charge first.
  perform id from charges where round_id=p_id order by id for update;
  if (p_patch->>'amount')::numeric<>(old_record->>'amount')::numeric and exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review')) then
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
  update profiles set name=p_patch->>'name',year=p_patch->>'year',role=p_patch->>'role',active=(p_patch->>'active')::boolean where id=p_id;
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
end;$$;

create or replace function public.save_settings(p_values jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare previous jsonb; actor_name text;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 select data into previous from site_settings where id=true for update;
 update site_settings set data=p_values where id=true;
 insert into audit(actor,action,details) values(actor_name,'แก้ไขการตั้งค่าเว็บ',jsonb_build_object('before',previous||jsonb_build_object('paymentQrUrl',case when previous->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else previous->>'paymentQrUrl' end),'after',p_values||jsonb_build_object('paymentQrUrl',case when p_values->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else p_values->>'paymentQrUrl' end)));
end;$$;
