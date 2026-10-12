begin;
create table if not exists public.legacy_import_jobs(id uuid primary key, token_hash text not null unique, expires_at timestamptz not null, completed_at timestamptz, source_sha256 text not null, created_at timestamptz not null default now());
alter table public.legacy_import_jobs enable row level security;
revoke all on public.legacy_import_jobs from public,anon,authenticated;
grant all on public.legacy_import_jobs to service_role;
create table if not exists public.legacy_payments(
 id uuid primary key, batch_id uuid not null references public.legacy_import_jobs(id), source_key text not null unique,
 student_id text not null, profile_id uuid references public.profiles(id) on delete set null,
 title text not null, amount numeric(12,2) not null check(amount>0), paid_at timestamptz not null,
 original_status text not null, source_url text, drive_file_id text,
 evidence_state text not null check(evidence_state in ('missing','pending','processing','copied','failed')),
 evidence_error text, imported_at timestamptz not null default now()
);
create index if not exists legacy_payments_student on public.legacy_payments(student_id);
create index if not exists legacy_payments_profile on public.legacy_payments(profile_id,paid_at desc);
alter table public.legacy_payments enable row level security;
revoke all on public.legacy_payments from public,anon,authenticated;
grant all on public.legacy_payments to service_role;
create or replace function public.bind_legacy_student_history() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 update legacy_payments set profile_id=new.id where profile_id is null and student_id=new.student_id;
 return new;
end;$$;
revoke all on function public.bind_legacy_student_history() from public,anon,authenticated;
grant execute on function public.bind_legacy_student_history() to service_role;
drop trigger if exists bind_legacy_student_history on public.profiles;
create trigger bind_legacy_student_history after insert or update of student_id on public.profiles for each row execute function public.bind_legacy_student_history();
commit;
