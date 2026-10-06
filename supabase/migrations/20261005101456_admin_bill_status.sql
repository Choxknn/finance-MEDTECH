-- Admin-only, atomic status changes. Real bank references remain reserved.
create or replace function public.admin_set_bill_status(p_charge uuid,p_status text,p_reason text,p_actor uuid,p_expected_paid numeric,p_expected_balance numeric,p_request uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c charges; actor_name text; received numeric; fee numeric; remaining numeric; previous jsonb; result jsonb; prior audit;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_status is null or p_status not in ('approved','unpaid') or nullif(trim(p_reason),'') is null or length(p_reason)>500 or p_request is null then raise exception 'ข้อมูลสถานะไม่ถูกต้อง';end if;
 select * into prior from audit where id=p_request;
 if prior.id is not null then
  if prior.details->>'charge_id'=p_charge::text and prior.details->>'actor_id'=p_actor::text and prior.details->>'requested_status'=p_status then return prior.details->'result';end if;
  raise exception 'เลขรายการซ้ำ';
 end if;
 select * into c from charges where id=p_charge for update;
 if c.id is null or c.deleted_at is not null or not exists(select 1 from rounds where id=c.round_id and deleted_at is null) or not exists(select 1 from profiles where id=c.profile_id and deleted_at is null) then raise exception 'ไม่พบบิลที่จัดการได้';end if;
 perform id from payments where charge_id=c.id order by id for update;
 if exists(select 1 from payments where charge_id=c.id and deleted_at is null and status in ('pending','review')) then raise exception 'มีสลิปรอตรวจ กรุณาตรวจสอบการชำระก่อนเปลี่ยนสถานะ';end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=c.id and status='approved' and deleted_at is null;
 fee:=public.charge_fee(c.id);remaining:=greatest(0,c.amount+fee-received);
 if p_expected_paid is null or p_expected_balance is null or p_expected_paid<>received or p_expected_balance<>remaining then raise exception 'ยอดบิลเปลี่ยนแล้ว กรุณาปิดหน้าต่างและโหลดข้อมูลใหม่';end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into previous from payments p where charge_id=c.id and status='approved' and deleted_at is null;
 if p_status='approved' then
  if remaining<=0 then raise exception 'บิลนี้ชำระครบแล้ว';end if;
  insert into payments(id,profile_id,charge_id,amount,status,source,trans_ref,note,fee_snapshot,reviewed_by,reviewed_at)
   values(p_request,c.profile_id,c.id,remaining,'approved','admin','ADMIN-'||p_request::text,trim(p_reason),fee,p_actor,now());
  update charges set fee_settled=fee where id=c.id;
 else
  if received<=0 then raise exception 'บิลนี้ยังไม่มีรายการรับเงินที่ยืนยัน';end if;
  update payments set status='rejected',note='แอดมินยกเลิกการรับเงิน: '||trim(p_reason),reviewed_by=p_actor,reviewed_at=now() where charge_id=c.id and status='approved' and deleted_at is null;
  update charges set fee_settled=null where id=c.id;
 end if;
 result:=jsonb_build_object('status',p_status,'received_before',received,'received_after',case when p_status='approved' then received+remaining else 0 end);
 insert into audit(id,actor,action,details) values(p_request,actor_name,'เปลี่ยนสถานะบิล: '||(select title from rounds where id=c.round_id)||' · '||(select name from profiles where id=c.profile_id)||' → '||case when p_status='approved' then 'ชำระแล้ว' else 'รอชำระ' end,jsonb_build_object('charge_id',c.id,'actor_id',p_actor,'requested_status',p_status,'reason',trim(p_reason),'payments_before',previous,'result',result));
 return result;
end;$$;
revoke all on function public.admin_set_bill_status(uuid,text,text,uuid,numeric,numeric,uuid) from public,anon,authenticated;
grant execute on function public.admin_set_bill_status(uuid,text,text,uuid,numeric,numeric,uuid) to service_role;
