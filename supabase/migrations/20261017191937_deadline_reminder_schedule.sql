-- The existing minute worker remains unchanged; each deadline has three unique slots.
create or replace function public.bill_reminder_slots(p_date date,p_time time)
returns table(slot text,send_at timestamptz,deadline timestamptz)
language sql immutable security invoker set search_path=public as $$
 with d as(select (p_date+coalesce(p_time,time '23:59:59')) at time zone 'Asia/Bangkok' as deadline)
 select v.slot,v.send_at,d.deadline from d cross join lateral(values
 ('three_days',((p_date-3)+time '12:00') at time zone 'Asia/Bangkok'),
 ('two_hours',d.deadline-interval '2 hours'),
 ('overdue_day',d.deadline+interval '24 hours')) v(slot,send_at)
 where p_date is not null;
$$;
revoke all on function public.bill_reminder_slots(date,time) from public,anon,authenticated;
grant execute on function public.bill_reminder_slots(date,time) to service_role;

create or replace function public.queue_due_reminders() returns integer
language plpgsql security invoker set search_path=public as $$
declare n integer:=0;
begin
 insert into notifications(profile_id,title,body,message_kind,reminder_key,reminder_charge_id,expires_at)
 select c.profile_id,
 case s.slot when 'three_days' then 'อีก 3 วันครบกำหนดชำระ' when 'two_hours' then 'อีก 2 ชั่วโมงครบกำหนดชำระ' else 'บิลเกินกำหนดชำระ 1 วัน' end,
 r.title||E'\nยอดค้าง '||to_char(c.amount+charge_fee(c.id)-coalesce(paid.amount,0),'FM999999990.00')||
 E' บาท\nครบกำหนด '||to_char(s.deadline at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI')||' น.'||
 case when s.slot='overdue_day' then E'\nกรุณาตรวจสอบยอดล่าสุดและเร่งชำระ หากติดปัญหาติดต่อผู้ดูแลได้เลย'
 else E'\nเปิดเว็บเพื่อตรวจสอบยอดและชำระเงินก่อนครบกำหนด' end,
 'reminder',c.id::text||':'||r.due_date::text||':v2:'||to_char(coalesce(r.due_time,time '23:59:59'),'HH24MISS')||':'||s.slot,
 c.id,s.send_at+interval '10 minutes'
 from charges c join rounds r on r.id=c.round_id join profiles m on m.id=c.profile_id
 cross join lateral bill_reminder_slots(r.due_date,r.due_time) s
 left join lateral(select sum(amount) amount from payments where charge_id=c.id and status='approved' and deleted_at is null) paid on true
 where now()>=s.send_at and now()<s.send_at+interval '10 minutes'
 and not r.archived and r.deleted_at is null and c.deleted_at is null and m.active and m.deleted_at is null
 and c.amount+charge_fee(c.id)>coalesce(paid.amount,0)
 and exists(select 1 from line_accounts la where la.profile_id=c.profile_id)
 and not exists(select 1 from payments where charge_id=c.id and status in ('pending','review') and deleted_at is null)
 on conflict(reminder_key) where reminder_key is not null do nothing;
 get diagnostics n=row_count;return n;
end;$$;

create or replace function public.claim_due_reminders() returns setof public.notifications
language plpgsql security invoker set search_path=public as $$
begin
 update notifications set status='in_app',error='เลยเวลาแจ้งเตือน' where reminder_key is not null and status='queued' and expires_at<=now();
 -- Recheck both date and time when an administrator moves a bill deadline.
 update notifications n set status='in_app',error='เปลี่ยนกำหนดชำระหรือปิดบิลแล้ว'
 where n.status='queued' and n.reminder_key like '%:v2:%' and not exists(
 select 1 from charges c join rounds r on r.id=c.round_id
 where c.id=n.reminder_charge_id and c.deleted_at is null and r.deleted_at is null and not r.archived
 and split_part(n.reminder_key,':',2)=r.due_date::text
 and split_part(n.reminder_key,':',4)=to_char(coalesce(r.due_time,time '23:59:59'),'HH24MISS'));
 return query with picked as(
 select id from notifications where reminder_key is not null and status='queued' and expires_at>now()
 and (delivery_started_at is null or delivery_started_at<now()-interval '2 minutes')
 order by created_at limit 10 for update skip locked)
 update notifications n set delivery_started_at=now() from picked where n.id=picked.id returning n.*;
end;$$;
revoke all on function public.queue_due_reminders(),public.claim_due_reminders() from public,anon,authenticated;
grant execute on function public.queue_due_reminders(),public.claim_due_reminders() to service_role;
-- Stop unsent reminders from the retired 09:00 / 23:00 schedule; retain their history.
update public.notifications set status='in_app',error='เปลี่ยนเป็นตารางแจ้งเตือนใหม่แล้ว'
where status='queued' and message_kind='reminder' and reminder_key ~ ':(day|hour)$';
