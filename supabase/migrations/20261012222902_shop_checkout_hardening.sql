create or replace function public.manage_shop_order(p_id uuid,p_patch jsonb,p_delete boolean,p_expected timestamptz,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
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
 update shop_orders set quantity=qty,unit_price=price,total=qty*price,note=new_note,selected_options=selection,payment_status=case when qty*price=0 then 'approved' else payment_status end,status=case when qty*price=0 and status='pending' then 'confirmed' else status end,updated_at=now() where id=p_id;
 end if;
 insert into audit(actor,action) select name,(case when p_delete then 'ลบคำสั่งซื้อ ' else 'แก้ไขคำสั่งซื้อ ' end)||p_id::text from profiles where id=p_actor;
end $$;
