alter table public.manual_incomes add column request_key uuid;
alter table public.expenses add column request_key uuid;
alter table public.manual_incomes add constraint income_request_once unique(created_by,request_key);
alter table public.expenses add constraint expense_request_once unique(created_by,request_key);
alter function public.save_manual_income(uuid,jsonb,uuid) rename to save_manual_income_core;
create function public.save_manual_income(p_id uuid,p_patch jsonb,p_actor uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare k uuid:=nullif(p_patch->>'request_key','')::uuid; saved uuid;
begin
 perform pg_advisory_xact_lock(7086301);
 if not exists(select 1 from profiles where id=p_actor and active and deleted_at is null and role='admin') then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_id is null and k is not null then select id into saved from manual_incomes where created_by=p_actor and request_key=k;if saved is not null then return saved;end if;end if;
 saved:=save_manual_income_core(p_id,p_patch,p_actor);
 if p_id is null and k is not null then update manual_incomes set request_key=k where id=saved;end if;
 return saved;
end $$;
revoke all on function public.save_manual_income(uuid,jsonb,uuid),public.save_manual_income_core(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_manual_income(uuid,jsonb,uuid),public.save_manual_income_core(uuid,jsonb,uuid) to service_role;
