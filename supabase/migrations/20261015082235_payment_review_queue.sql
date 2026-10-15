alter table public.payments add column review_stage text check (review_stage in ('waiting','checking'));
alter table public.payments add column review_cleared_at timestamptz;
update public.payments set review_stage='waiting' where status in ('pending','review') and deleted_at is null;
create function public.track_payment_review_queue() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status in ('pending','review') then
  new.review_stage:=coalesce(new.review_stage,'waiting');
  new.review_cleared_at:=null;
 end if;
 return new;
end $$;
create trigger payment_review_queue before insert or update of status on public.payments for each row execute function public.track_payment_review_queue();
