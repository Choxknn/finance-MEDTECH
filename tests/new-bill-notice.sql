begin;
do $$
declare a uuid;m uuid:=gen_random_uuid();unlinked uuid:=gen_random_uuid();rid uuid;silent uuid;blocked boolean;
begin
 select id into a from profiles where role='admin' and active and deleted_at is null limit 1;
 insert into auth.users(id,email) values(m,m::text||'@qa.invalid'),(unlinked,unlinked::text||'@qa.invalid');
 insert into profiles(id,student_id,name,year,role,active) values(m,'98'||floor(random()*100000000000)::bigint::text,'QA linked','1','member',true),(unlinked,'97'||floor(random()*100000000000)::bigint::text,'QA unlinked','1','member',true);
 insert into line_accounts(profile_id,line_user_id) values(m,'U'||replace(m::text,'-',''));
 silent:=create_bill_with_notice('QA silent','',123.45,current_date+7,array[m],false,0,a,null,false);
 assert not exists(select 1 from notifications where new_bill_id=silent),'Unchecked must not enqueue';
 rid:=create_bill_with_notice('QA notice','test details',123.45,current_date+7,array[m,unlinked,m],true,5,a,20,true);
 assert (select count(*)=2 from charges where round_id=rid),'Distinct selected members';
 assert (select count(*)=1 from notifications where new_bill_id=rid),'Only linked selected recipient';
 assert exists(select 1 from notifications where new_bill_id=rid and profile_id=m and body like '%123.45%' and body like '%test details%' and body like '%สูงสุด 20%');
 assert (select count(*)=1 from claim_new_bill_notices(rid));
 assert (select count(*)=0 from claim_new_bill_notices(rid)),'Cannot claim twice';
 blocked:=false;begin perform create_bill_with_notice('Forbidden','',10,current_date+7,array[m],false,0,m,null,true);exception when others then blocked:=true;end;assert blocked,'Member cannot create';
 assert not has_function_privilege('authenticated','public.claim_new_bill_notices(uuid)','execute');
end;$$;
rollback;
