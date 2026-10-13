alter table public.shop_orders add column reservation_expires_at timestamptz;
update public.shop_orders set reservation_expires_at=now()+interval '15 minutes' where checkout_draft and deleted_at is null;
create or replace function public.finalize_shop_checkout() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.payment_status='approved' then new.checkout_draft:=false;new.reservation_expires_at:=null;
 elsif new.checkout_draft then
  if tg_op='INSERT' then new.reservation_expires_at:=now()+interval '15 minutes';
  elsif new.payment_status='rejected' and old.payment_status in ('pending','review') then new.reservation_expires_at:=now()+interval '15 minutes';end if;
 end if;
 return new;
end $$;
create function public.expire_shop_reservations() returns integer language plpgsql security invoker set search_path=public as $$
declare item shop_orders;n integer:=0;
begin
 for item in select * from shop_orders where checkout_draft and deleted_at is null and status<>'cancelled' and payment_status in ('unpaid','rejected') and reservation_expires_at<=now() order by id for update skip locked loop
  update shop_products set stock=stock+item.quantity where id=item.product_id;
  insert into trash_cleanup_queue(kind,target) select 'drive',drive_file_id from shop_payments where order_id=item.id and drive_file_id is not null on conflict do nothing;
  update shop_orders set status='cancelled',deleted_at=now(),updated_at=now() where id=item.id;
  n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.expire_shop_reservations() from public,anon,authenticated;
grant execute on function public.expire_shop_reservations() to service_role;
create index shop_reservation_expiry on public.shop_orders(reservation_expires_at) where checkout_draft and deleted_at is null and payment_status in ('unpaid','rejected');
select cron.schedule('finance-shop-reservation-expiry','* * * * *','select public.expire_shop_reservations();');
create or replace function public.reserve_shop_payment(p_order uuid,p_profile uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare item shop_orders;pid uuid;
begin
 if not payment_window_open() then raise exception 'ปิดรับชำระชั่วคราว 23:50–01:00 น.';end if;
 select * into item from shop_orders where id=p_order and profile_id=p_profile and deleted_at is null for update;
 if not found or item.status='cancelled' then raise exception 'ไม่พบคำสั่งซื้อที่ชำระได้';end if;
 if item.checkout_draft and item.payment_status in ('unpaid','rejected') and item.reservation_expires_at<=now() then raise exception 'หมดเวลาจองสินค้าแล้ว กรุณาเลือกสินค้าใหม่';end if;
 if item.payment_status='approved' or item.total<=0 then raise exception 'ชำระเงินแล้ว';end if;
 -- A timed-out upload can be retried; a completed verification remains reviewable.
 update shop_payments set status='rejected',note='การส่งสลิปหมดเวลา กรุณาส่งใหม่' where order_id=p_order and status='pending' and created_at<now()-interval '3 minutes';
 if exists(select 1 from shop_payments where order_id=p_order and status in ('pending','review','approved')) then raise exception 'มีสลิปรอตรวจอยู่แล้ว';end if;
 insert into shop_payments(order_id,amount) values(p_order,item.total) returning id into pid;
 update shop_orders set payment_status='pending',updated_at=now() where id=p_order;return pid;
end $$;
