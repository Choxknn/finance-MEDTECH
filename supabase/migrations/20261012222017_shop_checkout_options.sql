alter table public.shop_products add column option_groups jsonb not null default '[]';
alter table public.shop_orders add column selected_options jsonb not null default '[]',add column payment_status text not null default 'unpaid' check(payment_status in ('unpaid','pending','review','approved','rejected')),add column scan_token uuid not null default gen_random_uuid() unique,add column deleted_at timestamptz,add column updated_at timestamptz not null default now();
create table public.shop_payments(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.shop_orders(id),amount numeric(12,2) not null check(amount>0),status text not null default 'pending' check(status in ('pending','review','approved','rejected')),drive_file_id text,trans_ref text unique,note text not null default '',verification jsonb,created_at timestamptz not null default now(),reviewed_at timestamptz);
create index shop_payments_order on public.shop_payments(order_id,created_at desc);
create unique index shop_payments_open on public.shop_payments(order_id) where status in ('pending','review','approved');
alter table public.shop_payments enable row level security;
revoke all on public.shop_payments from anon,authenticated;
grant all on public.shop_payments to service_role;
create function public.shop_selection(p_product uuid,p_choices jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare groups jsonb;g jsonb;o jsonb;result jsonb:='[]'; selected text;
begin
 if jsonb_typeof(p_choices) is distinct from 'object' then raise exception 'ตัวเลือกสินค้าไม่ถูกต้อง';end if;
 select option_groups into groups from shop_products where id=p_product;
 for g in select value from jsonb_array_elements(groups) loop
 selected:=nullif(p_choices->>(g->>'id'),'');
 if selected is null then if coalesce((g->>'required')::boolean,true) then raise exception 'กรุณาเลือก %',g->>'name';end if;continue;end if;
 select value into o from jsonb_array_elements(g->'options') where value->>'id'=selected;
 if o is null then raise exception 'ตัวเลือก % เปลี่ยนแล้ว กรุณาเลือกใหม่',g->>'name';end if;
 result:=result||jsonb_build_array(jsonb_build_object('group_id',g->>'id','group_name',g->>'name','option_id',o->>'id','option_name',o->>'name'));
 end loop;return result;
end $$;
create function public.place_shop_order(p_id uuid,p_profile uuid,p_product uuid,p_quantity integer,p_note text,p_choices jsonb) returns public.shop_orders language plpgsql security invoker set search_path=public as $$
declare product shop_products;person profiles;result shop_orders;selection jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from shop_orders where id=p_id;
 if found then if result.profile_id is distinct from p_profile or result.deleted_at is not null then raise exception 'คำขอไม่ถูกต้อง';end if;return result;end if;
 select * into person from profiles where id=p_profile and active and deleted_at is null;
 if not found then raise exception 'ไม่พบบัญชีสมาชิก';end if;
 if p_quantity is null or p_quantity<1 or p_quantity>100 or length(coalesce(p_note,''))>1000 then raise exception 'ข้อมูลสั่งซื้อไม่ถูกต้อง';end if;
 select * into product from shop_products where id=p_product for update;
 if not found or not product.active or product.deleted_at is not null then raise exception 'สินค้านี้ปิดรับคำสั่งซื้อแล้ว';end if;
 selection:=shop_selection(p_product,p_choices);
 if product.stock<p_quantity then raise exception 'สินค้าไม่เพียงพอ กรุณาปรับจำนวน';end if;
 update shop_products set stock=stock-p_quantity where id=p_product;
 insert into shop_orders(id,profile_id,student_id,buyer_name,product_id,product_title,unit_price,quantity,total,note,selected_options,payment_status,status) values(p_id,p_profile,person.student_id,person.name,product.id,product.title,product.price,p_quantity,product.price*p_quantity,coalesce(p_note,''),selection,case when product.price=0 then 'approved' else 'unpaid' end,case when product.price=0 then 'confirmed' else 'pending' end) returning * into result;
 return result;
end $$;
create or replace function public.place_shop_order(p_id uuid,p_profile uuid,p_product uuid,p_quantity integer,p_note text) returns public.shop_orders language sql security invoker set search_path=public as $$select public.place_shop_order(p_id,p_profile,p_product,p_quantity,p_note,'{}'::jsonb)$$;
create or replace function public.update_shop_order(p_id uuid,p_status text) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;
begin
 if p_status is null or p_status not in ('pending','confirmed','ready','completed','cancelled') then raise exception 'สถานะไม่ถูกต้อง';end if;
 select * into item from shop_orders where id=p_id and deleted_at is null for update;
 if not found then raise exception 'ไม่พบคำสั่งซื้อ';end if;
 if item.status=p_status then return;end if;
 if item.payment_status in ('pending','review') then raise exception 'มีหลักฐานรอตรวจ กรุณาตรวจให้เสร็จก่อนเปลี่ยนสถานะ';end if;
 if p_status in ('confirmed','ready','completed') and item.payment_status<>'approved' then raise exception 'ต้องยืนยันชำระเงินก่อนจัดเตรียมหรือส่งมอบสินค้า';end if;
 if item.status='cancelled' and p_status<>'cancelled' then
 update shop_products set stock=stock-item.quantity where id=item.product_id and deleted_at is null and stock>=item.quantity;
 if not found then raise exception 'สินค้าไม่พอหรือถูกลบแล้ว ไม่สามารถเปิดออเดอร์ใหม่';end if;
 elsif item.status<>'cancelled' and p_status='cancelled' then update shop_products set stock=stock+item.quantity where id=item.product_id;end if;
 update shop_orders set status=p_status,updated_at=now() where id=p_id;
end $$;
create function public.manage_shop_order(p_id uuid,p_patch jsonb,p_delete boolean,p_expected timestamptz,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;qty integer;price numeric;selection jsonb;new_note text;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 select * into item from shop_orders where id=p_id and deleted_at is null for update;
 if not found then raise exception 'ไม่พบคำสั่งซื้อ';end if;
 if item.updated_at is distinct from p_expected then raise exception 'คำสั่งซื้อเปลี่ยนแล้ว กรุณาเปิดใหม่';end if;
 if item.payment_status in ('pending','review') then raise exception 'กรุณาตรวจสลิปที่ค้างก่อนแก้ไขหรือลบ';end if;
 if p_delete then
 if item.status<>'cancelled' then update shop_products set stock=stock+item.quantity where id=item.product_id;end if;
 insert into trash_cleanup_queue(kind,target) select 'drive',drive_file_id from shop_payments where order_id=item.id and drive_file_id is not null on conflict do nothing;
 update shop_orders set status='cancelled',deleted_at=now(),updated_at=now() where id=p_id;
 else
 qty:=coalesce((p_patch->>'quantity')::integer,item.quantity);price:=coalesce((p_patch->>'unit_price')::numeric,item.unit_price);new_note:=coalesce(p_patch->>'note',item.note);
 if qty<1 or qty>100 or price<0 or price>9999999 or round(price,2)<>price or length(new_note)>1000 then raise exception 'จำนวน ราคาหรือหมายเหตุไม่ถูกต้อง';end if;
 if item.payment_status='approved' and (qty<>item.quantity or price<>item.unit_price) then raise exception 'ออเดอร์ชำระแล้วแก้ยอดเงินไม่ได้ แก้ตัวเลือกและหมายเหตุได้';end if;
 perform 1 from shop_products where id=item.product_id for update;
 selection:=case when p_patch ? 'choices' then shop_selection(item.product_id,p_patch->'choices') else item.selected_options end;
 if item.status<>'cancelled' and qty<>item.quantity then
 update shop_products set stock=stock+item.quantity-qty where id=item.product_id and stock+item.quantity>=qty;
 if not found then raise exception 'สินค้าไม่เพียงพอ';end if;end if;
 update shop_orders set quantity=qty,unit_price=price,total=qty*price,note=new_note,selected_options=selection,updated_at=now() where id=p_id;
 end if;
 insert into audit(actor,action) select name,(case when p_delete then 'ลบคำสั่งซื้อ ' else 'แก้ไขคำสั่งซื้อ ' end)||p_id::text from profiles where id=p_actor;
end $$;
create function public.bulk_shop_status(p_ids uuid[],p_status text,p_actor uuid) returns integer language plpgsql security invoker set search_path=public as $$
declare item uuid;count integer:=0;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 if cardinality(p_ids)<1 or cardinality(p_ids)>1000 then raise exception 'เลือก 1–1000 รายการ';end if;
 for item in select distinct x from unnest(p_ids) x order by x loop perform update_shop_order(item,p_status);count:=count+1;end loop;
 insert into audit(actor,action) select name,'เปลี่ยนสถานะคำสั่งซื้อ '||count||' รายการ เป็น '||p_status from profiles where id=p_actor;
 return count;
end $$;
create function public.reserve_shop_payment(p_order uuid,p_profile uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare item shop_orders;pid uuid;
begin
 if not payment_window_open() then raise exception 'ปิดรับชำระชั่วคราว 23:50–01:00 น.';end if;
 select * into item from shop_orders where id=p_order and profile_id=p_profile and deleted_at is null for update;
 if not found or item.status='cancelled' then raise exception 'ไม่พบคำสั่งซื้อที่ชำระได้';end if;
 if item.payment_status='approved' or item.total<=0 then raise exception 'ชำระเงินแล้ว';end if;
 -- A timed-out upload can be retried; a completed verification remains reviewable.
 update shop_payments set status='rejected',note='การส่งสลิปหมดเวลา กรุณาส่งใหม่' where order_id=p_order and status='pending' and created_at<now()-interval '3 minutes';
 if exists(select 1 from shop_payments where order_id=p_order and status in ('pending','review','approved')) then raise exception 'มีสลิปรอตรวจอยู่แล้ว';end if;
 insert into shop_payments(order_id,amount) values(p_order,item.total) returning id into pid;
 update shop_orders set payment_status='pending',updated_at=now() where id=p_order;return pid;
end $$;
create function public.decide_shop_payment(p_id uuid,p_status text,p_ref text,p_note text,p_verification jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;payment shop_payments;
begin
 select * into item from shop_orders where id=(select order_id from shop_payments where id=p_id) for update;
 select * into payment from shop_payments where id=p_id for update;
 if item.deleted_at is not null or item.status='cancelled' or payment.id is null or payment.status not in ('pending','review') then raise exception 'รายการถูกดำเนินการแล้ว';end if;
 if p_status not in ('review','approved','rejected') then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_status='approved' then
 if payment.amount<>item.total or payment.drive_file_id is null or nullif(trim(p_ref),'') is null then raise exception 'ยอดหรือหลักฐานไม่ครบ';end if;
 perform pg_advisory_xact_lock(hashtextextended('slip:'||trim(p_ref),0));
 if exists(select 1 from payments where trans_ref=trim(p_ref)) or exists(select 1 from used_slip_refs where trans_ref=trim(p_ref)) then raise exception 'สลิปซ้ำ เคยใช้ชำระแล้ว';end if;
 insert into used_slip_refs(trans_ref) values(trim(p_ref));
 end if;
 update shop_payments set status=p_status,trans_ref=case when p_status='approved' then trim(p_ref) else trans_ref end,note=left(coalesce(p_note,''),1000),verification=coalesce(p_verification,verification),reviewed_at=now() where id=p_id;
 update shop_orders set payment_status=p_status,status=case when p_status='approved' and status='pending' then 'confirmed' else status end,updated_at=now() where id=item.id;
end $$;
-- Serialize bill approval and shop approval on the same transfer reference.
create function public.guard_shop_slip_ref() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.trans_ref is null then return new;end if;
 if tg_op='UPDATE' then if new.trans_ref is not distinct from old.trans_ref then return new;end if;end if;
 perform pg_advisory_xact_lock(hashtextextended('slip:'||trim(new.trans_ref),0));
 if exists(select 1 from used_slip_refs where trans_ref=trim(new.trans_ref)) then raise exception 'สลิปซ้ำ เคยใช้ชำระแล้ว';end if;
 return new;
end $$;
create trigger payments_shop_slip_guard before insert or update of trans_ref on public.payments for each row execute function public.guard_shop_slip_ref();
create or replace function public.evidence_cleanup_candidates() returns setof evidence_files language sql security invoker set search_path=public as $$
 select f.* from evidence_files f where f.state='active' and f.created_at<now()-interval '1 hour'
 and not exists(select 1 from payments p where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and p.deleted_at is null)
 and not exists(select 1 from shop_payments p join shop_orders o on o.id=p.order_id where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and o.deleted_at is null)
 order by f.created_at,f.path limit 100;
$$;
revoke all on function public.shop_selection(uuid,jsonb),public.place_shop_order(uuid,uuid,uuid,integer,text,jsonb),public.manage_shop_order(uuid,jsonb,boolean,timestamptz,uuid),public.bulk_shop_status(uuid[],text,uuid),public.reserve_shop_payment(uuid,uuid),public.decide_shop_payment(uuid,text,text,text,jsonb),public.guard_shop_slip_ref() from public,anon,authenticated;
grant execute on function public.shop_selection(uuid,jsonb),public.place_shop_order(uuid,uuid,uuid,integer,text,jsonb),public.manage_shop_order(uuid,jsonb,boolean,timestamptz,uuid),public.bulk_shop_status(uuid[],text,uuid),public.reserve_shop_payment(uuid,uuid),public.decide_shop_payment(uuid,text,text,text,jsonb),public.guard_shop_slip_ref() to service_role;
create function public.shop_sales_summary(p_paid boolean) returns jsonb language sql security invoker set search_path=public as $$
 with orders as(select * from shop_orders where deleted_at is null and status<>'cancelled' and (not p_paid or payment_status='approved')),
 products as(select product_id,max(product_title) as title,count(*) as orders,count(distinct student_id) as people,sum(quantity) as quantity,sum(total) as total from orders group by product_id),
 options as(select product_id,choice->>'group_id' as group_id,max(choice->>'group_name') as group_name,choice->>'option_id' as option_id,max(choice->>'option_name') as option_name,count(distinct student_id) as people,sum(quantity) as quantity from orders cross join lateral jsonb_array_elements(selected_options) choice group by product_id,choice->>'group_id',choice->>'option_id'),
 combos as(select product_id,selected_options,count(distinct student_id) as people,sum(quantity) as quantity from orders group by product_id,selected_options)
 select jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(p)) from products p),'[]'),'options',coalesce((select jsonb_agg(to_jsonb(o)) from options o),'[]'),'combinations',coalesce((select jsonb_agg(to_jsonb(c)) from combos c),'[]'));
$$;
revoke all on function public.shop_sales_summary(boolean) from public,anon,authenticated;
grant execute on function public.shop_sales_summary(boolean) to service_role;
