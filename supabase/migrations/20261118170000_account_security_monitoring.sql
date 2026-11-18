-- Account recovery security monitoring: event history plus temporary network blocks.
create table public.account_security_events (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid references public.profiles(id) on delete set null,
 event_type text not null check (event_type in (
  'otp_requested','otp_sent','otp_request_unavailable','otp_delivery_failed',
  'otp_verified','otp_verification_failed','password_changed','sessions_revoked',
  'rate_limit_exceeded','captcha_failed','ip_temporarily_blocked'
 )),
 severity text not null default 'info' check (severity in ('info','warning','high')),
 message text not null check (char_length(message) between 1 and 250),
 ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
 target_hash text check (target_hash is null or target_hash ~ '^[0-9a-f]{64}$'),
 details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index account_security_events_profile_created
 on public.account_security_events(profile_id,created_at desc);
create index account_security_events_ip_type_created
 on public.account_security_events(ip_hash,event_type,created_at desc);
create index account_security_events_target_created
 on public.account_security_events(ip_hash,target_hash,event_type,created_at desc);
alter table public.account_security_events enable row level security;
revoke all on public.account_security_events from public,anon,authenticated;
grant select on public.account_security_events to authenticated;
grant all on public.account_security_events to service_role;
create policy account_security_events_read_own_or_admin
 on public.account_security_events for select to authenticated
 using (
  profile_id=(select auth.uid())
  or exists (
   select 1 from public.profiles viewer
   where viewer.id=(select auth.uid())
     and viewer.role='admin'
     and viewer.active=true
     and viewer.deleted_at is null
  )
 );

-- Store only keyed hashes of source IPs; raw addresses are never retained.
create table public.account_security_blocks (
 ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
 reason text not null check (char_length(reason) between 1 and 200),
 blocked_until timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.account_security_blocks enable row level security;
revoke all on public.account_security_blocks from public,anon,authenticated;
grant all on public.account_security_blocks to service_role;

select cron.schedule(
 'account-security-monitoring-cleanup',
 '30 3 * * *',
 $job$delete from public.account_security_events where created_at < now() - interval '180 days';
delete from public.account_security_blocks where blocked_until < now() - interval '1 day';$job$
);
