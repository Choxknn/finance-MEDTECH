alter table public.line_accounts add column if not exists display_name text;
create or replace function public.publish_web_announcement(p_title text,p_body text,p_members uuid[],p_actor uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare n uuid;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active and deleted_at is null) then raise exception 'ไม่มีสิทธิ์';end if;
 insert into web_announcements(title,body,created_by) values(p_title,p_body,p_actor) returning id into n;
 insert into audit(actor,action,details) select name,'สร้างประกาศถึงทุกคนในเว็บ',jsonb_build_object('title',p_title) from profiles where id=p_actor;
 return n;
end;$$;
revoke all on function public.publish_web_announcement(text,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.publish_web_announcement(text,text,uuid[],uuid) to service_role;
