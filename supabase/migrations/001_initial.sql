-- Run once in a new Supabase project. All writes go through server functions.
create table public.profiles (
 id uuid primary key references auth.users(id), student_id text unique not null,
 name text not null, year text, role text not null default 'member' check(role in ('member','admin')),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table public.rounds (
 id uuid primary key default gen_random_uuid(), title text not null, description text,
 amount numeric(12,2) not null check(amount>0), due_date date not null, created_at timestamptz default now()
);
create table public.charges (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
 round_id uuid not null references public.rounds(id), amount numeric(12,2) not null check(amount>0),
 unique(profile_id,round_id)
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
 charge_id uuid not null references public.charges(id), amount numeric(12,2) not null check(amount>0),
 status text not null default 'pending' check(status in ('pending','review','approved','rejected')),
 drive_file_id text, trans_ref text unique, source text not null default 'slipok',
 note text, verification jsonb, reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz, created_at timestamptz not null default now()
);
create unique index one_open_payment_per_charge on public.payments(charge_id) where status in ('pending','review');
create table public.expenses (
 id uuid primary key default gen_random_uuid(),title text not null,category text not null,
 amount numeric(12,2) not null check(amount>0),spent_on date not null,note text,drive_file_id text,
 created_by uuid not null references public.profiles(id),created_at timestamptz default now()
);
create table public.line_accounts (
 profile_id uuid primary key references public.profiles(id), line_user_id text unique not null
);
create table public.line_link_codes (
 code_hash text primary key,profile_id uuid not null references public.profiles(id),expires_at timestamptz not null
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
 title text, body text not null,status text not null default 'queued',error text,
 retry_key uuid not null default gen_random_uuid(),created_at timestamptz default now()
);
create table public.audit (
 id uuid primary key default gen_random_uuid(),actor text not null,action text not null,created_at timestamptz default now()
);
-- RLS is enabled everywhere; no anon/authenticated access to provider records or writes.
alter table public.profiles enable row level security;
alter table public.rounds enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.line_accounts enable row level security;
alter table public.line_link_codes enable row level security;
alter table public.notifications enable row level security;
alter table public.audit enable row level security;
revoke all on public.profiles,public.rounds,public.charges,public.payments,public.expenses,public.line_accounts,public.line_link_codes,public.notifications,public.audit from anon,authenticated;
grant all on public.profiles,public.rounds,public.charges,public.payments,public.expenses,public.line_accounts,public.line_link_codes,public.notifications,public.audit to service_role;

create function public.create_round(p_title text,p_description text,p_amount numeric,p_due date,p_actor text)
returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid;
begin
 insert into rounds(title,description,amount,due_date) values(p_title,p_description,p_amount,p_due) returning id into rid;
 insert into charges(profile_id,round_id,amount) select id,rid,p_amount from profiles where role='member' and active;
 insert into audit(actor,action) values(p_actor,'สร้างรอบเก็บเงิน: '||p_title);
 return rid;
end;$$;
create function public.reserve_payment(p_profile uuid,p_charge uuid,p_amount numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare c charges; received numeric; pid uuid;
begin
 select * into c from charges where id=p_charge for update;
 if c.id is null or c.profile_id<>p_profile then raise exception 'รายการไม่ถูกต้อง';end if;
 select coalesce(sum(amount),0) into received from payments where charge_id=p_charge and status='approved';
 if p_amount<=0 or p_amount>c.amount-received then raise exception 'ยอดเกินค้างชำระ';end if;
 insert into payments(profile_id,charge_id,amount) values(p_profile,p_charge,p_amount) returning id into pid;
 return pid;
end;$$;
create function public.decide_payment(p_id uuid,p_decision text,p_note text,p_ref text,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare p payments; c charges; received numeric;
begin
 -- Lock the charge first for consistent lock ordering with reserve_payment.
 select * into c from charges where id=(select charge_id from payments where id=p_id) for update;
 select * into p from payments where id=p_id for update;
 if p.id is null or p.status not in ('pending','review') then raise exception 'รายการถูกดำเนินการแล้ว';end if;
 if p_decision not in ('approved','rejected') then raise exception 'สถานะไม่ถูกต้อง';end if;
 if p_decision='approved' then
  if p.drive_file_id is null or nullif(trim(p_ref),'') is null then raise exception 'ต้องมีหลักฐานและเลขอ้างอิง';end if;
  select coalesce(sum(amount),0) into received from payments where charge_id=p.charge_id and status='approved';
  if received+p.amount>c.amount then raise exception 'ยอดเกินเรียกเก็บ';end if;
 end if;
 update payments set status=p_decision,note=p_note,trans_ref=case when p_decision='approved' then trim(p_ref) else trans_ref end,reviewed_by=p_actor,reviewed_at=now() where id=p_id;
 insert into audit(actor,action) values(coalesce((select name from profiles where id=p_actor),'SlipOK'),p_decision||': '||p_id::text);
end;$$;
create function public.consume_line_code(p_hash text,p_line_user text)
returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
 delete from line_link_codes where code_hash=p_hash and expires_at>now() returning profile_id into pid;
 if pid is null then return null;end if;
 if not exists(select 1 from profiles where id=pid and active) then return null;end if;
 insert into line_accounts(profile_id,line_user_id) values(pid,p_line_user) on conflict(profile_id) do update set line_user_id=excluded.line_user_id;
 delete from line_link_codes where profile_id=pid;
 return pid;
end;$$;
revoke all on function public.create_round(text,text,numeric,date,text),public.reserve_payment(uuid,uuid,numeric),public.decide_payment(uuid,text,text,text,uuid),public.consume_line_code(text,text) from public,anon,authenticated;
grant execute on function public.create_round(text,text,numeric,date,text),public.reserve_payment(uuid,uuid,numeric),public.decide_payment(uuid,text,text,text,uuid),public.consume_line_code(text,text) to service_role;
