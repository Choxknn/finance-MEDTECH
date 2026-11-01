-- Persist LINE OA friendship as verified when a new batch-signup account is created.
-- The LIFF completion flow verifies friendship before registration_sessions.line_user_id is set.
alter table public.line_accounts
  add column if not exists oa_friend_check_status text
    check (oa_friend_check_status in ('added','not_friend','error')),
  add column if not exists oa_friend_check_error text;

create or replace function public.finish_member_invite(p_hash text,p_user uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare invite member_invites;
begin
 select * into invite from member_invites where token_hash=p_hash for update;
 if invite.id is null or invite.status<>'processing' then raise exception 'ลิงก์ไม่พร้อมใช้งาน';end if;
 if invite.batch_id is not null and invite.registration_line_user_id is null then raise exception 'ต้องเชื่อม LINE ก่อน';end if;
 insert into profiles(id,student_id,name,year,role,active)
 values(p_user,invite.student_id,invite.name_prefix||invite.first_name||' '||invite.last_name,invite.year,'member',true);
 if invite.batch_id is not null then
  insert into line_accounts(
   profile_id,line_user_id,oa_friend_added_at,oa_friend_checked_at,
   oa_friend_check_status,oa_friend_check_error
  ) values(
   p_user,invite.registration_line_user_id,now(),now(),'added',null
  );
 end if;
 update member_invites set status='used',used_at=now(),profile_id=p_user where id=invite.id;
 delete from registration_sessions where invite_id=invite.id;
 insert into audit(actor,action) values('ระบบสมัครสมาชิก','สร้างบัญชีจากลิงก์: '||invite.student_id);
end;$$;
