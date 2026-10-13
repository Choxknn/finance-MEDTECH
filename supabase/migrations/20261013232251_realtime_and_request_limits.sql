-- Private invalidation events: row values and financial details never leave via Broadcast.
create function public.finance_realtime_allowed(p_topic text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.deleted_at is null and (p_topic='finance:shared' or p_topic='finance:user:'||p.id::text or (p_topic='finance:admin' and p.role='admin')));
$$;
revoke all on function public.finance_realtime_allowed(text) from public,anon;
grant execute on function public.finance_realtime_allowed(text) to authenticated;
create policy finance_private_updates on realtime.messages for select to authenticated using(extension='broadcast' and public.finance_realtime_allowed((select realtime.topic())));
create function public.finance_notify_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb;olddata jsonb;owner_id text;previous_owner text;
begin
 if tg_op='UPDATE' and tg_table_name='profiles' and (to_jsonb(new)-'last_seen_at')=(to_jsonb(old)-'last_seen_at') then return null;end if;
 if tg_op<>'DELETE' then rowdata:=to_jsonb(new);end if;
 if tg_op<>'INSERT' then olddata:=to_jsonb(old);end if;
 owner_id:=case when tg_table_name='profiles' then rowdata->>'id' else rowdata->>'profile_id' end;
 previous_owner:=case when tg_table_name='profiles' then olddata->>'id' else olddata->>'profile_id' end;
 perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:admin',true);
 if owner_id is not null then perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:user:'||owner_id,true);end if;
 if previous_owner is not null and previous_owner is distinct from owner_id then perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:user:'||previous_owner,true);end if;
 if tg_table_name in ('rounds','manual_incomes','expenses','web_announcements','shop_products','site_settings','payment_qrs') then perform realtime.send(jsonb_build_object('resource',tg_table_name),'changed','finance:shared',true);end if;
 return null;
end $$;
revoke all on function public.finance_notify_change() from public,anon,authenticated;
do $$declare tab text;begin
 foreach tab in array array['profiles','charges','payments','rounds','shop_orders','shop_products','shop_payments','attendance_sessions','attendance_marks','manual_incomes','expenses','web_announcements','notifications','member_invites','prepared_bill_members','site_settings','payment_qrs','legacy_payments'] loop
 execute format('create trigger finance_live_change after insert or update or delete on public.%I for each row execute function public.finance_notify_change()',tab);
 end loop;
end $$;
create table public.request_rate_buckets(key_hash text not null,window_start bigint not null,hits integer not null,expires_at timestamptz not null,primary key(key_hash,window_start));
alter table public.request_rate_buckets enable row level security;
revoke all on public.request_rate_buckets from anon,authenticated;
grant all on public.request_rate_buckets to service_role;
create function public.allow_finance_request(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security invoker set search_path=public as $$
declare slot bigint;counted integer;
begin
 if p_limit<1 or p_seconds<1 or length(p_key)<>64 then raise exception 'Invalid limiter configuration';end if;
 slot:=floor(extract(epoch from now())/p_seconds)::bigint;
 insert into request_rate_buckets(key_hash,window_start,hits,expires_at) values(p_key,slot,1,now()+make_interval(secs=>p_seconds*2)) on conflict(key_hash,window_start) do update set hits=request_rate_buckets.hits+1 returning hits into counted;
 return counted<=p_limit;
end $$;
revoke all on function public.allow_finance_request(text,integer,integer) from public,anon,authenticated;
grant execute on function public.allow_finance_request(text,integer,integer) to service_role;
select cron.schedule('finance-rate-limit-cleanup','17 * * * *','delete from public.request_rate_buckets where expires_at<now();');
