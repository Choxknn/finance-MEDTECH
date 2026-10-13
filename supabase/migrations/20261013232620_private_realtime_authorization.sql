create schema if not exists finance_private;
revoke all on schema finance_private from public,anon;
grant usage on schema finance_private to authenticated;
alter function public.finance_realtime_allowed(text) set schema finance_private;
