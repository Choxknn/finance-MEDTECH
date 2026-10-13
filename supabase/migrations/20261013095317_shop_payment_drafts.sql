alter table public.shop_orders add column checkout_draft boolean not null default false;
update public.shop_orders set checkout_draft=true where payment_status<>'approved' and status='pending' and deleted_at is null;
alter table public.shop_orders alter column checkout_draft set default true;
create function public.finalize_shop_checkout() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.payment_status='approved' then new.checkout_draft:=false;end if;
 return new;
end $$;
create trigger finalize_shop_checkout before insert or update on public.shop_orders for each row execute function public.finalize_shop_checkout();
revoke all on function public.finalize_shop_checkout() from public,anon,authenticated;
grant execute on function public.finalize_shop_checkout() to service_role;
create function public.cancel_shop_checkout(p_id uuid,p_profile uuid) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;
begin
 select * into item from shop_orders where id=p_id and profile_id=p_profile for update;
 if not found then raise exception 'ไม่พบรายการจอง';end if;
 if item.deleted_at is not null or item.status='cancelled' then return;end if;
 if not item.checkout_draft or item.payment_status not in ('unpaid','rejected') then raise exception 'รายการนี้ชำระแล้วหรือมีสลิปรอตรวจ ไม่สามารถยกเลิกการจอง';end if;
 update shop_products set stock=stock+item.quantity where id=item.product_id;
 update shop_orders set status='cancelled',deleted_at=now(),updated_at=now() where id=p_id;
end $$;
revoke all on function public.cancel_shop_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_shop_checkout(uuid,uuid) to service_role;
create or replace function public.shop_sales_summary(p_paid boolean) returns jsonb language sql security invoker set search_path=public as $$
 with orders as(select * from shop_orders where deleted_at is null and not checkout_draft and status<>'cancelled' and (not p_paid or payment_status='approved')),
 products as(select product_id,max(product_title) as title,count(*) as orders,count(distinct student_id) as people,sum(quantity) as quantity,sum(total) as total from orders group by product_id),
 options as(select product_id,choice->>'group_id' as group_id,max(choice->>'group_name') as group_name,choice->>'option_id' as option_id,max(choice->>'option_name') as option_name,count(distinct student_id) as people,sum(quantity) as quantity from orders cross join lateral jsonb_array_elements(selected_options) choice group by product_id,choice->>'group_id',choice->>'option_id'),
 combos as(select product_id,selected_options,count(distinct student_id) as people,sum(quantity) as quantity from orders group by product_id,selected_options)
 select jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(p)) from products p),'[]'),'options',coalesce((select jsonb_agg(to_jsonb(o)) from options o),'[]'),'combinations',coalesce((select jsonb_agg(to_jsonb(c)) from combos c),'[]'));
$$;
revoke all on function public.shop_sales_summary(boolean) from public,anon,authenticated;
grant execute on function public.shop_sales_summary(boolean) to service_role;
