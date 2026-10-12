alter table public.profiles add column last_seen_at timestamptz;
create or replace function public.start_registration_session(p_batch_hash text,p_student text,p_session_hash text,p_code_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare b registration_batches; i member_invites; count_recent integer;
begin
 select * into b from registration_batches where token_hash=p_batch_hash;
 select * into i from member_invites where batch_id=b.id and student_id=p_student and status='pending' for update;
 if i.id is null then raise exception 'ไม่พบรหัสนักศึกษาที่สมัครได้ในลิงก์นี้ กรุณาติดต่อผู้ดูแลระบบ';end if;
 delete from registration_sessions where expires_at<=now();
 select count(*) into count_recent from registration_sessions where invite_id=i.id;
 if count_recent>=5 then raise exception 'ขอเชื่อม LINE หลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่';end if;
 insert into registration_sessions(session_hash,code_hash,invite_id,batch_id,expires_at) values(p_session_hash,p_code_hash,i.id,b.id,now()+interval '15 minutes');
 return jsonb_build_object('name',i.name_prefix||i.first_name||' '||i.last_name,'student_id',i.student_id,'expires_at',now()+interval '15 minutes');
end;$$;
create or replace function public.consume_registration_line_code(p_hash text,p_line_user text) returns uuid language plpgsql security invoker set search_path=public as $$
declare s registration_sessions;
begin
 if p_line_user is null or p_line_user!~'^U[0-9a-f]{32}$' then return null;end if;
 select * into s from registration_sessions where code_hash=p_hash and expires_at>now() for update;
 if s.session_hash is null or s.line_user_id is not null or not exists(select 1 from member_invites where id=s.invite_id and batch_id=s.batch_id and status='pending') or exists(select 1 from line_accounts where line_user_id=p_line_user) then return null;end if;
 update registration_sessions set line_user_id=p_line_user where session_hash=s.session_hash;return s.invite_id;
end;$$;
create or replace function public.registration_session_state(p_session_hash text,p_batch_hash text,p_student text,p_claim boolean default false) returns jsonb language plpgsql security invoker set search_path=public as $$
declare s registration_sessions; i member_invites;
begin
 select * into s from registration_sessions where session_hash=p_session_hash and expires_at>now() for update;
 select * into i from member_invites where id=s.invite_id and batch_id=s.batch_id and student_id=p_student and status='pending' for update;
 if i.id is null or not exists(select 1 from registration_batches where id=s.batch_id and token_hash=p_batch_hash) then raise exception 'การสมัครหมดอายุหรือถูกใช้แล้ว กรุณาเริ่มใหม่';end if;
 if p_claim then
  if s.line_user_id is null then raise exception 'กรุณาเชื่อม LINE ก่อนตั้งรหัสผ่าน';end if;
  if exists(select 1 from profiles where student_id=p_student) or exists(select 1 from line_accounts where line_user_id=s.line_user_id) then raise exception 'รหัสนักศึกษาหรือ LINE นี้มีบัญชีแล้ว';end if;
  update member_invites set status='processing',registration_line_user_id=s.line_user_id where id=i.id;
  return to_jsonb(i);
 end if;
 return jsonb_build_object('linked',s.line_user_id is not null);
end;$$;
