-- Password reset invalidates refresh sessions and app access immediately.
-- Include older email-confirmation-pending signups in the operator approval list.
insert into public.profiles(id,email,status)
select id,email,'pending' from auth.users where email is not null and coalesce(is_anonymous,false)=false
on conflict(id) do nothing;
create or replace function public.story_session_valid(p_user uuid,p_session uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 return exists(select 1 from auth.sessions where id=p_session and user_id=p_user);
end $$;
create or replace function public.story_revoke_sessions(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 delete from auth.refresh_tokens where user_id=p_user::text;
 delete from auth.sessions where user_id=p_user;
 update public.rooms set state='paused',revision=revision+1 where owner_id=p_user and state='active';
end $$;
revoke all on function public.story_session_valid(uuid,uuid),public.story_revoke_sessions(uuid) from public,anon,authenticated;
grant execute on function public.story_session_valid(uuid,uuid),public.story_revoke_sessions(uuid) to service_role;

create or replace function private.is_host(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid())
 and exists(select 1 from public.rooms r join public.profiles p on p.id=r.owner_id where r.id=p_room and r.owner_id=auth.uid() and p.status='approved');
$$;
create or replace function private.can_read_room(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid())
 and (private.is_host(p_room) or exists(select 1 from public.members m join public.rooms r on r.id=m.room_id where m.room_id=p_room and m.user_id=auth.uid() and m.state='approved' and r.state<>'ended'));
$$;
