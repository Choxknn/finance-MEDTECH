drop trigger if exists finance_live_change on public.web_announcement_recipients;
create trigger finance_live_change
after insert or update or delete on public.web_announcement_recipients
for each row execute function public.finance_notify_change();
