-- Private management API. Existing financial records and evidence are retained.
create table public.site_settings(id boolean primary key default true check(id), data jsonb not null default '{}'::jsonb);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from public,anon,authenticated;
grant all on public.site_settings to service_role;
insert into public.site_settings(data) values ('{"siteName":"finance MEDTECH","bankName":"พร้อมเพย์ อี-วอลเล็ต / G-Wallet","accountName":"ภานุมาศ นกไทย","accountNumber":"006660001474178","paymentQrUrl":"./payment-qr.png","lineOaUrl":"https://lin.ee/7VYJbx0"}');
alter table public.rounds add column archived boolean not null default false;
alter table public.expenses add column voided boolean not null default false;
alter table public.audit add column details jsonb;

create function public.manage_record(p_entity text,p_id uuid,p_patch jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare old_record jsonb; new_record jsonb; actor_name text; c charges; old_amount numeric;
begin
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
  select * into c from charges where id=p_id for update;
  if c.id is null then raise exception 'ไม่พบรายการ';end if;
  if exists(select 1 from payments where charge_id=p_id and status in ('approved','pending','review')) then raise exception 'มีการชำระหรือรอตรวจแล้ว ไม่สามารถเปลี่ยนยอด';end if;
  old_record=to_jsonb(c);
  update charges set amount=(p_patch->>'amount')::numeric where id=p_id;
  select to_jsonb(x) into new_record from charges x where id=p_id;
 else raise exception 'ชนิดรายการไม่ถูกต้อง';
 end if;
 insert into audit(actor,action,details) values(actor_name,'แก้ไข '||p_entity||': '||p_id::text,jsonb_build_object('before',old_record,'after',new_record,'reason',p_patch->>'reason'));
end;$$;
revoke all on function public.manage_record(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.manage_record(text,uuid,jsonb,uuid) to service_role;

create function public.save_settings(p_values jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare previous jsonb; actor_name text;
begin
 select name into actor_name from profiles where id=p_actor and active and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 select data into previous from site_settings where id=true for update;
 update site_settings set data=p_values where id=true;
 insert into audit(actor,action,details) values(actor_name,'แก้ไขการตั้งค่าเว็บ',jsonb_build_object('before',previous,'after',p_values));
end;$$;
revoke all on function public.save_settings(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_settings(jsonb,uuid) to service_role;

create or replace function public.reserve_payment(p_profile uuid,p_charge uuid,p_amount numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare c charges; received numeric; pid uuid;
begin
 select * into c from charges where id=p_charge for update;
 if c.id is null or c.profile_id<>p_profile then raise exception 'รายการไม่ถูกต้อง';end if;
 if exists(select 1 from rounds where id=c.round_id and archived) then raise exception 'รอบนี้ปิดรับชำระแล้ว';end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_charge and status='approved';
 if p_amount<=0 or p_amount>c.amount-received then raise exception 'ยอดเกินค้างชำระ';end if;
 insert into payments(profile_id,charge_id,amount) values(p_profile,p_charge,p_amount) returning id into pid;
 return pid;
end;$$;
