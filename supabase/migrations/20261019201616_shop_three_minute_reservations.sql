create or replace function public.finalize_shop_checkout() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.payment_status='approved' then new.checkout_draft:=false;new.reservation_expires_at:=null;
 elsif new.checkout_draft then
  if tg_op='INSERT' then new.reservation_expires_at:=now()+interval '3 minutes';
  elsif new.payment_status='rejected' and old.payment_status in ('pending','review') then new.reservation_expires_at:=now()+interval '3 minutes';end if;
 end if;
 return new;
end $$;
