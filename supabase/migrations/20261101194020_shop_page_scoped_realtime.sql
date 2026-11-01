-- Scope shop Realtime notifications to users currently viewing the shop page.
-- The event contains only the changed table name; clients refetch authorized data via finance-api.
create or replace function finance_private.finance_realtime_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles p
      where p.id=auth.uid()
        and p.active
        and p.deleted_at is null
        and (
          p_topic='finance:shared'
          or p_topic='finance:shop'
          or p_topic='finance:user:'||p.id::text
          or (p_topic='finance:admin' and p.role='admin')
        )
    );
$function$;

create or replace function public.finance_notify_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  rowdata jsonb;
  olddata jsonb;
  owner_id text;
  previous_owner text;
begin
  if tg_op='UPDATE' and tg_table_name='profiles'
     and (to_jsonb(new)-'last_seen_at')=(to_jsonb(old)-'last_seen_at') then
    return null;
  end if;

  if tg_op<>'DELETE' then rowdata:=to_jsonb(new); end if;
  if tg_op<>'INSERT' then olddata:=to_jsonb(old); end if;

  if tg_table_name in ('shop_products','shop_orders','shop_payments') then
    perform realtime.send(
      jsonb_build_object('resource',tg_table_name),
      'changed',
      'finance:shop',
      true
    );
    return null;
  end if;

  owner_id:=case when tg_table_name='profiles' then rowdata->>'id' else rowdata->>'profile_id' end;
  previous_owner:=case when tg_table_name='profiles' then olddata->>'id' else olddata->>'profile_id' end;

  perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:admin',true);
  if owner_id is not null then
    perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:user:'||owner_id,true);
  end if;
  if previous_owner is not null and previous_owner is distinct from owner_id then
    perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:user:'||previous_owner,true);
  end if;

  if tg_table_name in ('rounds','manual_incomes','expenses','web_announcements','site_settings','payment_qrs') then
    perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:shared',true);
  end if;
  return null;
end;
$function$;

revoke all on function finance_private.finance_realtime_allowed(text) from public,anon;
grant execute on function finance_private.finance_realtime_allowed(text) to authenticated;
revoke all on function public.finance_notify_change() from public,anon,authenticated;
