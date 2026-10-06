-- Run in a transaction and always roll back: creates only isolated fixture bills.
begin;
do $$
declare a uuid; m uuid; r uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); ref text:='TEST-'||gen_random_uuid()::text; result jsonb; blocked boolean;
begin
 select id into a from profiles where role='admin' and active and deleted_at is null limit 1;
 select id into m from profiles where role='member' and active and deleted_at is null limit 1;
 assert a is not null and m is not null,'Test requires existing active roles';
 insert into rounds(id,title,amount,due_date) values(r,'Rollback status fixture',100,current_date);
 insert into charges(id,profile_id,round_id,amount) values(c,m,r,100);
 insert into payments(profile_id,charge_id,amount,status,source,trans_ref) values(m,c,25,'approved','test',ref);
 blocked:=false;
 begin perform admin_set_bill_status(c,'approved','test',m,25,75,q);exception when others then blocked:=true;end;
 assert blocked,'Member must be rejected';
 blocked:=false;
 begin perform admin_set_bill_status(c,'approved','test',a,0,100,q);exception when others then blocked:=true;end;
 assert blocked,'Stale balance must be rejected';
 result:=admin_set_bill_status(c,'approved','test',a,25,75,q);
 assert (select sum(amount)=100 from payments where charge_id=c and status='approved'),'Only outstanding balance should be collected';
 perform admin_set_bill_status(c,'approved','test',a,25,75,q);
 assert (select count(*)=2 from payments where charge_id=c),'Retry must be idempotent';
 assert (select trans_ref='ADMIN-'||q::text from payments where id=q),'Reference must be generated';
 perform admin_set_bill_status(c,'unpaid','test undo',a,100,0,gen_random_uuid());
 assert not exists(select 1 from payments where charge_id=c and status='approved'),'Unpaid removes approved income';
 assert exists(select 1 from payments where charge_id=c and trans_ref=ref),'Bank reference retained';
 assert (select count(*)=2 from payments where charge_id=c),'Evidence/history retained';
 insert into payments(profile_id,charge_id,amount,status) values(m,c,100,'review');
 blocked:=false;
 begin perform admin_set_bill_status(c,'approved','test',a,0,100,gen_random_uuid());exception when others then blocked:=true;end;
 assert blocked,'Pending verification cannot be overwritten';
 assert not has_function_privilege('authenticated','public.admin_set_bill_status(uuid,text,text,uuid,numeric,numeric,uuid)','execute'),'RPC must be server only';
end;$$;
rollback;
