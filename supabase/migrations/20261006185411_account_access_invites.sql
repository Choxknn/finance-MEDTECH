create table public.member_invites(
 id uuid primary key default gen_random_uuid(), token_hash text unique not null check(token_hash~'^[0-9a-f]{64}$'),
 student_id text not null check(student_id~'^[0-9]{5,20}$'), name_prefix text not null, first_name text not null,last_name text not null,
 year text not null check(year in ('1','2','3','4')), expires_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','used','revoked')),
 created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),used_at timestamptz,profile_id uuid references public.profiles(id) on delete set null
);
create unique index member_invites_active_student on public.member_invites(student_id) where status in ('pending','processing');
alter table public.member_invites enable row level security;
revoke all on public.member_invites from anon,authenticated;
grant all on public.member_invites to service_role;
create table public.account_access_limits(key text primary key,hits integer not null default 1,created_at timestamptz not null default now());
alter table public.account_access_limits enable row level security;
revoke all on public.account_access_limits from anon,authenticated;
grant all on public.account_access_limits to service_role;

create function public.create_member_invite(p_student text,p_prefix text,p_first text,p_last text,p_year text,p_expires timestamptz,p_hash text,p_actor uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare actor_name text; result uuid;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_student is null or p_student!~'^[0-9]{5,20}$' or nullif(trim(p_prefix),'') is null or length(p_prefix)>30 or nullif(trim(p_first),'') is null or length(p_first)>60 or nullif(trim(p_last),'') is null or length(p_last)>60 or length(p_prefix||p_first||' '||p_last)>120 or p_year is null or p_year not in ('1','2','3','4') or p_expires is null or p_expires<=now()+interval '1 minute' or p_expires>now()+interval '30 days' then raise exception 'ข้อมูลผู้สมัครหรือวันหมดอายุไม่ถูกต้อง';end if;
 if exists(select 1 from profiles where student_id=p_student) then raise exception 'รหัสนักศึกษานี้มีบัญชีแล้ว';end if;
 if exists(select 1 from member_invites where student_id=p_student and status='processing') then raise exception 'กำลังสร้างบัญชีนี้ กรุณาลองใหม่ภายหลัง';end if;
 update member_invites set status='revoked' where student_id=p_student and status='pending';
 insert into member_invites(student_id,name_prefix,first_name,last_name,year,expires_at,token_hash,created_by) values(p_student,trim(p_prefix),trim(p_first),trim(p_last),p_year,p_expires,p_hash,p_actor) returning id into result;
 insert into audit(actor,action) values(actor_name,'สร้างลิงก์สมัคร: '||p_student);
 return result;
end;$$;
create function public.claim_member_invite(p_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare invite member_invites;
begin
 select * into invite from member_invites where token_hash=p_hash for update;
 if invite.id is null or invite.status<>'pending' or invite.expires_at<=now() then raise exception 'ลิงก์หมดอายุ ถูกใช้แล้ว หรือกำลังดำเนินการ';end if;
 if exists(select 1 from profiles where student_id=invite.student_id) then raise exception 'รหัสนักศึกษานี้มีบัญชีแล้ว';end if;
 update member_invites set status='processing' where id=invite.id;
 return jsonb_build_object('id',invite.id,'student_id',invite.student_id,'name_prefix',invite.name_prefix,'first_name',invite.first_name,'last_name',invite.last_name,'year',invite.year);
end;$$;
create function public.finish_member_invite(p_hash text,p_user uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare invite member_invites;
begin
 select * into invite from member_invites where token_hash=p_hash for update;
 if invite.id is null or invite.status<>'processing' then raise exception 'ลิงก์ไม่พร้อมใช้งาน';end if;
 insert into profiles(id,student_id,name,year,role,active) values(p_user,invite.student_id,invite.name_prefix||invite.first_name||' '||invite.last_name,invite.year,'member',true);
 update member_invites set status='used',used_at=now(),profile_id=p_user where id=invite.id;
 insert into audit(actor,action) values('ระบบสมัครสมาชิก','สร้างบัญชีจากลิงก์: '||invite.student_id);
end;$$;
create function public.revoke_member_invite(p_id uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 update member_invites set status='revoked' where id=p_id and status='pending';
 if not found then raise exception 'ลิงก์ถูกใช้แล้วหรือกำลังสร้างบัญชี';end if;
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'ยกเลิกลิงก์สมัคร: '||p_id::text);
end;$$;

create function public.request_line_recovery(p_student text,p_student_hash text,p_ip_hash text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare key_value text; n integer; i integer:=0; profile uuid; notification uuid; caps integer[]:=array[300,20,5,1];
begin
 delete from account_access_limits where created_at<now()-interval '2 days';
 foreach key_value in array array['global:'||to_char(now(),'YYYYMMDDHH24'),'ip:'||p_ip_hash||':'||to_char(now(),'YYYYMMDDHH24'),'sid-day:'||p_student_hash||':'||to_char(now(),'YYYYMMDD'),'sid-cooldown:'||p_student_hash||':'||floor(extract(epoch from now())/300)::text] loop
  i:=i+1;
  insert into account_access_limits(key) values(key_value) on conflict(key) do update set hits=account_access_limits.hits+1 returning hits into n;
  if n>caps[i] then return null;end if;
 end loop;
 select p.id into profile from profiles p join line_accounts l on l.profile_id=p.id where p.student_id=p_student and p.active and p.deleted_at is null;
 if profile is null then return null;end if;
 insert into notifications(profile_id,title,body,message_kind) values(profile,'ตั้งรหัสผ่านใหม่','ได้รับคำขอตั้งรหัสผ่านใหม่จากหน้าเข้าสู่ระบบ กดปุ่มเพื่อตั้งรหัสใหม่ หากคุณไม่ได้ขอ สามารถละเว้นข้อความนี้ได้','password') returning id into notification;
 return notification;
end;$$;
revoke all on function public.create_member_invite(text,text,text,text,text,timestamptz,text,uuid),public.claim_member_invite(text),public.finish_member_invite(text,uuid),public.revoke_member_invite(uuid,uuid),public.request_line_recovery(text,text,text) from public,anon,authenticated;
grant execute on function public.create_member_invite(text,text,text,text,text,timestamptz,text,uuid),public.claim_member_invite(text),public.finish_member_invite(text,uuid),public.revoke_member_invite(uuid,uuid),public.request_line_recovery(text,text,text) to service_role;
