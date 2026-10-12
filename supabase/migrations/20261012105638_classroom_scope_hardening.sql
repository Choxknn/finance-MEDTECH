alter function public.consume_line_code(text,text) security invoker;
create or replace function public.classroom_create(p_actor uuid,p_name text,p_owner uuid default null) returns uuid language plpgsql security invoker set search_path=public as $$
declare owner uuid:=coalesce(p_owner,p_actor); result uuid; super boolean;
begin
 perform pg_advisory_xact_lock(7086399);
 select is_super into super from classroom_admins a join profiles p on p.id=a.profile_id where a.profile_id=p_actor and p.active and p.deleted_at is null;
 if super is null or (owner<>p_actor and not super) then raise exception 'ไม่มีสิทธิ์สร้างห้องเรียน';end if;
 if not exists(select 1 from classroom_admins where profile_id=owner) then raise exception 'เลือกแอดมินห้องเรียน';end if;
 if not super and exists(select 1 from classrooms where owner_id=owner) then raise exception 'สร้างห้องได้ 1 ห้อง หากต้องการเพิ่มให้ติดต่อผู้ดูแลหลัก';end if;
 insert into classrooms(name,owner_id) values(trim(p_name),owner) returning id into result;
 update profiles set classroom_id=result where id=owner and classroom_id is null;
 insert into site_settings(id,data,classroom_id) values(true,'{"siteName":"Finance MEDTECH","bankName":"","accountName":"","accountNumber":"","paymentQrUrl":"","lineOaUrl":"https://lin.ee/7VYJbx0"}',result);
 insert into evidence_storage_settings(id,classroom_id) values(true,result);
 return result;
end;$$;
revoke execute on function public.create_round(text,text,numeric,date,text) from finance_classroom;
