alter table public.trash_cleanup_queue drop constraint if exists trash_cleanup_queue_kind_check;
alter table public.trash_cleanup_queue add constraint trash_cleanup_queue_kind_check check(kind in ('drive','auth','shop-product'));

CREATE OR REPLACE FUNCTION public.purge_trash(p_all boolean DEFAULT false, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 cutoff timestamptz;
 deleted_count integer:=0;
 changed integer;
begin
 perform pg_advisory_xact_lock(7086301);
 if p_all and (p_actor is null or not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null)) then
  raise exception 'ไม่มีสิทธิ์';
 end if;
 cutoff:=case when p_all then now() else now()-interval '30 days' end;

 insert into used_slip_refs(trans_ref)
 select trans_ref from payments
 where deleted_at<=cutoff and trans_ref is not null
 on conflict do nothing;

 insert into trash_cleanup_queue(kind,target)
 select 'drive',drive_file_id from payments where deleted_at<=cutoff and drive_file_id is not null
 union
 select 'drive',drive_file_id from expenses where deleted_at<=cutoff and drive_file_id is not null
 on conflict do nothing;

 insert into trash_cleanup_queue(kind,target)
 select 'drive',receipt_file_id from expenses where deleted_at<=cutoff and receipt_file_id is not null
 union
 select 'drive',drive_file_id from manual_incomes where deleted_at<=cutoff and drive_file_id is not null
 union
 select 'drive',receipt_file_id from manual_incomes where deleted_at<=cutoff and receipt_file_id is not null
 on conflict do nothing;

 update payments p
 set charge_snapshot=to_jsonb(c)
 from charges c
 where p.charge_id=c.id and c.deleted_at<=cutoff;
 delete from payments where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 delete from expenses where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 delete from manual_incomes where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 delete from charges where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 update charges c
 set round_snapshot=jsonb_build_object('id',r.id,'title',r.title,'description','','amount',r.amount,'due_date',r.due_date,'archived',true)
 from rounds r
 where c.round_id=r.id and r.deleted_at<=cutoff;

 update payments p
 set charge_snapshot=jsonb_set(p.charge_snapshot,'{round_snapshot}',jsonb_build_object('id',r.id,'title',r.title,'amount',r.amount,'due_date',r.due_date,'archived',true),true)
 from rounds r
 where p.charge_id is null and (p.charge_snapshot->>'round_id')::uuid=r.id and r.deleted_at<=cutoff;

 delete from rounds where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 -- Permanently purge shop orders moved to trash, including their payment rows and unused slip files.
 -- Keep approved transaction references reserved so a deleted order cannot make a slip reusable.
 insert into used_slip_refs(trans_ref)
 select sp.trans_ref
 from shop_payments sp
 join shop_orders o on o.id=sp.order_id
 where o.deleted_at<=cutoff and sp.trans_ref is not null
 on conflict do nothing;

 insert into trash_cleanup_queue(kind,target)
 select distinct 'drive',sp.drive_file_id
 from shop_payments sp
 join shop_orders o on o.id=sp.order_id
 where o.deleted_at<=cutoff
   and sp.drive_file_id is not null
   and not exists(select 1 from shop_payments keep join shop_orders ko on ko.id=keep.order_id where keep.drive_file_id=sp.drive_file_id and (ko.deleted_at is null or ko.deleted_at>cutoff))
   and not exists(select 1 from payments keep where keep.drive_file_id=sp.drive_file_id)
   and not exists(select 1 from expenses keep where keep.drive_file_id=sp.drive_file_id or keep.receipt_file_id=sp.drive_file_id)
   and not exists(select 1 from manual_incomes keep where keep.drive_file_id=sp.drive_file_id or keep.receipt_file_id=sp.drive_file_id)
 on conflict do nothing;

 delete from shop_payments sp
 using shop_orders o
 where sp.order_id=o.id and o.deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 delete from shop_orders where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 -- Preserve order history, but release the foreign-key reference to products being purged.
 -- shop_orders keeps product_title, unit_price, selected_options and totals as its historical snapshot.
 update shop_orders o
 set product_id=null
 from shop_products p
 where o.product_id=p.id and p.deleted_at<=cutoff;

 -- Queue product images for removal from the shop-products Storage bucket after the row is purged.
 insert into trash_cleanup_queue(kind,target)
 select distinct 'shop-product',img.path
 from shop_products p
 cross join lateral unnest(coalesce(p.images,'{}'::text[])) as img(path)
 where p.deleted_at<=cutoff
   and nullif(img.path,'') is not null
   and not exists(select 1 from shop_products keep where keep.id<>p.id and img.path=any(keep.images))
 on conflict do nothing;

 delete from shop_products where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 update charges c
 set profile_snapshot=jsonb_build_object('id',p.id,'name','ผู้ใช้ที่ลบ','student_id','—','role','member','active',false)
 from profiles p
 where c.profile_id=p.id and p.deleted_at<=cutoff;

 update payments pay
 set member_snapshot=jsonb_build_object('id',p.id,'name','ผู้ใช้ที่ลบ','student_id','—','role','member','active',false)
 from profiles p
 where pay.profile_id=p.id and p.deleted_at<=cutoff;

 insert into trash_cleanup_queue(kind,target)
 select 'auth',id::text from profiles where deleted_at<=cutoff
 on conflict do nothing;

 delete from profiles where deleted_at<=cutoff;
 get diagnostics changed=row_count;
 deleted_count:=deleted_count+changed;

 if deleted_count>0 then
  insert into audit(actor,action,details)
  values(case when p_actor is null then 'ระบบ' else (select name from profiles where id=p_actor) end,'ลบถังขยะถาวร',jsonb_build_object('count',deleted_count,'automatic',not p_all));
 end if;
 return deleted_count;
end;
$function$;
