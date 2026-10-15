alter table public.web_announcements add column show_on_entry boolean not null default false;
alter table public.web_announcements add column drive_file_id text;
alter table public.web_announcements drop constraint web_announcements_body_check;
alter table public.web_announcements add constraint web_announcements_body_check check(char_length(body)<=2000 and (char_length(body)>0 or drive_file_id is not null));
create trigger announcement_evidence_cleanup after delete or update of drive_file_id on public.web_announcements for each row execute function public.queue_replaced_evidence();
create or replace function public.evidence_cleanup_candidates() returns setof public.evidence_files language sql security invoker set search_path=public as $$
 select f.* from evidence_files f where f.state='active' and not f.protected and f.created_at<now()-interval '1 hour'
 and not exists(select 1 from payments p where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and p.deleted_at is null)
 and not exists(select 1 from shop_payments p join shop_orders o on o.id=p.order_id where p.drive_file_id='sb:'||f.path and p.status in ('pending','review') and o.deleted_at is null)
 and not exists(select 1 from web_announcements a where a.drive_file_id='sb:'||f.path)
 order by f.created_at,f.path limit 100;
$$;
