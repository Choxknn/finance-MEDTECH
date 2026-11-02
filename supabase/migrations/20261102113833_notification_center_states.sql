alter table public.notifications
  add column if not exists dismissed_at timestamptz;

alter table public.web_announcement_recipients
  add column if not exists seen_at timestamptz;

create table if not exists public.charge_notice_states (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  charge_id uuid not null references public.charges(id) on delete cascade,
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, charge_id)
);

create index if not exists notifications_profile_visible_recent
  on public.notifications(profile_id, created_at desc)
  where dismissed_at is null;

create index if not exists charge_notice_states_profile
  on public.charge_notice_states(profile_id);

alter table public.charge_notice_states enable row level security;
revoke all on table public.charge_notice_states from public, anon, authenticated;
grant all on table public.charge_notice_states to service_role;
