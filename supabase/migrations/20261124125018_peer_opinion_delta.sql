-- The room scope and the public delta use the same statement snapshot. Like the
-- teacher batch, this checks the live session and room authority once instead
-- of repeating the message RLS checks for every opinion in the batch.
create function private.peer_opinions(p_room uuid, p_after bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  scope record;
  opinions jsonb;
begin
  if p_after is null or p_after < 0 then
    raise exception 'Invalid opinion cursor' using errcode = '22023';
  end if;
  if actor is null or not private.has_session() then return null; end if;

  select r.id, r.revision, r.state, r.messages_epoch, r.round_number, r.round_open,
    r.speaker_ids, member.id as reader_id
  into scope
  from public.rooms r
  join public.members member on member.room_id = r.id
  where r.id = p_room and r.state = 'active' and r.owner_id <> actor
    and member.user_id = actor and member.state = 'approved';
  if not found then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(opinion) order by opinion.id), '[]'::jsonb)
  into opinions
  from (
    select m.id, m.room_id, m.role, m.member_id, m.nickname, m.avatar,
      m.content, m.stance, m.visibility, m.round_number, m.created_at, m.edited_at
    from public.messages m
    where m.room_id = scope.id and m.round_number = scope.round_number
      and m.role = 'member' and m.visibility = 'visible'
      and m.member_id <> scope.reader_id and m.id > p_after
    order by m.id limit 30
  ) opinion;

  return jsonb_build_object(
    'id', scope.id, 'revision', scope.revision, 'state', scope.state,
    'messages_epoch', scope.messages_epoch, 'round_number', scope.round_number,
    'round_open', scope.round_open, 'speaker_ids', scope.speaker_ids,
    'messages', opinions
  );
end;
$$;

create function public.story_peer_opinions(p_room uuid, p_after bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.peer_opinions(p_room, p_after);
$$;
revoke all on function private.peer_opinions(uuid,bigint),
  public.story_peer_opinions(uuid,bigint) from public, anon, authenticated, service_role;
grant execute on function private.peer_opinions(uuid,bigint),
  public.story_peer_opinions(uuid,bigint) to authenticated;
