alter table public.manual_incomes add column attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array');
alter table public.expenses add column attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array');

create function public.guard_bill_income_total() returns trigger language plpgsql security invoker set search_path=public as $$
declare collected numeric;
begin
 if new.source_round_id is not null and new.deleted_at is null then
  perform pg_advisory_xact_lock(7086301);
  select coalesce(sum(p.amount),0) into collected from payments p join charges c on c.id=p.charge_id where c.round_id=new.source_round_id and c.deleted_at is null and p.deleted_at is null and p.status='approved';
  if new.amount>collected then raise exception 'ยอดนำเข้าต้องไม่เกินยอดชำระที่ยืนยันแล้ว (% บาท)',collected;end if;
 end if;return new;
end $$;
create trigger cap_bill_income before insert or update of amount,source_round_id,deleted_at on public.manual_incomes for each row execute function public.guard_bill_income_total();
revoke all on function public.guard_bill_income_total() from public,anon,authenticated;
grant execute on function public.guard_bill_income_total() to service_role;

create function public.save_finance_gallery(p_kind text,p_id uuid,p_patch jsonb,p_files jsonb,p_actor uuid,p_request uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare target uuid; actor_name text; prior audit; item jsonb;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_request is null or p_kind not in ('income','expense') or jsonb_typeof(p_files)<>'array' then raise exception 'ข้อมูลไม่ถูกต้อง';end if;
 select * into prior from audit where id=p_request;
 if prior.id is not null then
  if prior.details->>'actor_id'<>p_actor::text or prior.details->>'kind'<>p_kind then raise exception 'เลขรายการซ้ำ';end if;
  return jsonb_build_object('id',prior.details->>'record_id','reused',true);
 end if;
 for item in select value from jsonb_array_elements(p_files) loop
  if item->>'kind' not in ('slip','receipt') or not exists(select 1 from evidence_files where 'sb:'||path=item->>'file_id' and state='active') then raise exception 'ไฟล์แนบไม่ถูกต้อง';end if;
 end loop;
 if p_kind='income' then
  target:=save_manual_income(p_id,p_patch,p_actor);
  update manual_incomes set attachments=attachments||p_files where id=target;
 elsif p_id is not null then
  perform manage_record('expense',p_id,p_patch,p_actor);target:=p_id;
  update expenses set attachments=attachments||p_files where id=target;
 else
  insert into expenses(title,category,amount,spent_on,spent_time,responsible_name,note,created_by,request_key,attachments)
  values(p_patch->>'title',p_patch->>'category',(p_patch->>'amount')::numeric,(p_patch->>'spent_on')::date,nullif(p_patch->>'spent_time','')::time,p_patch->>'responsible_name',coalesce(p_patch->>'note',''),p_actor,p_request,p_files) returning id into target;
 end if;
 update evidence_files set protected=true where 'sb:'||path in(select value->>'file_id' from jsonb_array_elements(p_files));
 insert into audit(id,actor,action,details) values(p_request,actor_name,case when p_id is null then 'บันทึกรายการการเงิน' else 'แก้ไขรายการการเงิน' end,jsonb_build_object('actor_id',p_actor,'kind',p_kind,'record_id',target,'title',p_patch->>'title','attachment_count',jsonb_array_length(p_files)));
 return jsonb_build_object('id',target,'reused',false);
end $$;
revoke all on function public.save_finance_gallery(text,uuid,jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_finance_gallery(text,uuid,jsonb,jsonb,uuid,uuid) to service_role;

create function public.queue_finance_gallery() returns trigger language plpgsql security invoker set search_path=public as $$
declare item jsonb; fid text;
begin
 for item in select value from jsonb_array_elements(old.attachments) loop
  fid:=item->>'file_id';
  if fid like 'sb:%' and not exists(select 1 from manual_incomes where attachments @> jsonb_build_array(jsonb_build_object('file_id',fid))) and not exists(select 1 from expenses where attachments @> jsonb_build_array(jsonb_build_object('file_id',fid))) then
   update evidence_files set purge_with_record=true where 'sb:'||path=fid;
   insert into trash_cleanup_queue(kind,target) values('drive',fid) on conflict do nothing;
  end if;
 end loop;return old;
end $$;
revoke all on function public.queue_finance_gallery() from public,anon,authenticated;
grant execute on function public.queue_finance_gallery() to service_role;
create trigger delete_income_gallery after delete on public.manual_incomes for each row execute function public.queue_finance_gallery();
create trigger delete_expense_gallery after delete on public.expenses for each row execute function public.queue_finance_gallery();

alter table public.payments add column verification_method text check(verification_method in ('admin','slipok'));
update public.payments set verification_method=case when source='admin' or reviewed_by is not null then 'admin' when note like 'ตรวจสอบผ่าน SlipOK%' then 'slipok' end where status='approved';
create function public.record_payment_verifier() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.status='approved' and (tg_op='INSERT' or old.status is distinct from new.status or old.reviewed_at is distinct from new.reviewed_at) then
  new.verification_method:=case when new.source='admin' or new.reviewed_by is not null then 'admin' when new.note like 'ตรวจสอบผ่าน SlipOK%' then 'slipok' else null end;
 end if;return new;
end $$;
create trigger payment_verifier before insert or update on public.payments for each row execute function public.record_payment_verifier();
revoke all on function public.record_payment_verifier() from public,anon,authenticated;
grant execute on function public.record_payment_verifier() to service_role;
