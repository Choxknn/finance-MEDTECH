begin;
alter table public.manual_incomes add column if not exists source_round_id uuid references public.rounds(id) on delete set null;
alter table public.manual_incomes add column if not exists source_snapshot jsonb;
create unique index if not exists manual_income_active_round on public.manual_incomes(source_round_id) where deleted_at is null and source_round_id is not null;
create or replace function public.save_bill_fund_income(p_round uuid,p_id uuid,p_patch jsonb,p_snapshot jsonb,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare actor_name text; target_id uuid; old_record jsonb; new_record jsonb;
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
 target_id:=save_manual_income(p_id,p_patch,p_actor);
 update manual_incomes set source_round_id=p_round,source_snapshot=p_snapshot where id=target_id;
 return target_id;
end;$$;
revoke all on function public.save_bill_fund_income(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_bill_fund_income(uuid,uuid,jsonb,jsonb,uuid) to service_role;
commit;
