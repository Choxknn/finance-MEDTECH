create table public.payment_qrs (
 id uuid primary key default gen_random_uuid(),amount_cents integer not null unique check(amount_cents between 0 and 100000000),
 image_url text not null check(image_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(image_url)<=1500000),
 updated_at timestamptz not null default now()
);
alter table public.payment_qrs enable row level security;
revoke all on public.payment_qrs from public,anon,authenticated;
grant all on public.payment_qrs to service_role;
create function public.manage_payment_qr(p_cents integer,p_image text,p_delete boolean,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare actor_name text; old_record jsonb; new_record jsonb;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 if p_cents is null or p_cents<0 or p_cents>100000000 or p_delete is null then raise exception 'ยอด QR ไม่ถูกต้อง';end if;
 select jsonb_build_object('id',id,'amount_cents',amount_cents,'image_url','[ภาพ QR]') into old_record from payment_qrs where amount_cents=p_cents for update;
 if p_delete then
  if old_record is null then raise exception 'ไม่พบ QR';end if;
  delete from payment_qrs where amount_cents=p_cents;
 else
  if p_image is null then raise exception 'กรุณาแนบภาพ QR';end if;
  insert into payment_qrs(amount_cents,image_url) values(p_cents,p_image) on conflict(amount_cents) do update set image_url=excluded.image_url,updated_at=now();
  select jsonb_build_object('id',id,'amount_cents',amount_cents,'image_url','[ภาพ QR]') into new_record from payment_qrs where amount_cents=p_cents;
 end if;
 insert into audit(actor,action,details) values(actor_name,case when p_delete then 'ลบ QR รับเงิน' else 'บันทึก QR ตามยอดเงิน' end,jsonb_build_object('before',old_record,'after',new_record));
end;$$;
revoke all on function public.manage_payment_qr(integer,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.manage_payment_qr(integer,text,boolean,uuid) to service_role;
