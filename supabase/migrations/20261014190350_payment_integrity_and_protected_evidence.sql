-- Serialize bill submissions even across browser tabs and devices.
create or replace function public.guard_pending_bill_payment() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.status not in ('pending','review') or new.charge_id is null then return new; end if;
 perform 1 from charges where id=new.charge_id for update;
 if exists(select 1 from payments where charge_id=new.charge_id and id<>new.id and deleted_at is null and status in ('pending','review')) then
 raise exception 'บิลนี้มีสลิปรอตรวจแล้ว กรุณารอผลตรวจสอบก่อนส่งอีกครั้ง'; end if;
 return new;
end $$;
create trigger prevent_duplicate_bill_submission before insert on public.payments for each row execute function public.guard_pending_bill_payment();
revoke all on function public.guard_pending_bill_payment() from public,anon,authenticated;
grant execute on function public.guard_pending_bill_payment() to service_role;

-- Protection persists even after the finance record is replaced or purged.
alter table public.evidence_files add column protected boolean not null default false;
update public.evidence_files f set protected=true where name ~ '^(income|expense|qr|payment-qr)(-|\.)'
 or exists(select 1 from manual_incomes i where 'sb:'||f.path in (i.drive_file_id,i.receipt_file_id))
 or exists(select 1 from expenses e where 'sb:'||f.path in (e.drive_file_id,e.receipt_file_id));
create or replace function public.protect_finance_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 update evidence_files set protected=true where 'sb:'||path in (new.drive_file_id,new.receipt_file_id);
 return new;
end $$;
create trigger protect_income_evidence after insert or update of drive_file_id,receipt_file_id on public.manual_incomes for each row execute function public.protect_finance_evidence();
create trigger protect_expense_evidence after insert or update of drive_file_id,receipt_file_id on public.expenses for each row execute function public.protect_finance_evidence();
create or replace function public.guard_protected_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.protected and (tg_op='DELETE' or not new.protected or new.state in ('deleting','deleted') and old.state not in ('deleting','deleted')) then raise exception 'ห้ามลบหลักฐานการเงินและ QR ชำระเงิน';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger retain_finance_evidence before update or delete on public.evidence_files for each row execute function public.guard_protected_evidence();
create or replace function public.evidence_cleanup_candidates() returns setof public.evidence_files language sql security invoker set search_path=public as $$
 select f.* from evidence_files f where f.state='active' and not f.protected and f.created_at<now()-interval '1 hour'
 and not exists(select 1 from payments p where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and p.deleted_at is null)
 and not exists(select 1 from shop_payments p join shop_orders o on o.id=p.order_id where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and o.deleted_at is null)
 order by f.created_at,f.path limit 100;
$$;
revoke all on function public.protect_finance_evidence(),public.guard_protected_evidence() from public,anon,authenticated;
grant execute on function public.protect_finance_evidence(),public.guard_protected_evidence() to service_role;

create or replace function public.save_bill_fund_income(p_round uuid,p_id uuid,p_patch jsonb,p_snapshot jsonb,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare actor_name text; target_id uuid; old_record jsonb; new_record jsonb; actual numeric; fees numeric; people bigint; snap jsonb;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if not exists(select 1 from rounds where id=p_round and deleted_at is null) then raise exception 'ไม่พบบิล';end if;
 if p_id is null then
  if exists(select 1 from manual_incomes where source_round_id=p_round and deleted_at is null) then raise exception 'บิลนี้นำเข้ากองกลางแล้ว กรุณาแก้ไขรายการเดิม';end if;
 else
  if not exists(select 1 from manual_incomes where id=p_id and source_round_id=p_round and deleted_at is null) then raise exception 'รายการที่แก้ไขไม่ตรงกับบิล';end if;
 end if;
 perform 1 from charges where round_id=p_round order by id for update;
 select coalesce(sum(p.amount),0),count(distinct p.profile_id) into actual,people from payments p join charges c on c.id=p.charge_id where c.round_id=p_round and c.deleted_at is null and p.deleted_at is null and p.status='approved';
 select coalesce(sum(greatest(0,x.received-x.amount)),0) into fees from (select c.id,c.amount,coalesce(sum(p.amount),0) received from charges c left join payments p on p.charge_id=c.id and p.status='approved' and p.deleted_at is null where c.round_id=p_round and c.deleted_at is null group by c.id,c.amount) x;
 if actual<=0 then raise exception 'บิลนี้ยังไม่มียอดชำระที่ยืนยันแล้ว';end if;
 if round((p_snapshot->>'collected')::numeric,2) is distinct from actual then raise exception 'ยอดชำระเปลี่ยนแล้ว กรุณาเปิดรายการใหม่ก่อนบันทึก';end if;
 if (p_patch->>'amount')::numeric<>actual and nullif(trim(p_patch->>'note'),'') is null then raise exception 'ยอดนำเข้าต่างจากยอดเก็บจริง กรุณาระบุเหตุผลในหมายเหตุ';end if;
 snap:=jsonb_build_object('title',(select title from rounds where id=p_round),'paid_people',people,'principal',actual-fees,'penalties',fees,'collected',actual,'adjustment',(p_patch->>'amount')::numeric-actual,'captured_at',now());
 target_id:=save_manual_income(p_id,p_patch,p_actor);
 update manual_incomes set source_round_id=p_round,source_snapshot=snap where id=target_id;
 return target_id;
end;$$;
