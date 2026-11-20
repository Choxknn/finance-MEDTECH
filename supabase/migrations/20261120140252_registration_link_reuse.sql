alter table public.registration_batches add column if not exists token_ciphertext text;
alter table public.member_invites add column if not exists token_ciphertext text;
