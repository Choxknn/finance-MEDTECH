-- Allow the dedicated Flex notification type for individual bill amount changes.
alter table public.notifications
  drop constraint if exists notifications_message_kind_check;

alter table public.notifications
  add constraint notifications_message_kind_check
  check (message_kind in (
    'message',
    'announcement',
    'password',
    'reminder',
    'correction',
    'payment_success',
    'bill_updated'
  ));
