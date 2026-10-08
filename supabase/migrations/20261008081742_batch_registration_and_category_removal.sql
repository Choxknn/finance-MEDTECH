-- Prepared identities are private until activated through a scoped, expiring batch.
alter table public.member_invites drop constraint member_invites_status_check;
alter table public.member_invites add constraint member_invites_status_check check(status in ('draft','pending','processing','used','revoked'));
drop index public.member_invites_active_student;
create unique index member_invites_active_student on public.member_invites(student_id) where status in ('draft','pending','processing');
create table public.registration_batches(id uuid primary key default gen_random_uuid(),token_hash text unique not null check(token_hash~'^[0-9a-f]{64}$'),expires_at timestamptz not null,created_at timestamptz not null default now(),created_by uuid references public.profiles(id) on delete set null);
alter table public.member_invites add column batch_id uuid references public.registration_batches(id),add column registration_line_user_id text;
create index on public.member_invites(batch_id);
create table public.registration_sessions(session_hash text primary key check(session_hash~'^[0-9a-f]{64}$'),code_hash text unique not null,invite_id uuid not null references public.member_invites(id) on delete cascade,batch_id uuid not null references public.registration_batches(id),expires_at timestamptz not null,line_user_id text);
create index on public.registration_sessions(invite_id);
alter table public.registration_batches enable row level security;
alter table public.registration_sessions enable row level security;
revoke all on public.registration_batches,public.registration_sessions from public,anon,authenticated;
grant all on public.registration_batches,public.registration_sessions to service_role;

create function public.prepare_registration_members(p_rows jsonb,p_actor uuid) returns integer language plpgsql security invoker set search_path=public as $$
declare r jsonb; n integer:=0;
begin
 perform pg_advisory_xact_lock(7086301);
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'เพิ่มครั้งละ 1–500 คน';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'student_id','')!~'^[0-9]{5,20}$' or coalesce(r->>'year','') not in ('1','2','3','4') or length(trim(coalesce(r->>'name_prefix',''))) not between 1 and 30 or length(trim(coalesce(r->>'first_name',''))) not between 1 and 60 or length(trim(coalesce(r->>'last_name',''))) not between 1 and 60 or length((r->>'name_prefix')||(r->>'first_name')||' '||(r->>'last_name'))>120 then raise exception 'ข้อมูลสมาชิกไม่ถูกต้อง';end if;
  if exists(select 1 from profiles where student_id=r->>'student_id') or exists(select 1 from member_invites where student_id=r->>'student_id' and status in ('draft','pending','processing')) then raise exception 'รหัสนักศึกษาซ้ำ: %',r->>'student_id';end if;
  insert into member_invites(student_id,name_prefix,first_name,last_name,year,token_hash,expires_at,status,created_by) values(r->>'student_id',trim(r->>'name_prefix'),trim(r->>'first_name'),trim(r->>'last_name'),r->>'year',replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),now()+interval '30 days','draft',p_actor);n:=n+1;
 end loop;
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'เตรียมข้อมูลสมาชิก '||n||' คน');return n;
end;$$;
create function public.create_registration_batch(p_ids uuid[],p_expires timestamptz,p_hash text,p_actor uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid; n integer;
begin
 perform pg_advisory_xact_lock(7086301);
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 500 or p_expires is null or p_expires<=now()+interval '1 minute' or p_expires>now()+interval '30 days' then raise exception 'เลือกสมาชิกและวันหมดอายุ 1 นาที–30 วัน';end if;
 perform id from member_invites where id=any(p_ids) order by id for update;
 select count(*) into n from member_invites where id=any(p_ids) and status in ('draft','pending');
 if n<>cardinality(p_ids) then raise exception 'สมาชิกบางคนสมัครแล้วหรือกำลังสมัคร กรุณาโหลดรายชื่อใหม่';end if;
 insert into registration_batches(token_hash,expires_at,created_by) values(p_hash,p_expires,p_actor) returning id into result;
 update member_invites set batch_id=result,status='pending',expires_at=p_expires,registration_line_user_id=null where id=any(p_ids);
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'สร้างลิงก์สมัครร่วม '||n||' คน');return result;
end;$$;
create function public.start_registration_session(p_batch_hash text,p_student text,p_session_hash text,p_code_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare b registration_batches; i member_invites; count_recent integer;
begin
 select * into b from registration_batches where token_hash=p_batch_hash and expires_at>now();
 select * into i from member_invites where batch_id=b.id and student_id=p_student and status='pending' and expires_at>now() for update;
 if i.id is null then raise exception 'ไม่พบรหัสนักศึกษาที่สมัครได้ในลิงก์นี้ กรุณาติดต่อผู้ดูแลระบบ';end if;
 delete from registration_sessions where expires_at<=now();
 select count(*) into count_recent from registration_sessions where invite_id=i.id;
 if count_recent>=5 then raise exception 'ขอเชื่อม LINE หลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่';end if;
 insert into registration_sessions(session_hash,code_hash,invite_id,batch_id,expires_at) values(p_session_hash,p_code_hash,i.id,b.id,least(b.expires_at,now()+interval '15 minutes'));
 return jsonb_build_object('name',i.name_prefix||i.first_name||' '||i.last_name,'student_id',i.student_id,'expires_at',least(b.expires_at,now()+interval '15 minutes'));
end;$$;
create function public.consume_registration_line_code(p_hash text,p_line_user text) returns uuid language plpgsql security invoker set search_path=public as $$
declare s registration_sessions;
begin
 if p_line_user is null or p_line_user!~'^U[0-9a-f]{32}$' then return null;end if;
 select * into s from registration_sessions where code_hash=p_hash and expires_at>now() for update;
 if s.session_hash is null or s.line_user_id is not null or not exists(select 1 from member_invites where id=s.invite_id and batch_id=s.batch_id and status='pending' and expires_at>now()) or exists(select 1 from line_accounts where line_user_id=p_line_user) then return null;end if;
 update registration_sessions set line_user_id=p_line_user where session_hash=s.session_hash;return s.invite_id;
end;$$;
create function public.registration_session_state(p_session_hash text,p_batch_hash text,p_student text,p_claim boolean default false) returns jsonb language plpgsql security invoker set search_path=public as $$
declare s registration_sessions; i member_invites;
begin
 select * into s from registration_sessions where session_hash=p_session_hash and expires_at>now() for update;
 select * into i from member_invites where id=s.invite_id and batch_id=s.batch_id and student_id=p_student and status='pending' and expires_at>now() for update;
 if i.id is null or not exists(select 1 from registration_batches where id=s.batch_id and token_hash=p_batch_hash and expires_at>now()) then raise exception 'การสมัครหมดอายุหรือถูกใช้แล้ว กรุณาเริ่มใหม่';end if;
 if p_claim then
  if s.line_user_id is null then raise exception 'กรุณาเชื่อม LINE ก่อนตั้งรหัสผ่าน';end if;
  if exists(select 1 from profiles where student_id=p_student) or exists(select 1 from line_accounts where line_user_id=s.line_user_id) then raise exception 'รหัสนักศึกษาหรือ LINE นี้มีบัญชีแล้ว';end if;
  update member_invites set status='processing',registration_line_user_id=s.line_user_id where id=i.id;
  return to_jsonb(i);
 end if;
 return jsonb_build_object('linked',s.line_user_id is not null);
end;$$;
create or replace function public.claim_member_invite(p_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare invite member_invites;
begin
 select * into invite from member_invites where token_hash=p_hash for update;
 if invite.id is null or invite.batch_id is not null or invite.status<>'pending' or invite.expires_at<=now() then raise exception 'ลิงก์หมดอายุ ถูกใช้แล้ว หรือกำลังดำเนินการ';end if;
 if exists(select 1 from profiles where student_id=invite.student_id) then raise exception 'รหัสนักศึกษานี้มีบัญชีแล้ว';end if;
 update member_invites set status='processing' where id=invite.id;return to_jsonb(invite);
end;$$;
create or replace function public.finish_member_invite(p_hash text,p_user uuid) returns void language plpgsql security invoker set search_path=public as $$
declare invite member_invites;
begin
 select * into invite from member_invites where token_hash=p_hash for update;
 if invite.id is null or invite.status<>'processing' then raise exception 'ลิงก์ไม่พร้อมใช้งาน';end if;
 if invite.batch_id is not null and invite.registration_line_user_id is null then raise exception 'ต้องเชื่อม LINE ก่อน';end if;
 insert into profiles(id,student_id,name,year,role,active) values(p_user,invite.student_id,invite.name_prefix||invite.first_name||' '||invite.last_name,invite.year,'member',true);
 if invite.batch_id is not null then insert into line_accounts(profile_id,line_user_id) values(p_user,invite.registration_line_user_id);end if;
 update member_invites set status='used',used_at=now(),profile_id=p_user where id=invite.id;
 delete from registration_sessions where invite_id=invite.id;
 insert into audit(actor,action) values('ระบบสมัครสมาชิก','สร้างบัญชีจากลิงก์: '||invite.student_id);
end;$$;
create or replace function public.revoke_member_invite(p_id uuid,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 update member_invites set status='revoked' where id=p_id and status in ('draft','pending');
 if not found then raise exception 'ลิงก์ถูกใช้แล้วหรือกำลังสร้างบัญชี';end if;
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'ยกเลิกการสมัคร: '||p_id::text);
end;$$;
create function public.delete_fund_category(p_name text,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
declare k text; d jsonb; categories jsonb; removed jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 k:=lower(regexp_replace(trim(p_name),'\s+',' ','g'));if coalesce(length(k),0) not between 1 and 100 then raise exception 'ชื่อหมวดหมู่ไม่ถูกต้อง';end if;
 select data into d from site_settings where id=true for update;
 select coalesce(jsonb_agg(n),'[]'::jsonb) into categories from jsonb_array_elements_text(coalesce(d->'fund_categories','[]'::jsonb)) n where lower(regexp_replace(trim(n),'\s+',' ','g'))<>k;
 removed:=coalesce(d->'fund_categories_deleted','[]'::jsonb);if not removed @> jsonb_build_array(k) then removed:=removed||jsonb_build_array(k);end if;
 update site_settings set data=d||jsonb_build_object('fund_categories',categories,'fund_categories_deleted',removed) where id=true;
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'ลบหมวดหมู่ออกจากตัวเลือก: '||p_name);
end;$$;
create or replace function public.add_fund_category(p_name text,p_actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v text; d jsonb; categories jsonb; removed jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 v:=regexp_replace(trim(p_name),'\s+',' ','g');if coalesce(length(v),0) not between 1 and 100 then raise exception 'ชื่อหมวดหมู่ไม่ถูกต้อง';end if;
 select data into d from site_settings where id=true for update;categories:=coalesce(d->'fund_categories','[]'::jsonb);
 if not exists(select 1 from jsonb_array_elements_text(categories) n where lower(n)=lower(v)) then
 if jsonb_array_length(categories)>=500 then raise exception 'มีหมวดหมู่ครบ 500 หมวดแล้ว';end if;categories:=categories||jsonb_build_array(v);end if;
 select coalesce(jsonb_agg(n),'[]'::jsonb) into removed from jsonb_array_elements_text(coalesce(d->'fund_categories_deleted','[]'::jsonb)) n where n<>lower(v);
 update site_settings set data=d||jsonb_build_object('fund_categories',categories,'fund_categories_deleted',removed) where id=true;
 insert into audit(actor,action) values((select name from profiles where id=p_actor),'เพิ่มหมวดหมู่: '||v);return categories;
end;$$;
revoke all on function public.prepare_registration_members(jsonb,uuid),public.create_registration_batch(uuid[],timestamptz,text,uuid),public.start_registration_session(text,text,text,text),public.consume_registration_line_code(text,text),public.registration_session_state(text,text,text,boolean),public.delete_fund_category(text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_registration_members(jsonb,uuid),public.create_registration_batch(uuid[],timestamptz,text,uuid),public.start_registration_session(text,text,text,text),public.consume_registration_line_code(text,text),public.registration_session_state(text,text,text,boolean),public.delete_fund_category(text,uuid) to service_role;
