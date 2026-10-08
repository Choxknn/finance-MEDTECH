alter table public.notifications add column new_bill_id uuid;
create index notifications_new_bill_queue on public.notifications(created_at) where new_bill_id is not null and status='queued';
create function public.create_bill_with_notice(p_title text,p_description text,p_amount numeric,p_due date,p_members uuid[],p_penalty boolean,p_rate numeric,p_actor uuid,p_max numeric,p_notify boolean default false)
returns uuid language plpgsql security invoker set search_path=public as $$
declare rid uuid; msg text;recipients integer;
begin
 rid:=public.create_bill(p_title,p_description,p_amount,p_due,p_members,p_penalty,p_rate,p_actor,p_max);
 if p_notify is true then
  msg:='คุณมีบิลใหม่ที่ต้องชำระ'||E'\nรายการ: '||p_title||E'\nยอดชำระ: '||to_char(p_amount,'FM999,999,990.00')||' บาท'||E'\nครบกำหนด: '||to_char(p_due,'DD/MM/')||(extract(year from p_due)::integer+543)::text;
  if nullif(trim(p_description),'') is not null then msg:=msg||E'\nรายละเอียด: '||left(p_description,1000);end if;
  if p_penalty then msg:=msg||E'\nค่าปรับหลังครบกำหนด: วันละ '||p_rate::text||' บาท (สูงสุด '||p_max::text||' บาท)';end if;
  insert into notifications(profile_id,title,body,campaign_id,message_kind,new_bill_id)
   select c.profile_id,left('บิลใหม่: '||p_title,120),msg,rid,'message',rid from charges c join line_accounts l on l.profile_id=c.profile_id where c.round_id=rid;
  get diagnostics recipients=row_count;
  insert into audit(actor,action,details) values((select name from profiles where id=p_actor),'แจ้งบิลใหม่ผ่าน LINE',jsonb_build_object('round_id',rid,'recipients',recipients));
 end if;
 return rid;
end;$$;
create function public.claim_new_bill_notices(p_round uuid default null)
returns setof public.notifications language plpgsql security invoker set search_path=public as $$
begin
 update notifications set status='failed',error='การส่งค้างเกินเวลาที่ปลอดภัย กรุณาตรวจสอบก่อนส่งใหม่' where new_bill_id is not null and status='queued' and delivery_started_at<now()-interval '23 hours';
 return query with picked as(select id from notifications where new_bill_id is not null and (p_round is null or new_bill_id=p_round) and status='queued' and (delivery_started_at is null or delivery_started_at<now()-interval '2 minutes') order by created_at,id limit 50 for update skip locked) update notifications n set delivery_started_at=now() from picked where n.id=picked.id returning n.*;
end;$$;
revoke all on function public.create_bill_with_notice(text,text,numeric,date,uuid[],boolean,numeric,uuid,numeric,boolean),public.claim_new_bill_notices(uuid) from public,anon,authenticated;
grant execute on function public.create_bill_with_notice(text,text,numeric,date,uuid[],boolean,numeric,uuid,numeric,boolean),public.claim_new_bill_notices(uuid) to service_role;
