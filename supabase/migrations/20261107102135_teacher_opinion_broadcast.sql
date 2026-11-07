-- Broadcast only identifiers. The receiving teacher must fetch each opinion
-- through the existing message RLS before showing its content. Channel policies
-- are cached by Realtime, so a broadcast must never carry private student text.
create policy teacher_opinion_hints on realtime.messages
for select to authenticated using (
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and exists (
    select 1 from public.rooms r
    where 'story-room:' || r.id::text || ':opinions' = (select realtime.topic())
      and private.is_host(r.id)
  )
);
-- No INSERT policy: browsers cannot publish authoritative hints on this channel.

create or replace function private.broadcast_opinion_hint()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  m public.messages;
  r public.rooms;
begin
  if tg_op = 'DELETE' then m := old; else m := new; end if;
  if m.role <> 'member' then return null; end if;
  if tg_op = 'INSERT' and new.visibility <> 'visible' then return null; end if;
  if tg_op = 'UPDATE' and old.visibility <> 'visible' and new.visibility <> 'visible' then return null; end if;
  if tg_op = 'DELETE' and old.visibility <> 'visible' then return null; end if;
  select * into r from public.rooms where id = m.room_id;
  if not found then return null; end if;
  perform realtime.send(
    jsonb_build_object(
      'room_id', m.room_id,
      'message_id', m.id,
      'operation', tg_op,
      'round_number', m.round_number,
      'messages_epoch', r.messages_epoch
    ),
    'opinion_changed',
    'story-room:' || m.room_id::text || ':opinions',
    true
  );
  return null;
exception when others then
  -- Delivery is best effort. The saved opinion and normal snapshot/changes path
  -- must remain available if the Realtime service cannot accept a hint.
  return null;
end;
$$;
revoke all on function private.broadcast_opinion_hint() from public, anon, authenticated;

create trigger broadcast_teacher_opinion
after insert or update or delete on public.messages
for each row execute function private.broadcast_opinion_hint();

create or replace function private.broadcast_opinion_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare r public.rooms;
begin
  -- story_mutate can change scope and then increment revision in a later UPDATE.
  -- Read the final row at commit so a delayed old Postgres Changes event cannot
  -- overwrite this hint with the same revision and an obsolete scope.
  select * into r from public.rooms where id = new.id;
  if not found then return null; end if;
  perform realtime.send(
    jsonb_build_object(
      'room_id', r.id,
      'messages_epoch', r.messages_epoch,
      'round_number', r.round_number,
      'state', r.state,
      'round_open', r.round_open,
      'revision', r.revision
    ),
    'room_changed',
    'story-room:' || new.id::text || ':opinions',
    true
  );
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.broadcast_opinion_scope() from public, anon, authenticated;

create constraint trigger broadcast_teacher_opinion_scope
after update on public.rooms
deferrable initially deferred
for each row when (
  old.state is distinct from new.state
  or old.round_number is distinct from new.round_number
  or old.round_open is distinct from new.round_open
  or old.messages_epoch is distinct from new.messages_epoch
)
execute function private.broadcast_opinion_scope();
