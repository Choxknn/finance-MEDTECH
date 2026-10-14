-- A physical finance-record deletion authorizes deletion of its own attachments.
-- Soft deletion, storage pressure and replacement do not authorize it.
alter table public.evidence_files add column purge_with_record boolean not null default false;
create or replace function public.guard_protected_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.protected and (tg_op='DELETE' or not new.protected or (new.state in ('deleting','deleted') and old.state not in ('deleting','deleted') and not old.purge_with_record)) then raise exception 'ห้ามลบหลักฐานการเงินและ QR ชำระเงิน';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create or replace function public.queue_deleted_finance_evidence() returns trigger language plpgsql security invoker set search_path=public as $$
declare target_id text;
begin
 foreach target_id in array array[old.drive_file_id,old.receipt_file_id] loop
 if target_id like 'sb:%'
 and not exists(select 1 from manual_incomes where target_id in (drive_file_id,receipt_file_id))
 and not exists(select 1 from expenses where target_id in (drive_file_id,receipt_file_id))
 and not exists(select 1 from payments where drive_file_id=target_id)
 and not exists(select 1 from shop_payments where drive_file_id=target_id)
 then
 update evidence_files set purge_with_record=true where path=substr(target_id,4) and name !~ '^(qr|payment-qr)(-|\.)';
 insert into trash_cleanup_queue(kind,target) values('drive',target_id) on conflict do nothing;
 end if;
 end loop;
 return old;
end $$;
create trigger delete_income_attachments after delete on public.manual_incomes for each row execute function public.queue_deleted_finance_evidence();
create trigger delete_expense_attachments after delete on public.expenses for each row execute function public.queue_deleted_finance_evidence();
revoke all on function public.queue_deleted_finance_evidence() from public,anon,authenticated;
grant execute on function public.queue_deleted_finance_evidence() to service_role;
