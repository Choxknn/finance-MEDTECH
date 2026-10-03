alter table public.notifications add column campaign_id uuid,add column message_kind text not null default 'message' check(message_kind in ('message','announcement','password')),add column delivery_started_at timestamptz;
create unique index notifications_campaign_recipient on public.notifications(campaign_id,profile_id) where campaign_id is not null;
create or replace function public.enqueue_campaign(p_id uuid,p_kind text,p_title text,p_body text,p_members uuid[],p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare actor_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_id is null or p_kind not in ('message','announcement','password') or p_kind is null or char_length(trim(p_title)) not between 1 and 120 or p_title is null or char_length(trim(p_body)) not between 1 and 2000 or p_body is null or coalesce(cardinality(p_members),0) not between 1 and 500 then raise exception 'ข้อมูลข้อความไม่ถูกต้อง';end if;
 if exists(select 1 from notifications where campaign_id=p_id) then
  if exists(select 1 from notifications where campaign_id=p_id and (title<>p_title or body<>p_body or message_kind<>p_kind)) then raise exception 'รหัสชุดข้อความถูกใช้แล้ว';end if;
  return;
 end if;
 if exists(select 1 from unnest(p_members) m where not exists(select 1 from profiles where id=m and active and deleted_at is null)) then raise exception 'เลือกเฉพาะผู้ใช้งานที่ยังใช้งาน';end if;
 insert into notifications(profile_id,title,body,campaign_id,message_kind) select distinct m,p_title,p_body,p_id,p_kind from unnest(p_members) m;
 insert into audit(actor,action,details) values(actor_name,case p_kind when 'announcement' then 'สร้างประกาศ' when 'password' then 'ขอให้สมาชิกเปลี่ยนรหัสผ่าน' else 'สร้างข้อความถึงสมาชิก' end,jsonb_build_object('campaign_id',p_id,'title',p_title,'count',(select count(distinct x) from unnest(p_members) x)));
end;$$;
create or replace function public.claim_campaign(p_id uuid,p_actor uuid)
returns setof public.notifications language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 update notifications set status='failed',error='การส่งเดิมค้างเกิน 24 ชั่วโมง กรุณาตรวจสอบก่อนส่งใหม่' where campaign_id=p_id and status='queued' and delivery_started_at<now()-interval '23 hours';
 return query with picked as(select id from notifications where campaign_id=p_id and status='queued' and (delivery_started_at is null or delivery_started_at<now()-interval '60 seconds') order by created_at,id limit 10 for update skip locked) update notifications n set delivery_started_at=now() from picked where n.id=picked.id returning n.*;
end;$$;
create or replace function public.campaign_summary(p_actor uuid,p_id uuid default null)
returns table(id uuid,title text,kind text,total bigint,sent bigint,failed bigint,unlinked bigint,queued bigint,created_at timestamptz)
language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from profiles where profiles.id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 return query select n.campaign_id,max(n.title),max(n.message_kind),count(*),count(*) filter(where status='sent'),count(*) filter(where status='failed'),count(*) filter(where status='unlinked'),count(*) filter(where status='queued'),min(n.created_at) from notifications n where n.campaign_id is not null and (p_id is null or n.campaign_id=p_id) group by n.campaign_id order by min(n.created_at) desc limit 30;
end;$$;
revoke all on function public.enqueue_campaign(uuid,text,text,text,uuid[],uuid),public.claim_campaign(uuid,uuid),public.campaign_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_campaign(uuid,text,text,text,uuid[],uuid),public.claim_campaign(uuid,uuid),public.campaign_summary(uuid,uuid) to service_role;
