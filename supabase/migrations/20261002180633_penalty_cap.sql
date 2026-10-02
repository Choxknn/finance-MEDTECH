alter table public.rounds add column penalty_max numeric(12,2) check (penalty_max > 0 and penalty_max <= 1000000);
CREATE OR REPLACE FUNCTION public.charge_fee(p_id uuid, p_asof date DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok'::text))::date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare c charges; r rounds; received numeric; pending payments;
begin
 select * into c from charges where id=p_id;
 select * into r from rounds where id=c.round_id;
 if not coalesce(r.penalty_enabled,false) then return 0;end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_id and status='approved' and deleted_at is null;
 if c.fee_settled is not null and received>=c.amount+c.fee_settled then return c.fee_settled;end if;
 select * into pending from payments where charge_id=p_id and status in ('pending','review') and deleted_at is null order by created_at limit 1;
 if pending.id is not null and received+pending.amount>=c.amount+pending.fee_snapshot then return pending.fee_snapshot;end if;
 return least(greatest(0,p_asof-r.due_date)*r.penalty_per_day,coalesce(r.penalty_max,1000000000000));
end;$function$;

drop function public.create_bill(text,text,numeric,date,uuid[],boolean,numeric,uuid);
CREATE OR REPLACE FUNCTION public.create_bill(p_title text, p_description text, p_amount numeric, p_due date, p_members uuid[], p_penalty boolean, p_rate numeric, p_actor uuid, p_max numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare rid uuid;actor_name text;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 if coalesce(array_length(p_members,1),0)=0 or exists(select 1 from unnest(p_members) m where not exists(select 1 from profiles where id=m and active and deleted_at is null and role='member')) then raise exception 'เลือกสมาชิกที่ใช้งานได้อย่างน้อยหนึ่งคน';end if;
 if p_penalty and (p_rate<=0 or p_rate is null) then raise exception 'ระบุค่าปรับต่อวัน';end if;
 if p_penalty and (p_max is null or p_max<=0 or p_max>1000000) then raise exception 'ระบุค่าปรับสูงสุด';end if;
 insert into rounds(title,description,amount,due_date,penalty_enabled,penalty_per_day,penalty_max) values(p_title,p_description,p_amount,p_due,p_penalty,case when p_penalty then p_rate else 0 end,case when p_penalty then p_max else null end) returning id into rid;
 insert into charges(profile_id,round_id,amount) select distinct m,rid,p_amount from unnest(p_members) m;
 insert into audit(actor,action,details) values(actor_name,'สร้างบิล: '||p_title,jsonb_build_object('members',p_members,'penalty_enabled',p_penalty,'penalty_per_day',p_rate,'penalty_max',p_max));return rid;
end;$function$;

revoke all on function public.create_bill(text,text,numeric,date,uuid[],boolean,numeric,uuid,numeric) from public,anon,authenticated; grant execute on function public.create_bill(text,text,numeric,date,uuid[],boolean,numeric,uuid,numeric) to service_role;

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
  if exists(select 1 from jsonb_array_elements_text(p_patch->'profile_ids') m where not exists(select 1 from profiles where id=m::uuid and role='member' and active and deleted_at is null)) then raise exception 'สมาชิกไม่ถูกต้อง';end if;
  update charges set deleted_at=now() where round_id=p_id and deleted_at is null and not (p_patch->'profile_ids' ? profile_id::text);
  insert into charges(profile_id,round_id,amount) select distinct m::uuid,p_id,(p_patch->>'amount')::numeric from jsonb_array_elements_text(p_patch->'profile_ids') m on conflict(profile_id,round_id) do update set deleted_at=null;
  update rounds set penalty_max=(p_patch->>'penalty_max')::numeric,penalty_enabled=(p_patch->>'penalty_enabled')::boolean,penalty_per_day=(p_patch->>'penalty_per_day')::numeric,title=p_patch->>'title',description=p_patch->>'description',due_date=(p_patch->>'due_date')::date,amount=(p_patch->>'amount')::numeric,archived=(p_patch->>'archived')::boolean where id=p_id;
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

