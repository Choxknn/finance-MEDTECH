create or replace function public.clear_old_messages(p_kind text,p_months integer,p_actor uuid,p_confirmed boolean default false,p_anchor timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor_name text;anchor_time timestamptz:=coalesce(p_anchor,now());cutoff_time timestamptz;total bigint;
begin
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_kind is null or p_kind not in ('notifications','audit') or p_months is null or p_months<1 or p_months>120 then raise exception 'เลือกข้อมูลและจำนวนเดือน 1–120';end if;
 if p_confirmed and p_anchor is null then raise exception 'กรุณาตรวจสอบจำนวนรายการก่อน';end if;
 if anchor_time>now() or anchor_time<now()-interval '15 minutes' then raise exception 'ข้อมูลตัวอย่างหมดอายุ กรุณาตรวจสอบจำนวนรายการใหม่';end if;
 cutoff_time:=((anchor_time at time zone 'Asia/Bangkok')-make_interval(months=>p_months)) at time zone 'Asia/Bangkok';
 if p_confirmed then
  if p_kind='notifications' then delete from notifications where created_at<cutoff_time;else delete from audit where created_at<cutoff_time;end if;
  get diagnostics total=row_count;
  insert into audit(actor,action,details) values(actor_name,case when p_kind='audit' then 'ล้างประวัติกิจกรรมเก่า' else 'ล้างข้อความเก่า' end,jsonb_build_object('months',p_months,'count',total,'cutoff',cutoff_time,'category',p_kind));
 else
  if p_kind='notifications' then select count(*) into total from notifications where created_at<cutoff_time;else select count(*) into total from audit where created_at<cutoff_time;end if;
 end if;
 return jsonb_build_object('count',total,'cutoff',cutoff_time,'anchor',anchor_time,'deleted',coalesce(p_confirmed,false));
end;$$;
revoke all on function public.clear_old_messages(text,integer,uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.clear_old_messages(text,integer,uuid,boolean,timestamptz) to service_role;
