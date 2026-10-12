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
create or replace function public.claim_legacy_evidence(p_job uuid) returns setof public.legacy_payments language sql security invoker set search_path=public as $$
 update legacy_payments set evidence_state='processing' where id=(select id from legacy_payments where batch_id=p_job and evidence_state='pending' order by id for update skip locked limit 1) returning *;
$$;
revoke all on function public.claim_legacy_evidence(uuid) from public,anon,authenticated;
grant execute on function public.claim_legacy_evidence(uuid) to service_role;
create or replace function public.reserve_legacy_file(p_job uuid,p_row uuid,p_size bigint,p_type text) returns text language plpgsql security invoker set search_path=public as $$
declare target uuid:=gen_random_uuid(); sid text; budget bigint; used bigint;
begin
 if p_size<=0 or p_size>5242880 or p_type not in ('image/jpeg','image/png','image/webp') then raise exception 'Invalid image';end if;
 select student_id into sid from legacy_payments where id=p_row and batch_id=p_job and evidence_state='processing';
 if sid is null or not exists(select 1 from legacy_import_jobs where id=p_job and completed_at is null and expires_at>now()) then raise exception 'Invalid import';end if;
 update evidence_storage_settings set lease_id=target,lease_until=now()+interval '10 minutes' where id and (lease_until is null or lease_until<now()) returning budget_bytes into budget;
 if budget is null then raise exception 'กำลังจัดการพื้นที่หลักฐาน';end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into used from storage.objects where bucket_id='finance-evidence';
 if used+p_size>budget then raise exception 'พื้นที่หลักฐานเต็ม';end if;
 insert into evidence_files(path,name,size,mime_type) values(target::text,'ประวัติเดิม-'||sid||'-'||p_row::text,p_size,p_type);
 return target::text;
end;$$;
create or replace function public.finish_legacy_file(p_row uuid,p_path text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from evidence_storage_settings where id and lease_id=p_path::uuid) then raise exception 'Import lease lost';end if;
 update evidence_files set state='active' where path=p_path and state='pending';
 if not found then raise exception 'File not reserved';end if;
 update legacy_payments set evidence_state='copied',drive_file_id='sb:'||p_path,evidence_error=null where id=p_row and evidence_state='processing';
 if not found then raise exception 'Import record changed';end if;
 update evidence_storage_settings set lease_id=null,lease_until=null where id and lease_id=p_path::uuid;
end;$$;
revoke all on function public.reserve_legacy_file(uuid,uuid,bigint,text),public.finish_legacy_file(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_legacy_file(uuid,uuid,bigint,text),public.finish_legacy_file(uuid,text) to service_role;
