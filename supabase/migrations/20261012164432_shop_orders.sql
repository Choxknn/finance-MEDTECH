create table public.shop_products(id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 120),description text not null default '',price numeric(12,2) not null check(price>=0),stock integer not null default 0 check(stock>=0),images text[] not null default '{}',active boolean not null default false,deleted_at timestamptz,created_at timestamptz not null default now());
create table public.shop_orders(id uuid primary key,profile_id uuid references public.profiles(id) on delete set null,student_id text not null,buyer_name text not null,product_id uuid references public.shop_products(id),product_title text not null,unit_price numeric(12,2) not null,quantity integer not null check(quantity between 1 and 100),total numeric(12,2) not null,note text not null default '',status text not null default 'pending' check(status in ('pending','confirmed','ready','completed','cancelled')),created_at timestamptz not null default now());
create index shop_orders_profile_created on public.shop_orders(profile_id,created_at desc);
create index shop_orders_product on public.shop_orders(product_id);
alter table public.shop_products enable row level security;
alter table public.shop_orders enable row level security;
revoke all on public.shop_products,public.shop_orders from anon,authenticated;
grant all on public.shop_products,public.shop_orders to service_role;
create function public.place_shop_order(p_id uuid,p_profile uuid,p_product uuid,p_quantity integer,p_note text) returns public.shop_orders language plpgsql security invoker set search_path=public as $$
declare product shop_products; person profiles; result shop_orders;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into result from shop_orders where id=p_id;
 if found then if result.profile_id is distinct from p_profile then raise exception 'คำขอไม่ถูกต้อง'; end if;return result;end if;
 select * into person from profiles where id=p_profile and active and deleted_at is null;
 if not found then raise exception 'ไม่พบบัญชีสมาชิก';end if;
 if p_quantity is null or p_quantity<1 or p_quantity>100 or length(coalesce(p_note,''))>1000 then raise exception 'ข้อมูลสั่งซื้อไม่ถูกต้อง';end if;
 select * into product from shop_products where id=p_product for update;
 if not found or not product.active or product.deleted_at is not null then raise exception 'สินค้านี้ปิดรับคำสั่งซื้อแล้ว';end if;
 if product.stock<p_quantity then raise exception 'สินค้าไม่เพียงพอ กรุณาปรับจำนวน';end if;
 update shop_products set stock=stock-p_quantity where id=p_product;
 insert into shop_orders(id,profile_id,student_id,buyer_name,product_id,product_title,unit_price,quantity,total,note) values(p_id,p_profile,person.student_id,person.name,product.id,product.title,product.price,p_quantity,product.price*p_quantity,coalesce(p_note,'')) returning * into result;
 return result;
end $$;
create function public.update_shop_order(p_id uuid,p_status text) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;
begin
 if p_status not in ('pending','confirmed','ready','completed','cancelled') then raise exception 'สถานะไม่ถูกต้อง';end if;
 select * into item from shop_orders where id=p_id for update;
 if not found then raise exception 'ไม่พบคำสั่งซื้อ';end if;
 if item.status='cancelled' and p_status<>'cancelled' then raise exception 'คำสั่งซื้อที่ยกเลิกแล้วไม่สามารถเปิดใหม่';end if;
 if item.status<>'cancelled' and p_status='cancelled' then update shop_products set stock=stock+item.quantity where id=item.product_id;end if;
 update shop_orders set status=p_status where id=p_id;
end $$;
revoke all on function public.place_shop_order(uuid,uuid,uuid,integer,text),public.update_shop_order(uuid,text) from public,anon,authenticated;
grant execute on function public.place_shop_order(uuid,uuid,uuid,integer,text),public.update_shop_order(uuid,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('shop-products','shop-products',true,5242880,array['image/jpeg','image/png','image/webp']);
