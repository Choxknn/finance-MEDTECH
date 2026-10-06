create or replace function public.add_fund_category(p_name text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor_name text; category_value text; data jsonb; categories jsonb;
begin
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 category_value:=regexp_replace(trim(p_name),'\s+',' ','g');
 if category_value is null or category_value='' or length(category_value)>100 then raise exception 'ชื่อหมวดหมู่ไม่ถูกต้อง';end if;
 select s.data into data from site_settings s where id=true for update;
 categories:=coalesce(data->'fund_categories','[]'::jsonb);
 if exists(select 1 from jsonb_array_elements_text(categories) n where lower(n)=lower(category_value)) then return categories;end if;
 if jsonb_array_length(categories)>=500 then raise exception 'มีหมวดหมู่ครบ 500 หมวดแล้ว';end if;
 categories:=categories||jsonb_build_array(category_value);
 update site_settings s set data=jsonb_set(s.data,'{fund_categories}',categories) where id=true;
 insert into audit(actor,action) values(actor_name,'เพิ่มหมวดหมู่: '||category_value);
 return categories;
end;$$;
revoke all on function public.add_fund_category(text,uuid) from public,anon,authenticated;
grant execute on function public.add_fund_category(text,uuid) to service_role;

create or replace function public.set_line_destination(p_profile uuid,p_line_user text,p_actor uuid,p_reason text)
returns void language plpgsql security invoker set search_path=public as $$
declare actor_name text; target profiles; previous text;
begin
 select name into actor_name from profiles where id=p_actor and role='admin' and active and deleted_at is null;
 if actor_name is null then raise exception 'ไม่มีสิทธิ์';end if;
 if p_line_user is null or p_line_user!~'^U[0-9a-f]{32}$' or nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'ข้อมูล LINE ไม่ถูกต้อง';end if;
 select * into target from profiles where id=p_profile and deleted_at is null for update;
 if target.id is null then raise exception 'ไม่พบสมาชิก';end if;
 select line_user_id into previous from line_accounts where profile_id=p_profile for update;
 if exists(select 1 from line_accounts where line_user_id=p_line_user and profile_id<>p_profile) then raise exception 'LINE นี้เชื่อมกับสมาชิกอื่นแล้ว';end if;
 insert into line_accounts(profile_id,line_user_id) values(p_profile,p_line_user) on conflict(profile_id) do update set line_user_id=excluded.line_user_id;
 delete from line_link_codes where profile_id=p_profile;
 insert into audit(actor,action,details) values(actor_name,'เปลี่ยน LINE ปลายทาง: '||target.name,jsonb_build_object('profile_id',p_profile,'reason',trim(p_reason),'before',jsonb_build_object('line_user_id',previous),'after',jsonb_build_object('line_user_id',p_line_user)));
end;$$;
revoke all on function public.set_line_destination(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.set_line_destination(uuid,text,uuid,text) to service_role;

-- Keep independently managed categories when public website settings are saved.
create or replace function public.save_settings(p_values jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare previous jsonb; updated jsonb; actor_name text;
begin
 perform pg_advisory_xact_lock(7086301);
 select name into actor_name from profiles where id=p_actor and active and deleted_at is null and role='admin';
 if actor_name is null then raise exception 'ไม่มีสิทธิ์ดำเนินการ';end if;
 select data into previous from site_settings where id=true for update;
 updated:=previous||p_values;
 update site_settings set data=updated where id=true;
 insert into audit(actor,action,details) values(actor_name,'แก้ไขการตั้งค่าเว็บ',jsonb_build_object('before',previous||jsonb_build_object('paymentQrUrl',case when previous->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else previous->>'paymentQrUrl' end),'after',updated||jsonb_build_object('paymentQrUrl',case when updated->>'paymentQrUrl' like 'data:%' then '[ภาพ QR]' else updated->>'paymentQrUrl' end)));
end;$$;
