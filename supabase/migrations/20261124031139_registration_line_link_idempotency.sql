create or replace function public.consume_registration_line_code_with_name(
  p_hash text,
  p_line_user text,
  p_display_name text
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
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
     or not exists (
       select 1 from member_invites
       where id = s.invite_id
         and batch_id = s.batch_id
         and status = 'pending'
     ) then
    return null;
  end if;

  -- A retry from the same LIFF session is safe and idempotent.
  if s.line_user_id is not null then
    if s.line_user_id = p_line_user then
      return s.invite_id;
    end if;
    return null;
  end if;

  if exists (
    select 1 from line_accounts
    where line_user_id = p_line_user
  ) or exists (
    select 1 from registration_sessions
    where line_user_id = p_line_user
      and session_hash <> s.session_hash
      and expires_at > now()
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
$function$;
