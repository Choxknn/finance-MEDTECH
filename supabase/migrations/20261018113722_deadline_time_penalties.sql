create or replace function public.charge_fee_at(p_id uuid,p_at timestamptz)
returns numeric language plpgsql stable security invoker set search_path=public as $$
declare c charges;r rounds;received numeric;pending payments;deadline timestamptz;days numeric;
begin
 select * into c from charges where id=p_id;
 select * into r from rounds where id=c.round_id;
 if not coalesce(r.penalty_enabled,false) then return 0;end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_id and status='approved' and deleted_at is null;
 if c.fee_settled is not null and received>=c.amount+c.fee_settled then return c.fee_settled;end if;
 select * into pending from payments where charge_id=p_id and status in ('pending','review') and deleted_at is null order by created_at limit 1;
 if pending.id is not null and received+pending.amount>=c.amount+pending.fee_snapshot then return pending.fee_snapshot;end if;
 if r.due_time is null then
  days:=greatest(0,(p_at at time zone 'Asia/Bangkok')::date-r.due_date);
 else
  deadline:=(r.due_date+r.due_time) at time zone 'Asia/Bangkok';
  days:=ceil(greatest(0,extract(epoch from (p_at-deadline)))/86400);
 end if;
 return least(days*r.penalty_per_day,coalesce(r.penalty_max,1000000000000));
end;$$;
-- Keep the established signature; callers without a date now use the actual clock.
create or replace function public.charge_fee(p_id uuid,p_asof date default null)
returns numeric language sql stable security invoker set search_path=public as $$
 select public.charge_fee_at(p_id,case when p_asof is null then now() else p_asof::timestamp at time zone 'Asia/Bangkok' end);
$$;
revoke all on function public.charge_fee_at(uuid,timestamptz),public.charge_fee(uuid,date) from public,anon,authenticated;
grant execute on function public.charge_fee_at(uuid,timestamptz),public.charge_fee(uuid,date) to service_role;

create or replace function public.guard_paid_bill_time() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.due_time is distinct from old.due_time and exists(
 select 1 from payments p join charges c on c.id=p.charge_id where c.round_id=old.id
 and p.status in ('approved','pending','review') and p.deleted_at is null)
 then raise exception 'มีการชำระหรือรอตรวจแล้ว ไม่สามารถเปลี่ยนเวลาครบกำหนด';end if;
 return new;
end;$$;
revoke all on function public.guard_paid_bill_time() from public,anon,authenticated;
grant execute on function public.guard_paid_bill_time() to service_role;
create trigger guard_paid_bill_time before update of due_time on public.rounds
for each row execute function public.guard_paid_bill_time();
