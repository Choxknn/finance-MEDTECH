do $$
declare existing_qr text;
begin
 perform pg_advisory_xact_lock(7086301);
 select image_url into existing_qr from public.payment_qrs where amount_cents=0 for update;
 if existing_qr is not null then
  update public.site_settings set data=jsonb_set(data,'{paymentQrUrl}',to_jsonb(existing_qr),true) where id=true;
  if not found then raise exception 'ไม่พบการตั้งค่าเว็บ';end if;
  delete from public.payment_qrs where amount_cents=0;
  insert into public.audit(actor,action,details) values('ระบบ','รวม QR หลักไว้ในตั้งค่าเว็บ',jsonb_build_object('main_qr_moved',true));
 end if;
end $$;
alter table public.payment_qrs add constraint payment_qrs_positive_amount check(amount_cents>0);
