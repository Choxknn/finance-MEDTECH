alter table public.shop_orders add column base_unit_price numeric(12,2);
update public.shop_orders set base_unit_price=unit_price;
alter table public.shop_orders alter column base_unit_price set not null;
create or replace function public.shop_selection(p_product uuid,p_choices jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare groups jsonb;g jsonb;o jsonb;result jsonb:='[]'; selected text;
begin
 if jsonb_typeof(p_choices) is distinct from 'object' then raise exception 'ตัวเลือกสินค้าไม่ถูกต้อง';end if;
 select option_groups into groups from shop_products where id=p_product;
 for g in select value from jsonb_array_elements(groups) loop
 selected:=nullif(p_choices->>(g->>'id'),'');
 if selected is null then if coalesce((g->>'required')::boolean,true) then raise exception 'กรุณาเลือก %',g->>'name';end if;continue;end if;
 select value into o from jsonb_array_elements(g->'options') where value->>'id'=selected;
 if o is null then raise exception 'ตัวเลือก % เปลี่ยนแล้ว กรุณาเลือกใหม่',g->>'name';end if;
 result:=result||jsonb_build_array(jsonb_build_object('group_id',g->>'id','group_name',g->>'name','option_id',o->>'id','option_name',o->>'name','price_delta',coalesce((o->>'price_delta')::numeric,0)));
 end loop;return result;
end $$;
create or replace function public.place_shop_order(p_id uuid,p_profile uuid,p_product uuid,p_quantity integer,p_note text,p_choices jsonb) returns public.shop_orders language plpgsql security invoker set search_path=public as $$
declare product shop_products;person profiles;result shop_orders;selection jsonb;unit numeric;
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
 select product.price+coalesce(sum((value->>'price_delta')::numeric),0) into unit from jsonb_array_elements(selection);
 if product.stock<p_quantity then raise exception 'สินค้าไม่เพียงพอ กรุณาปรับจำนวน';end if;
 update shop_products set stock=stock-p_quantity where id=p_product;
 insert into shop_orders(id,profile_id,student_id,buyer_name,product_id,product_title,unit_price,base_unit_price,quantity,total,note,selected_options,payment_status,status) values(p_id,p_profile,person.student_id,person.name,product.id,product.title,unit,product.price,p_quantity,unit*p_quantity,coalesce(p_note,''),selection,case when unit=0 then 'approved' else 'unpaid' end,case when unit=0 then 'confirmed' else 'pending' end) returning * into result;
 return result;
end $$;
create or replace function public.manage_shop_order(p_id uuid,p_patch jsonb,p_delete boolean,p_expected timestamptz,p_actor uuid) returns void language plpgsql security invoker set search_path=public as $$
declare item shop_orders;qty integer;price numeric;base numeric;extra numeric;selection jsonb;new_note text;
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
 qty:=coalesce((p_patch->>'quantity')::integer,item.quantity);new_note:=coalesce(p_patch->>'note',item.note);
 perform 1 from shop_products where id=item.product_id for update;
 selection:=case when p_patch ? 'choices' then shop_selection(item.product_id,p_patch->'choices') else item.selected_options end;
 select coalesce(sum(coalesce((value->>'price_delta')::numeric,0)),0) into extra from jsonb_array_elements(selection);
 base:=coalesce((p_patch->>'base_unit_price')::numeric,case when p_patch ? 'unit_price' then (p_patch->>'unit_price')::numeric-(item.unit_price-item.base_unit_price) else item.base_unit_price end);price:=base+extra;
 if qty<1 or qty>100 or base<0 or base>9999999 or round(base,2)<>base or length(new_note)>1000 then raise exception 'จำนวน ราคาหรือหมายเหตุไม่ถูกต้อง';end if;
 if item.payment_status='approved' and (qty<>item.quantity or price<>item.unit_price) then raise exception 'ออเดอร์ชำระแล้วแก้ยอดเงินไม่ได้ แก้ตัวเลือกและหมายเหตุได้';end if;

 if item.status<>'cancelled' and qty<>item.quantity then
 update shop_products set stock=stock+item.quantity-qty where id=item.product_id and stock+item.quantity>=qty;
 if not found then raise exception 'สินค้าไม่เพียงพอ';end if;end if;
 update shop_orders set quantity=qty,unit_price=price,base_unit_price=base,total=qty*price,note=new_note,selected_options=selection,payment_status=case when qty*price=0 then 'approved' else payment_status end,status=case when qty*price=0 and status='pending' then 'confirmed' else status end,updated_at=now() where id=p_id;
 end if;
 insert into audit(actor,action) select name,(case when p_delete then 'ลบคำสั่งซื้อ ' else 'แก้ไขคำสั่งซื้อ ' end)||p_id::text from profiles where id=p_actor;
end $$;

create table public.attendance_sessions(id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 120),held_on date not null default (now() at time zone 'Asia/Bangkok')::date,active boolean not null default true,created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now());
create table public.attendance_marks(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.attendance_sessions(id) on delete cascade,profile_id uuid references public.profiles(id) on delete set null,student_id text not null,name text not null,checked_by uuid references public.profiles(id) on delete set null,checked_at timestamptz not null default now(),unique(session_id,student_id));
create index attendance_marks_profile on public.attendance_marks(profile_id);
alter table public.attendance_sessions enable row level security;
alter table public.attendance_marks enable row level security;
revoke all on public.attendance_sessions,public.attendance_marks from anon,authenticated;
grant all on public.attendance_sessions,public.attendance_marks to service_role;
create function public.check_in_student(p_session uuid,p_student text,p_actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare person profiles;session attendance_sessions;entry attendance_marks;duplicate boolean;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'เฉพาะผู้ดูแลระบบ';end if;
 select * into session from attendance_sessions where id=p_session for share;
 if not found or not session.active then raise exception 'รอบเช็คชื่อปิดแล้ว กรุณาเลือกรอบที่เปิดอยู่';end if;
 select * into person from profiles where student_id=p_student and active and deleted_at is null;
 if not found then raise exception 'ไม่พบรหัสนักศึกษานี้ในสมาชิกที่ใช้งาน';end if;
 insert into attendance_marks(session_id,profile_id,student_id,name,checked_by) values(p_session,person.id,person.student_id,person.name,p_actor) on conflict(session_id,student_id) do nothing returning * into entry;
 duplicate:=not found;
 if duplicate then select * into entry from attendance_marks where session_id=p_session and student_id=p_student;end if;
 return jsonb_build_object('entry',to_jsonb(entry),'already',duplicate,'session_title',session.title);
end $$;
revoke all on function public.check_in_student(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.check_in_student(uuid,text,uuid) to service_role;
