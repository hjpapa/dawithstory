-- Apply after discussion_review. Keep raw membership rows private;
-- the snapshot API publishes the approved roster with private fields removed.
create or replace function private.has_session()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid());
$$;
revoke all on function private.has_session() from public,anon;
grant execute on function private.has_session() to authenticated;

create or replace function private.can_read_review(p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_session()
 and exists(select 1 from public.members where room_id=p_room and user_id=auth.uid() and state='approved');
$$;
revoke all on function private.can_read_review(uuid) from public,anon;
grant execute on function private.can_read_review(uuid) to authenticated;

drop policy if exists member_access on public.members;
create policy member_access on public.members for select to authenticated using (
 private.is_host(room_id)
 or (user_id=auth.uid() and private.has_session())
);
