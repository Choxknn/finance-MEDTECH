begin;
do $$
declare p uuid;r uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d timestamptz:='2026-10-21 15:30+07';result numeric;
begin
 select id into p from profiles where active and deleted_at is null limit 1;
 insert into rounds(id,title,amount,due_date,due_time,penalty_enabled,penalty_per_day,penalty_max) values(r,'ROLLBACK ONLY fee clock test',100,'2026-10-21','15:30',true,10,25);
 insert into charges(id,profile_id,round_id,amount) values(c,p,r,100);
 if charge_fee_at(c,d-interval '1 second')<>0 or charge_fee_at(c,d)<>0 then raise exception 'fee before deadline';end if;
 if charge_fee_at(c,d+interval '1 second')<>10 then raise exception 'first fee missing';end if;
 if charge_fee_at(c,d+interval '24 hours 1 second')<>20 then raise exception 'second fee missing';end if;
 if charge_fee_at(c,d+interval '4 days')<>25 then raise exception 'cap exceeded';end if;
 if charge_fee(c)<>charge_fee_at(c,now()) then raise exception 'default does not use clock';end if;
 update rounds set due_time=null where id=r;
 if charge_fee_at(c,'2026-10-21 23:59:59+07')<>0 or charge_fee_at(c,'2026-10-22 00:00+07')<>10 then raise exception 'legacy midnight policy changed';end if;
 update rounds set due_time='15:30' where id=r;
 insert into payments(profile_id,charge_id,amount,status,fee_snapshot) values(p,c,110,'pending',10);
 if charge_fee_at(c,d+interval '4 days')<>10 then raise exception 'pending snapshot not preserved';end if;
 begin
 update rounds set due_time='16:30' where id=r;
 raise exception 'TEST time edit was allowed';
 exception when raise_exception then if sqlerrm='TEST time edit was allowed' then raise;end if;end;
 update payments set status='approved' where charge_id=c;
 update charges set fee_settled=10 where id=c;
 if charge_fee_at(c,d+interval '4 days')<>10 then raise exception 'settled fee changed';end if;
end;$$;
select 'PASS: exact clock boundary, daily steps, cap, date-only policy, pending and settled fees, deadline guard' as result;
rollback;
