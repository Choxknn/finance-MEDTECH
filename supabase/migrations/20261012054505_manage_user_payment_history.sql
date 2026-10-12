create function public.manage_user_history(p_id uuid,p_patch jsonb,p_delete boolean,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
declare before_row legacy_payments; actor_name text; sid text;
begin
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 select * into before_row from legacy_payments where id=p_id for update;
 if not found then raise exception 'ไม่พบประวัติการชำระ';end if;
 if p_delete then
  if coalesce(p_patch->>'confirmation','')<>'ลบถาวร' then raise exception 'กรุณายืนยันลบถาวร';end if;
  if before_row.drive_file_id is not null then insert into trash_cleanup_queue(kind,target) values('drive',before_row.drive_file_id) on conflict do nothing;end if;
  delete from legacy_payments where id=p_id;
 else
  sid:=p_patch->>'student_id';
  if coalesce(sid,'')!~'^[0-9]{5,20}$' or length(trim(coalesce(p_patch->>'title',''))) not between 1 and 120 or coalesce((p_patch->>'amount')::numeric,0)<=0 or (p_patch->>'amount')::numeric>1000000 or round((p_patch->>'amount')::numeric,2)<>(p_patch->>'amount')::numeric or nullif(p_patch->>'paid_at','') is null then raise exception 'ข้อมูลประวัติไม่ถูกต้อง';end if;
  update legacy_payments set student_id=sid,profile_id=(select id from profiles where student_id=sid),title=trim(p_patch->>'title'),amount=(p_patch->>'amount')::numeric,paid_at=(p_patch->>'paid_at')::timestamptz where id=p_id;
 end if;
 insert into audit(actor,action,details) values(actor_name,case when p_delete then 'ลบประวัติผู้ใช้ถาวร' else 'แก้ไขประวัติผู้ใช้' end,jsonb_build_object('id',p_id,'before',jsonb_build_object('student_id',before_row.student_id,'title',before_row.title,'amount',before_row.amount,'paid_at',before_row.paid_at),'after',case when p_delete then null else p_patch end));
end;$$;
revoke all on function public.manage_user_history(uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.manage_user_history(uuid,jsonb,boolean,uuid) to service_role;
