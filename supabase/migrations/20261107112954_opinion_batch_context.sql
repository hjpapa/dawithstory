-- The teacher's broadcast contains IDs only. Authorize the batch once, then
-- read the room scope and its visible opinions from one statement snapshot.
-- The private definer is deliberate: repeating message RLS for every ID also
-- repeats session, owner and profile lookups. No existing RLS policy changes.
create or replace function private.teacher_opinions(p_room uuid, p_ids bigint[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  r public.rooms;
  opinions jsonb := '[]'::jsonb;
begin
  if actor is null or not private.has_session() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 100
      or array_ndims(p_ids) <> 1
      or exists (select 1 from unnest(p_ids) id where id is null or id <= 0) then
    raise exception 'Invalid opinion IDs' using errcode = '22023';
  end if;
  select room.* into r
  from public.rooms room
  join public.profiles owner_profile on owner_profile.id = room.owner_id
  where room.id = p_room and room.owner_id = actor
    and owner_profile.status = 'approved';
  if not found then raise exception 'Forbidden' using errcode = '42501'; end if;

  if r.state = 'active' then
    select coalesce(jsonb_agg(to_jsonb(opinion) order by opinion.id), '[]'::jsonb)
    into opinions
    from (
      select m.id, m.room_id, m.role, m.member_id, m.nickname, m.avatar,
        m.content, m.stance, m.visibility, m.round_number, m.created_at, m.edited_at
      from public.messages m
      where m.id = any(p_ids) and m.room_id = r.id
        and m.round_number = r.round_number and m.role = 'member'
        and m.member_id is not null and m.visibility = 'visible'
    ) opinion;
  end if;
  return jsonb_build_object('room', to_jsonb(r), 'messages', opinions);
end;
$$;

create or replace function public.story_teacher_opinions(p_room uuid, p_ids bigint[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.teacher_opinions(p_room, p_ids);
$$;
revoke all on function private.teacher_opinions(uuid,bigint[]),
  public.story_teacher_opinions(uuid,bigint[]) from public, anon, authenticated, service_role;
grant execute on function private.teacher_opinions(uuid,bigint[]),
  public.story_teacher_opinions(uuid,bigint[]) to authenticated;

-- The Edge Function still verifies the bearer with Auth and checks speech
-- permissions and moderation. This combines its fresh database reads without
-- caching authorization or changing the final room-locked story_mutate check.
-- Snapshot callers pass false so this authorization read never touches Vault.
create or replace function private.message_context(p_actor uuid, p_session uuid, p_room uuid, p_include_ai_key boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rooms;
  member public.members;
  is_host boolean;
  ai_enabled boolean;
  ai_key text;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- NULL lets the Edge preserve its existing expired-session HTTP 401 response.
  if not exists (
    select 1 from auth.sessions where id = p_session and user_id = p_actor
  ) then return null; end if;

  select * into r from public.rooms where id = p_room;
  if not found then raise exception '대화방을 찾을 수 없어요.'; end if;
  is_host := r.owner_id = p_actor and exists (
    select 1 from public.profiles where id = p_actor and status = 'approved'
  );
  select * into member from public.members where room_id = p_room and user_id = p_actor;
  if not is_host and (
    member.id is null or member.state in ('kicked', 'rejected')
    or (r.state = 'ended' and member.state <> 'approved')
  ) then raise exception '이 대화방에 접근할 수 없어요.'; end if;

  ai_enabled := r.is_demo or coalesce(
    (select value = 'true' from private.settings where key = 'ai_live_enabled'), false
  );
  if ai_enabled and p_include_ai_key is true then ai_key := public.story_ai_key(); end if;
  return jsonb_build_object(
    'room', to_jsonb(r), 'isHost', is_host,
    'me', case when member.id is null then null else to_jsonb(member) end,
    'aiEnabled', ai_enabled, 'aiKey', ai_key
  );
end;
$$;

create or replace function public.story_message_context(p_actor uuid, p_session uuid, p_room uuid, p_include_ai_key boolean default true)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.message_context(p_actor, p_session, p_room, p_include_ai_key);
$$;
revoke all on function private.message_context(uuid,uuid,uuid,boolean),
  public.story_message_context(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.message_context(uuid,uuid,uuid,boolean),
  public.story_message_context(uuid,uuid,uuid,boolean) to service_role;
