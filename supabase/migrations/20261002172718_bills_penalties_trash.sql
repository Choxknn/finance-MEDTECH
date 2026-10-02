alter table public.rounds add column penalty_enabled boolean not null default false, add column penalty_per_day numeric(12,2) not null default 0 check(penalty_per_day>=0 and penalty_per_day<=1000000);
alter table public.charges add column fee_settled numeric(12,2),add column round_snapshot jsonb,add column profile_snapshot jsonb;
alter table public.payments add column fee_snapshot numeric(12,2) not null default 0,add column charge_snapshot jsonb,add column member_snapshot jsonb;
create table public.used_slip_refs(trans_ref text primary key,created_at timestamptz not null default now());
alter table public.used_slip_refs enable row level security;
revoke all on public.used_slip_refs from public,anon,authenticated;
grant all on public.used_slip_refs to service_role;
create table public.trash_cleanup_queue(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('drive','auth')),target text not null,created_at timestamptz not null default now(),unique(kind,target));
alter table public.trash_cleanup_queue enable row level security;
revoke all on public.trash_cleanup_queue from public,anon,authenticated;
grant all on public.trash_cleanup_queue to service_role;
create function public.charge_fee(p_id uuid,p_asof date default (now() at time zone 'Asia/Bangkok')::date)
returns numeric language plpgsql stable security invoker set search_path=public as $$
declare c charges; r rounds; received numeric; pending payments;
begin
 select * into c from charges where id=p_id;
 select * into r from rounds where id=c.round_id;
 if not coalesce(r.penalty_enabled,false) then return 0;end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_id and status='approved' and deleted_at is null;
 if c.fee_settled is not null and received>=c.amount+c.fee_settled then return c.fee_settled;end if;
 select * into pending from payments where charge_id=p_id and status in ('pending','review') and deleted_at is null order by created_at limit 1;
 if pending.id is not null and received+pending.amount>=c.amount+pending.fee_snapshot then return pending.fee_snapshot;end if;
 return greatest(0,p_asof-r.due_date)*r.penalty_per_day;
end;$$;
revoke all on function public.charge_fee(uuid,date) from public,anon,authenticated;
grant execute on function public.charge_fee(uuid,date) to service_role;
create function public.charge_totals(p_ids uuid[])
returns table(id uuid,fee_amount numeric,total_amount numeric) language sql stable security invoker set search_path=public as $$
 select c.id,public.charge_fee(c.id),c.amount+public.charge_fee(c.id) from public.charges c where c.id=any(p_ids);
$$;
revoke all on function public.charge_totals(uuid[]) from public,anon,authenticated;
grant execute on function public.charge_totals(uuid[]) to service_role;
create function public.create_bill(p_title text,p_description text,p_amount numeric,p_due date,p_members uuid[],p_penalty boolean,p_rate numeric,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare rid uuid;actor_name text;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 if coalesce(array_length(p_members,1),0)=0 or exists(select 1 from unnest(p_members) m where not exists(select 1 from profiles where id=m and active and deleted_at is null and role='member')) then raise exception 'เลือกสมาชิกที่ใช้งานได้อย่างน้อยหนึ่งคน';end if;
 if p_penalty and (p_rate<=0 or p_rate is null) then raise exception 'ระบุค่าปรับต่อวัน';end if;
 insert into rounds(title,description,amount,due_date,penalty_enabled,penalty_per_day) values(p_title,p_description,p_amount,p_due,p_penalty,case when p_penalty then p_rate else 0 end) returning id into rid;
 insert into charges(profile_id,round_id,amount) select distinct m,rid,p_amount from unnest(p_members) m;
 insert into audit(actor,action,details) values(actor_name,'สร้างบิล: '||p_title,jsonb_build_object('members',p_members,'penalty_enabled',p_penalty,'penalty_per_day',p_rate));return rid;
end;$$;
revoke all on function public.create_bill(text,text,numeric,date,uuid[],boolean,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_bill(text,text,numeric,date,uuid[],boolean,numeric,uuid) to service_role;
revoke execute on function public.create_round(text,text,numeric,date,text) from service_role;
CREATE OR REPLACE FUNCTION public.reserve_payment(p_profile uuid, p_charge uuid, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare c charges; received numeric; pid uuid; fee numeric;
begin
 select * into c from charges where id=p_charge for update;
 if c.id is null or c.deleted_at is not null or c.profile_id<>p_profile then raise exception 'รายการไม่ถูกต้อง';end if;
 if exists(select 1 from rounds where id=c.round_id and (archived or deleted_at is not null)) then raise exception 'รอบนี้ปิดรับชำระแล้ว';end if;
 if not exists(select 1 from profiles where id=p_profile and active and deleted_at is null) then raise exception 'บัญชีถูกปิดหรือลบแล้ว';end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_charge and status='approved' and deleted_at is null;
 fee:=public.charge_fee(c.id);
 if p_amount<=0 or p_amount>c.amount+fee-received then raise exception 'ยอดเกินค้างชำระ';end if;
 insert into payments(profile_id,charge_id,amount,fee_snapshot) values(p_profile,p_charge,p_amount,fee) returning id into pid;
 return pid;
end;$function$;
CREATE OR REPLACE FUNCTION public.decide_payment(p_id uuid, p_decision text, p_note text, p_ref text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
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
  if c.id is null then raise exception 'บิลถูกลบถาวรแล้ว';end if;
  if exists(select 1 from used_slip_refs where trans_ref=trim(p_ref)) then raise exception 'สลิปซ้ำ';end if;
  if c.deleted_at is not null or exists(select 1 from rounds where id=c.round_id and deleted_at is not null) or exists(select 1 from profiles where id=p.profile_id and deleted_at is not null) then raise exception 'รายการหรือผู้ใช้ถูกลบแล้ว กรุณากู้คืนก่อนยืนยัน';end if;
  if p.drive_file_id is null or nullif(trim(p_ref),'') is null then raise exception 'ต้องมีหลักฐานและเลขอ้างอิง';end if;
  select coalesce(sum(amount),0) into received from payments where charge_id=p.charge_id and status='approved' and deleted_at is null;
  if received+p.amount>c.amount+p.fee_snapshot then raise exception 'ยอดเกินเรียกเก็บ';end if;
  if received+p.amount>=c.amount+p.fee_snapshot then update charges set fee_settled=p.fee_snapshot where id=c.id;end if;
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
  if coalesce(array_length(array(select jsonb_array_elements_text(p_patch->'profile_ids')::uuid),1),0)=0 then raise exception 'เลือกสมาชิกอย่างน้อยหนึ่งคน';end if;
  select to_jsonb(r) into old_record from rounds r where id=p_id for update;
  if old_record is null then raise exception 'ไม่พบรอบ'; end if;
  -- Same lock order as payment reservation/approval; lock every charge first.
  perform id from charges where round_id=p_id order by id for update;
  if (p_patch->>'amount')::numeric<>(old_record->>'amount')::numeric and exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review') and p.deleted_at is null) then
   raise exception 'รอบนี้มีการชำระหรือรอตรวจแล้ว แก้ได้เฉพาะชื่อ รายละเอียด และวันที่';
  end if;
  if exists(select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=p_id and p.status in ('approved','pending','review') and p.deleted_at is null) and ((p_patch->>'penalty_enabled')::boolean<>(old_record->>'penalty_enabled')::boolean or (p_patch->>'penalty_per_day')::numeric<>(old_record->>'penalty_per_day')::numeric or (p_patch->>'due_date')::date<>(old_record->>'due_date')::date) then raise exception 'มีการชำระหรือรอตรวจแล้ว ไม่สามารถเปลี่ยนกำหนดชำระหรือค่าปรับ';end if;
  if exists(select 1 from charges c join payments p on p.charge_id=c.id where c.round_id=p_id and c.deleted_at is null and not (p_patch->'profile_ids' ? c.profile_id::text) and p.status in ('approved','pending','review') and p.deleted_at is null) then raise exception 'ไม่สามารถนำสมาชิกที่ชำระหรือรอตรวจออกจากบิล';end if;
  if exists(select 1 from jsonb_array_elements_text(p_patch->'profile_ids') m where not exists(select 1 from profiles where id=m::uuid and role='member' and active and deleted_at is null)) then raise exception 'สมาชิกไม่ถูกต้อง';end if;
  update charges set deleted_at=now() where round_id=p_id and deleted_at is null and not (p_patch->'profile_ids' ? profile_id::text);
  insert into charges(profile_id,round_id,amount) select distinct m::uuid,p_id,(p_patch->>'amount')::numeric from jsonb_array_elements_text(p_patch->'profile_ids') m on conflict(profile_id,round_id) do update set deleted_at=null;
  update rounds set penalty_enabled=(p_patch->>'penalty_enabled')::boolean,penalty_per_day=(p_patch->>'penalty_per_day')::numeric,title=p_patch->>'title',description=p_patch->>'description',due_date=(p_patch->>'due_date')::date,amount=(p_patch->>'amount')::numeric,archived=(p_patch->>'archived')::boolean where id=p_id;
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
CREATE OR REPLACE FUNCTION public.set_record_deleted(p_entity text, p_id uuid, p_deleted boolean, p_reason text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if received+(old_record->>'amount')::numeric>target.amount+public.charge_fee(target.id) then raise exception 'กู้คืนไม่ได้ ยอดที่ยืนยันจะเกินยอดเรียกเก็บ';end if;
 end if;
 if (old_record->>'deleted_at' is not null)=p_deleted then return;end if;
 execute format('update public.%I set deleted_at=$1 where id=$2',table_name) using case when p_deleted then now() else null end,p_id;
 execute format('select to_jsonb(t) from public.%I t where id=$1',table_name) into new_record using p_id;
 insert into audit(actor,action,details) values(actor_name,(case when p_deleted then 'ลบ ' else 'กู้คืน ' end)||p_entity||': '||p_id::text,jsonb_build_object('before',old_record,'after',new_record,'reason',p_reason));
end;$function$;
alter table public.charges alter column profile_id drop not null;
alter table public.charges drop constraint charges_profile_id_fkey;
alter table public.charges add constraint charges_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete set null;
alter table public.charges alter column round_id drop not null;
alter table public.charges drop constraint charges_round_id_fkey;
alter table public.charges add constraint charges_round_id_fkey foreign key(round_id) references public.rounds(id) on delete set null;
alter table public.payments alter column profile_id drop not null;
alter table public.payments drop constraint payments_profile_id_fkey;
alter table public.payments add constraint payments_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete set null;
alter table public.payments alter column charge_id drop not null;
alter table public.payments drop constraint payments_charge_id_fkey;
alter table public.payments add constraint payments_charge_id_fkey foreign key(charge_id) references public.charges(id) on delete set null;
alter table public.payments alter column reviewed_by drop not null;
alter table public.payments drop constraint payments_reviewed_by_fkey;
alter table public.payments add constraint payments_reviewed_by_fkey foreign key(reviewed_by) references public.profiles(id) on delete set null;
alter table public.expenses alter column created_by drop not null;
alter table public.expenses drop constraint expenses_created_by_fkey;
alter table public.expenses add constraint expenses_created_by_fkey foreign key(created_by) references public.profiles(id) on delete set null;
alter table public.manual_incomes alter column created_by drop not null;
alter table public.manual_incomes drop constraint manual_incomes_created_by_fkey;
alter table public.manual_incomes add constraint manual_incomes_created_by_fkey foreign key(created_by) references public.profiles(id) on delete set null;
alter table public.line_accounts drop constraint line_accounts_profile_id_fkey;
alter table public.line_accounts add constraint line_accounts_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete cascade;
alter table public.line_link_codes drop constraint line_link_codes_profile_id_fkey;
alter table public.line_link_codes add constraint line_link_codes_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete cascade;
alter table public.notifications drop constraint notifications_profile_id_fkey;
alter table public.notifications add constraint notifications_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete cascade;
create function public.purge_trash(p_all boolean default false,p_actor uuid default null)
returns integer language plpgsql security invoker set search_path=public as $$
declare cutoff timestamptz;deleted_count integer:=0;changed integer;
begin
 perform pg_advisory_xact_lock(7086301);
 if p_all and (p_actor is null or not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null)) then raise exception 'ไม่มีสิทธิ์';end if;
 cutoff:=case when p_all then now() else now()-interval '30 days' end;
 insert into used_slip_refs(trans_ref) select trans_ref from payments where deleted_at<=cutoff and trans_ref is not null on conflict do nothing;
 insert into trash_cleanup_queue(kind,target) select 'drive',drive_file_id from payments where deleted_at<=cutoff and drive_file_id is not null union select 'drive',drive_file_id from expenses where deleted_at<=cutoff and drive_file_id is not null on conflict do nothing;
 update payments p set charge_snapshot=to_jsonb(c) from charges c where p.charge_id=c.id and c.deleted_at<=cutoff;
 delete from payments where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 delete from expenses where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 delete from manual_incomes where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 delete from charges where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 update charges c set round_snapshot=jsonb_build_object('id',r.id,'title',r.title,'description','','amount',r.amount,'due_date',r.due_date,'archived',true) from rounds r where c.round_id=r.id and r.deleted_at<=cutoff;
 update payments p set charge_snapshot=jsonb_set(p.charge_snapshot,'{round_snapshot}',jsonb_build_object('id',r.id,'title',r.title,'amount',r.amount,'due_date',r.due_date,'archived',true),true) from rounds r where p.charge_id is null and (p.charge_snapshot->>'round_id')::uuid=r.id and r.deleted_at<=cutoff;
 delete from rounds where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 update charges c set profile_snapshot=jsonb_build_object('id',p.id,'name','ผู้ใช้ที่ลบ','student_id','—','role','member','active',false) from profiles p where c.profile_id=p.id and p.deleted_at<=cutoff;
 update payments pay set member_snapshot=jsonb_build_object('id',p.id,'name','ผู้ใช้ที่ลบ','student_id','—','role','member','active',false) from profiles p where pay.profile_id=p.id and p.deleted_at<=cutoff;
 insert into trash_cleanup_queue(kind,target) select 'auth',id::text from profiles where deleted_at<=cutoff on conflict do nothing;
 delete from profiles where deleted_at<=cutoff;get diagnostics changed=row_count;deleted_count:=deleted_count+changed;
 if deleted_count>0 then insert into audit(actor,action,details) values(case when p_actor is null then 'ระบบ' else (select name from profiles where id=p_actor) end,'ลบถังขยะถาวร',jsonb_build_object('count',deleted_count,'automatic',not p_all));end if;
 return deleted_count;
end;$$;
revoke all on function public.purge_trash(boolean,uuid) from public,anon,authenticated;
grant execute on function public.purge_trash(boolean,uuid) to service_role;
create extension if not exists pg_cron;
select cron.schedule('finance-trash-30-days','5 * * * *','select public.purge_trash(false,null);');
