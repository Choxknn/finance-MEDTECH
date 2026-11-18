-- One-time LINE OTP recovery. Plain OTPs are never stored.
create table public.password_recovery_otps(
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 student_id text not null check(student_id~'^[0-9]{5,20}$'),
 code_hash text not null check(code_hash~'^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 attempts smallint not null default 0 check(attempts between 0 and 5),
 created_at timestamptz not null default now(),
 consumed_at timestamptz
);
create index password_recovery_otps_student_created on public.password_recovery_otps(student_id,created_at desc);
create unique index password_recovery_otps_one_active on public.password_recovery_otps(profile_id) where consumed_at is null;
alter table public.password_recovery_otps enable row level security;
revoke all on public.password_recovery_otps from public,anon,authenticated;
grant all on public.password_recovery_otps to service_role;

create function public.request_line_recovery_otp(p_student text,p_student_hash text,p_ip_hash text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare key_value text; n integer; i integer:=0; profile uuid; line_user text; otp_id uuid; caps integer[]:=array[300,20,5,1];
begin
 if p_student is null or p_student!~'^[0-9]{5,20}$' or p_student_hash is null or p_student_hash!~'^[0-9a-f]{64}$' or p_ip_hash is null or p_ip_hash!~'^[0-9a-f]{64}$' or p_code_hash is null or p_code_hash!~'^[0-9a-f]{64}$' then return null; end if;
 perform pg_advisory_xact_lock(7086302);
 delete from password_recovery_otps where created_at<now()-interval '2 days';
 delete from account_access_limits where created_at<now()-interval '2 days';
 foreach key_value in array array[
  'global:'||to_char(now(),'YYYYMMDDHH24'),
  'ip:'||p_ip_hash||':'||to_char(now(),'YYYYMMDDHH24'),
  'sid-day:'||p_student_hash||':'||to_char(now(),'YYYYMMDD'),
  'sid-cooldown:'||p_student_hash||':'||floor(extract(epoch from now())/300)::text
 ] loop
  i:=i+1;
  insert into account_access_limits(key) values(key_value)
   on conflict(key) do update set hits=account_access_limits.hits+1 returning hits into n;
  if n>caps[i] then return null; end if;
 end loop;
 select p.id,l.line_user_id into profile,line_user
 from profiles p join line_accounts l on l.profile_id=p.id
 where p.student_id=p_student and p.active and p.deleted_at is null
 limit 1;
 if profile is null or nullif(line_user,'') is null then return null; end if;
 update password_recovery_otps set consumed_at=now() where profile_id=profile and consumed_at is null;
 insert into password_recovery_otps(profile_id,student_id,code_hash,expires_at)
 values(profile,p_student,p_code_hash,now()+interval '5 minutes') returning id into otp_id;
 return jsonb_build_object('id',otp_id,'profile_id',profile,'line_user_id',line_user);
end;
$$;

create function public.verify_line_recovery_otp(p_student text,p_code_hash text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare candidate password_recovery_otps;
begin
 if p_student is null or p_student!~'^[0-9]{5,20}$' or p_code_hash is null or p_code_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select * into candidate from password_recovery_otps
 where student_id=p_student and consumed_at is null
 order by created_at desc limit 1 for update;
 if candidate.id is null then return null; end if;
 if candidate.expires_at<=now() or candidate.attempts>=5 then
  update password_recovery_otps set consumed_at=now() where id=candidate.id;
  return null;
 end if;
 if candidate.code_hash<>p_code_hash then
  update password_recovery_otps
   set attempts=attempts+1,consumed_at=case when attempts+1>=5 then now() else null end
   where id=candidate.id;
  return null;
 end if;
 update password_recovery_otps set attempts=attempts+1,consumed_at=now() where id=candidate.id;
 return candidate.profile_id;
end;
$$;
revoke all on function public.request_line_recovery_otp(text,text,text,text),public.verify_line_recovery_otp(text,text) from public,anon,authenticated;
grant execute on function public.request_line_recovery_otp(text,text,text,text),public.verify_line_recovery_otp(text,text) to service_role;

create function public.check_line_recovery_otp(p_student text,p_code_hash text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare candidate password_recovery_otps;
begin
 if p_student is null or p_student!~'^[0-9]{5,20}$' or p_code_hash is null or p_code_hash!~'^[0-9a-f]{64}$' then return false; end if;
 select * into candidate from password_recovery_otps
 where student_id=p_student and consumed_at is null
 order by created_at desc limit 1 for update;
 if candidate.id is null then return false; end if;
 if candidate.expires_at<=now() or candidate.attempts>=5 then
  update password_recovery_otps set consumed_at=now() where id=candidate.id;
  return false;
 end if;
 if candidate.code_hash<>p_code_hash then
  update password_recovery_otps set attempts=attempts+1,
   consumed_at=case when attempts+1>=5 then now() else null end
   where id=candidate.id;
  return false;
 end if;
 return true;
end;
$$;
revoke all on function public.check_line_recovery_otp(text,text) from public,anon,authenticated;
grant execute on function public.check_line_recovery_otp(text,text) to service_role;
