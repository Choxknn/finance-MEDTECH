create or replace function public.is_auth_session_active(p_user_id uuid, p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.sessions s
    where s.id = p_session_id
      and s.user_id = p_user_id
  );
$function$;

revoke all on function public.is_auth_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_auth_session_active(uuid, uuid) to service_role;

create or replace function public.revoke_user_auth_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_refresh_tokens integer := 0;
  deleted_sessions integer := 0;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  delete from auth.refresh_tokens rt
  where rt.user_id = p_user_id::text
     or rt.session_id in (
       select s.id
       from auth.sessions s
       where s.user_id = p_user_id
     );
  get diagnostics deleted_refresh_tokens = row_count;

  delete from auth.sessions s
  where s.user_id = p_user_id;
  get diagnostics deleted_sessions = row_count;

  return deleted_refresh_tokens + deleted_sessions;
end;
$function$;

revoke all on function public.revoke_user_auth_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_auth_sessions(uuid) to service_role;
