create table public.web_announcements(id uuid primary key default gen_random_uuid(),title text not null check(char_length(title) between 1 and 120),body text not null check(char_length(body) between 1 and 2000),created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create table public.web_announcement_recipients(announcement_id uuid references public.web_announcements(id) on delete cascade,profile_id uuid references public.profiles(id) on delete cascade,dismissed_at timestamptz,primary key(announcement_id,profile_id));
alter table public.web_announcements enable row level security;
alter table public.web_announcement_recipients enable row level security;
revoke all on public.web_announcements,public.web_announcement_recipients from anon,authenticated;
grant all on public.web_announcements,public.web_announcement_recipients to service_role;
alter table public.notifications drop constraint notifications_message_kind_check;
alter table public.notifications add constraint notifications_message_kind_check check(message_kind in ('message','announcement','password','reminder','correction','payment_success'));
alter table public.notifications add column reminder_key text,add column reminder_charge_id uuid references public.charges(id) on delete set null,add column expires_at timestamptz,add column seen_at timestamptz;
create unique index notifications_reminder_unique on public.notifications(reminder_key) where reminder_key is not null;
create or replace function public.publish_web_announcement(p_title text,p_body text,p_members uuid[],p_actor uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare n uuid;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 if cardinality(p_members) not between 1 and 500 or p_members is null or exists(select 1 from unnest(p_members) m where not exists(select 1 from profiles where id=m and active and deleted_at is null)) then raise exception 'เลือกสมาชิกที่ยังใช้งาน';end if;
 insert into web_announcements(title,body,created_by) values(p_title,p_body,p_actor) returning id into n;
 insert into web_announcement_recipients(announcement_id,profile_id) select distinct n,m from unnest(p_members) m;
 insert into audit(actor,action,details) select name,'สร้างประกาศในเว็บ',jsonb_build_object('title',p_title) from profiles where id=p_actor;
 return n;
end;$$;
create or replace function public.payment_window_open(p_at timestamptz default now()) returns boolean language sql stable security invoker set search_path=public as $$select (p_at at time zone 'Asia/Bangkok')::time >= time '01:00' and (p_at at time zone 'Asia/Bangkok')::time < time '23:50';$$;
create or replace function public.queue_due_reminders() returns integer language plpgsql security invoker set search_path=public as $$
declare local_now timestamp:=now() at time zone 'Asia/Bangkok'; target_date date; slot text; n integer:=0;
begin
 if local_now::time>=time '09:00' and local_now::time<time '09:10' then target_date:=local_now::date+1;slot:='day';
 elsif local_now::time>=time '23:00' and local_now::time<time '23:10' then target_date:=local_now::date;slot:='hour';else return 0;end if;
 insert into notifications(profile_id,title,body,message_kind,reminder_key,reminder_charge_id,expires_at)
 select c.profile_id,case slot when 'day' then 'พรุ่งนี้ครบกำหนดชำระ' else 'คืนนี้ครบกำหนดชำระ' end,
 r.title||E'\nยอดค้าง '||to_char(c.amount+charge_fee(c.id)-coalesce(paid.amount,0),'FM999999990.00')||E' บาท\nครบกำหนด '||to_char(r.due_date,'DD/MM/YYYY')||case slot when 'hour' then E'\nเหลือ 1 ชั่วโมงก่อนข้ามวัน กรุณาชำระก่อน 23:50 น. (พักรับชำระ 23:50–01:00 น.)' else E'\nเปิดเว็บเพื่อดูรายการและชำระเงิน' end,
 'reminder',c.id::text||':'||target_date::text||':'||slot,c.id,case slot when 'hour' then (target_date+time '23:50') at time zone 'Asia/Bangkok' else (local_now::date+time '23:50') at time zone 'Asia/Bangkok' end
 from charges c join rounds r on r.id=c.round_id join profiles m on m.id=c.profile_id
 left join lateral(select sum(amount) amount from payments where charge_id=c.id and status='approved' and deleted_at is null) paid on true
 where r.due_date=target_date and not r.archived and r.deleted_at is null and c.deleted_at is null and m.active and m.deleted_at is null and c.amount+charge_fee(c.id)>coalesce(paid.amount,0)
 and not exists(select 1 from payments where charge_id=c.id and status in ('pending','review') and deleted_at is null)
 on conflict(reminder_key) where reminder_key is not null do nothing;
 get diagnostics n=row_count;return n;
end;$$;
create or replace function public.claim_due_reminders() returns setof public.notifications language plpgsql security invoker set search_path=public as $$begin
 update notifications set status='in_app',error='เลยเวลาแจ้งเตือน' where reminder_key is not null and status='queued' and expires_at<=now();
 return query with picked as(select id from notifications where reminder_key is not null and status='queued' and expires_at>now() and (delivery_started_at is null or delivery_started_at<now()-interval '2 minutes') order by created_at limit 10 for update skip locked) update notifications n set delivery_started_at=now() from picked where n.id=picked.id returning n.*;
end;$$;
create extension if not exists pg_net with schema extensions;
create table public.reminder_worker_auth(id boolean primary key default true check(id),key_hash text not null);
alter table public.reminder_worker_auth enable row level security;
revoke all on public.reminder_worker_auth from public,anon,authenticated;
grant select on public.reminder_worker_auth to service_role;
do $$declare k text;begin select decrypted_secret into k from vault.decrypted_secrets where name='finance_reminder_worker';if k is null then k:=encode(extensions.gen_random_bytes(32),'hex');perform vault.create_secret(k,'finance_reminder_worker');end if;insert into reminder_worker_auth(id,key_hash) values(true,encode(extensions.digest(k,'sha256'),'hex'));end;$$;
create or replace function public.authorize_reminder_worker(p_key text) returns boolean language sql security invoker set search_path=public as $$select exists(select 1 from public.reminder_worker_auth where key_hash=encode(extensions.digest(p_key,'sha256'),'hex') and length(p_key)=64);$$;
revoke all on function public.publish_web_announcement(text,text,uuid[],uuid),public.payment_window_open(timestamptz),public.queue_due_reminders(),public.claim_due_reminders(),public.authorize_reminder_worker(text) from public,anon,authenticated;
grant execute on function public.publish_web_announcement(text,text,uuid[],uuid),public.payment_window_open(timestamptz),public.queue_due_reminders(),public.claim_due_reminders(),public.authorize_reminder_worker(text) to service_role;
-- Enable the schedule only after the worker is deployed.
