create or replace function public.reset_registration_line_session(
  p_session_hash text,
  p_batch_hash text,
  p_student text,
  p_discard boolean,
  p_new_session_hash text,
  p_new_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s registration_sessions;
  i member_invites;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
     or p_batch_hash is null or p_batch_hash !~ '^[a-f0-9]{64}$'
     or p_student is null or p_student !~ '^[0-9]{5,20}$' then
    raise exception 'ข้อมูลการสมัครไม่ถูกต้อง';
  end if;

  if not coalesce(p_discard, false) and (
    p_new_session_hash is null or p_new_session_hash !~ '^[a-f0-9]{64}$'
    or p_new_code_hash is null or p_new_code_hash !~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'ข้อมูลเซสชันใหม่ไม่ถูกต้อง';
  end if;

  select * into s
  from registration_sessions
  where session_hash = p_session_hash
    and expires_at > now()
  for update;

  if s.session_hash is null then
    raise exception 'เซสชันสมัครหมดอายุแล้ว กรุณาเริ่มใหม่';
  end if;

  select * into i
  from member_invites
  where id = s.invite_id
    and batch_id = s.batch_id
    and student_id = p_student
    and status = 'pending'
  for update;

  if i.id is null or not exists (
    select 1
    from registration_batches
    where id = s.batch_id
      and token_hash = p_batch_hash
  ) then
    raise exception 'ไม่พบข้อมูลการสมัครที่ยังดำเนินการได้ กรุณาเริ่มใหม่';
  end if;

  update member_invites
  set registration_line_user_id = null,
      registration_line_display_name = null
  where id = i.id
    and batch_id = s.batch_id
    and status = 'pending';

  if p_discard then
    delete from registration_sessions
    where session_hash = s.session_hash
      and invite_id = i.id;
    return jsonb_build_object('discarded', true);
  end if;

  if exists (
    select 1
    from registration_sessions
    where session_hash = p_new_session_hash
       or code_hash = p_new_code_hash
  ) then
    raise exception 'สร้างเซสชันใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง';
  end if;

  update registration_sessions
  set session_hash = p_new_session_hash,
      code_hash = p_new_code_hash,
      line_user_id = null
  where session_hash = s.session_hash
    and invite_id = i.id;

  if not found then
    raise exception 'รีเซ็ตข้อมูล LINE ไม่สำเร็จ กรุณาลองอีกครั้ง';
  end if;

  return jsonb_build_object('discarded', false);
end;
$$;

revoke all on function public.reset_registration_line_session(text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.reset_registration_line_session(text, text, text, boolean, text, text)
  to service_role;
