-- Persist LINE profile names collected during new member registration.
alter table public.member_invites
  add column if not exists registration_line_display_name text;

create or replace function public.consume_registration_line_code_with_name(
  p_hash text,
  p_line_user text,
  p_display_name text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  s registration_sessions;
begin
  if p_line_user is null or p_line_user !~ '^U[0-9a-f]{32}$' then
    return null;
  end if;

  select * into s
  from registration_sessions
  where code_hash = p_hash
    and expires_at > now()
  for update;

  if s.session_hash is null
     or s.line_user_id is not null
     or not exists (
       select 1 from member_invites
       where id = s.invite_id
         and batch_id = s.batch_id
         and status = 'pending'
     )
     or exists (
       select 1 from line_accounts
       where line_user_id = p_line_user
     ) then
    return null;
  end if;

  update member_invites
  set registration_line_display_name =
    nullif(left(btrim(coalesce(p_display_name, '')), 200), '')
  where id = s.invite_id
    and batch_id = s.batch_id
    and status = 'pending';

  if not found then
    return null;
  end if;

  update registration_sessions
  set line_user_id = p_line_user
  where session_hash = s.session_hash;

  return s.invite_id;
end;
$$;

revoke all on function public.consume_registration_line_code_with_name(text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_registration_line_code_with_name(text, text, text)
  to service_role;

create or replace function public.finish_member_invite(p_hash text, p_user uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  invite member_invites;
begin
  select * into invite
  from member_invites
  where token_hash = p_hash
  for update;

  if invite.id is null or invite.status <> 'processing' then
    raise exception 'ลิงก์ไม่พร้อมใช้งาน';
  end if;

  if invite.batch_id is not null and invite.registration_line_user_id is null then
    raise exception 'ต้องเชื่อม LINE ก่อน';
  end if;

  insert into profiles(id, student_id, name, year, role, active)
  values (
    p_user,
    invite.student_id,
    invite.name_prefix || invite.first_name || ' ' || invite.last_name,
    invite.year,
    'member',
    true
  );

  if invite.batch_id is not null then
    insert into line_accounts(
      profile_id,
      line_user_id,
      display_name,
      oa_friend_added_at,
      oa_friend_checked_at,
      oa_friend_check_status,
      oa_friend_check_error
    ) values (
      p_user,
      invite.registration_line_user_id,
      nullif(left(btrim(coalesce(invite.registration_line_display_name, '')), 200), ''),
      now(),
      now(),
      'added',
      null
    );
  end if;

  update member_invites
  set status = 'used',
      used_at = now(),
      profile_id = p_user
  where id = invite.id;

  delete from registration_sessions
  where invite_id = invite.id;

  insert into audit(actor, action)
  values ('ระบบสมัครสมาชิก', 'สร้างบัญชีจากลิงก์: ' || invite.student_id);
end;
$$;
