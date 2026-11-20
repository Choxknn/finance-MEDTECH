create or replace function public.revoke_registration_batch(p_id uuid,p_actor uuid)
returns integer language plpgsql security invoker set search_path=public as $$
declare actor_name text; revoked_count integer;
begin
 select name into actor_name from public.profiles
 where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์'; end if;
 perform id from public.registration_batches where id=p_id for update;
 if not found then raise exception 'ไม่พบลิงก์สมัครชุดนี้'; end if;
 perform id from public.member_invites
 where batch_id=p_id and status in ('draft','pending') order by id for update;
 update public.member_invites set status='revoked'
 where batch_id=p_id and status in ('draft','pending');
 get diagnostics revoked_count = row_count;
 if revoked_count=0 then raise exception 'ลิงก์สมัครชุดนี้ไม่มีสมาชิกที่ยังสมัครได้แล้ว'; end if;
 update public.registration_batches
 set token_hash=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')
 where id=p_id;
 insert into public.audit(actor,action)
 values(actor_name,'ยกเลิกลิงก์สมัครร่วม '||revoked_count||' คน · ชุด '||p_id::text);
 return revoked_count;
end; $$;
revoke all on function public.revoke_registration_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_registration_batch(uuid,uuid) to service_role;
