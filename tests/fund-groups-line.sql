begin;
do $$
declare a uuid;m uuid;name text:='QA '||gen_random_uuid()::text;cats jsonb;uid text:='U'||replace(gen_random_uuid()::text,'-','');denied boolean;
begin
 select id into a from profiles where role='admin' and active and deleted_at is null limit 1;
 select id into m from profiles where role='member' and active and deleted_at is null limit 1;
 assert a is not null and m is not null;
 denied:=false;begin perform add_fund_category(name,m);exception when others then denied:=true;end;assert denied;
 cats:=add_fund_category(name,a);perform add_fund_category('  '||name||'  ',a);
 assert (select data->'fund_categories'=cats from site_settings where id=true),'Duplicate category';
 perform save_settings('{"siteName":"QA"}',a);
 assert (select data->'fund_categories'=cats from site_settings where id=true),'Settings must preserve categories';
 denied:=false;begin perform set_line_destination(m,uid,m,'test');exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform set_line_destination(m,'friend-name',a,'test');exception when others then denied:=true;end;assert denied;
 perform set_line_destination(m,uid,a,'rollback verification');
 assert exists(select 1 from line_accounts where profile_id=m and line_user_id=uid);
 denied:=false;begin perform set_line_destination(a,uid,a,'duplicate');exception when others then denied:=true;end;assert denied,'Cannot take another member destination';
 assert not has_function_privilege('authenticated','public.set_line_destination(uuid,text,uuid,text)','execute');
 assert not has_function_privilege('authenticated','public.add_fund_category(text,uuid)','execute');
end;$$;
rollback;
