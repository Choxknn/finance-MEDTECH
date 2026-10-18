-- Run in a transaction only; never commit these fixtures.
begin;
do $$
declare p uuid;r uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d timestamp:=(now() at time zone 'Asia/Bangkok')+interval '2 hours'-interval '1 minute';n integer;
begin
 if (select send_at from bill_reminder_slots(date '2026-10-21',time '15:30') where slot='three_days') <> timestamptz '2026-10-18 12:00+07' then raise exception 'three day slot incorrect';end if;
 if (select send_at from bill_reminder_slots(date '2026-10-21',time '00:30') where slot='two_hours') <> timestamptz '2026-10-20 22:30+07' then raise exception 'midnight crossover incorrect';end if;
 if (select send_at from bill_reminder_slots(date '2026-10-21',time '15:30') where slot='overdue_day') <> timestamptz '2026-10-22 15:30+07' then raise exception 'overdue day incorrect';end if;
 if (select deadline from bill_reminder_slots(date '2026-10-21',null) limit 1) <> timestamptz '2026-10-21 23:59:59+07' then raise exception 'legacy deadline incorrect';end if;
 select m.id into p from profiles m join line_accounts a on a.profile_id=m.id where m.active and m.deleted_at is null limit 1;
 if p is null then raise exception 'no linked fixture owner';end if;
 insert into rounds(id,title,amount,due_date,due_time) values(r,'ROLLBACK ONLY reminder test',1,d::date,d::time);
 insert into charges(id,profile_id,round_id,amount) values(c,p,r,1);
 perform queue_due_reminders();perform queue_due_reminders();
 select count(*) into n from notifications where reminder_charge_id=c;
 if n<>1 then raise exception 'expected exactly one notification, got %',n;end if;
 if not exists(select 1 from notifications where reminder_charge_id=c and title='อีก 2 ชั่วโมงครบกำหนดชำระ' and position(chr(10) in body)>0) then raise exception 'message incorrect';end if;
 update rounds set due_time=due_time+interval '1 hour' where id=r;
 perform claim_due_reminders();
 if not exists(select 1 from notifications where reminder_charge_id=c and status='in_app') then raise exception 'changed time was not cancelled';end if;
 delete from notifications where reminder_charge_id=c;
 update rounds set due_time=d::time where id=r;
 insert into payments(profile_id,charge_id,amount,status) values(p,c,1,'pending');
 perform queue_due_reminders();
 if exists(select 1 from notifications where reminder_charge_id=c) then raise exception 'pending payment was reminded';end if;
 update payments set status='approved' where charge_id=c;
 perform queue_due_reminders();
 if exists(select 1 from notifications where reminder_charge_id=c) then raise exception 'paid charge was reminded';end if;
end;$$;
select 'PASS: slots, timezone, default time, duplicate prevention, deadline edits, pending/paid exclusion' as result;

rollback;
