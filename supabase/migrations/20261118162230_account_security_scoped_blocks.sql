alter table public.account_security_blocks
 add column target_hash text not null default repeat('0',64)
 check (target_hash ~ '^[0-9a-f]{64}$');
alter table public.account_security_blocks
 drop constraint account_security_blocks_pkey;
alter table public.account_security_blocks
 add primary key (ip_hash,target_hash);
create index account_security_blocks_expiry
 on public.account_security_blocks(blocked_until);
