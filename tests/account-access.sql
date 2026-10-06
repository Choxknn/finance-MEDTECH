begin;
do $$
declare admin_id uuid;member_id uuid;sid text:='99'||floor(random()*1000000000000)::bigint::text;h text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');iid uuid;uid uuid:=gen_random_uuid();blocked boolean;info jsonb;n uuid;ip text:=gen_random_uuid()::text;
begin
 select id into admin_id from profiles where role='admin' and active and deleted_at is null limit 1;
 select id into member_id from profiles where role='member' and active and deleted_at is null limit 1;
 blocked:=false;begin perform create_member_invite(sid,'นาย','ชื่อ','สกุล','1',now()+interval '1 day',h,member_id);exception when others then blocked:=true;end;assert blocked,'Member cannot invite';
 blocked:=false;begin perform create_member_invite(sid,'นาย','ชื่อ','สกุล','1',now()-interval '1 day',h,admin_id);exception when others then blocked:=true;end;assert blocked,'Expired invite rejected';
 iid:=create_member_invite(sid,'นาย','ชื่อ','สกุล','1',now()+interval '1 day',h,admin_id);
 assert exists(select 1 from member_invites where id=iid and status='pending');
 info:=claim_member_invite(h);assert info->>'student_id'=sid;
 blocked:=false;begin perform claim_member_invite(h);exception when others then blocked:=true;end;assert blocked,'Concurrent/replayed claim rejected';
 insert into auth.users(id,email) values(uid,sid||'@qa.invalid');
 perform finish_member_invite(h,uid);
 assert exists(select 1 from profiles where id=uid and student_id=sid and name='นายชื่อ สกุล' and role='member' and active),'Reserved identity used';
 assert exists(select 1 from member_invites where id=iid and status='used');
 blocked:=false;begin perform claim_member_invite(h);exception when others then blocked:=true;end;assert blocked;
 insert into line_accounts(profile_id,line_user_id) values(uid,'U'||replace(gen_random_uuid()::text,'-',''));
 n:=request_line_recovery(sid,h,ip);assert n is not null;assert exists(select 1 from notifications where id=n and profile_id=uid and message_kind='password');
 assert request_line_recovery(sid,h,ip) is null,'Repeated request throttled';
 assert request_line_recovery('00000000000000000000','unknown-test',ip) is null,'Unknown account does not enqueue';
 h:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');iid:=create_member_invite(sid||'1','นางสาว','ชื่อ','สกุล','2',now()+interval '1 day',h,admin_id);
 perform revoke_member_invite(iid,admin_id);blocked:=false;begin perform claim_member_invite(h);exception when others then blocked:=true;end;assert blocked;
 assert not has_function_privilege('authenticated','public.claim_member_invite(text)','execute');
 assert not has_table_privilege('anon','public.member_invites','select');
end;$$;
rollback;
