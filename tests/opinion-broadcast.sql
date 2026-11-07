begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

do $$
declare
  host uuid := gen_random_uuid(); student uuid := gen_random_uuid();
  rid uuid; member_id uuid; message_id bigint; row jsonb; hint jsonb;
  request jsonb; hint_count integer; scope_count integer; final_revision bigint;
begin
  insert into auth.users(id) values(host),(student);
  insert into public.profiles(id,email,status) values(host,'broadcast@example.invalid','approved');
  insert into public.rooms(owner_id,title,topic,kind,state)
    values(host,'가상 알림 검증','가상 주제','discussion','active') returning id into rid;
  insert into public.members(room_id,user_id,nickname,state)
    values(rid,student,'가상 참여자','approved') returning id into member_id;
  request := jsonb_build_object('room_id',rid,'content','실제 본문은 알림에 없어야 함','expected_round',1,'client_id',gen_random_uuid());
  row := public.story_mutate(student,false,'message',request);
  message_id := (row->>'id')::bigint;
  select payload into hint from realtime.messages where topic='story-room:'||rid::text||':opinions' and event='opinion_changed';
  if hint is distinct from jsonb_build_object('room_id',rid,'message_id',message_id,'operation','INSERT','round_number',1,'messages_epoch',0) then
    raise exception 'visible opinion hint has incorrect fields or exposes content';
  end if;
  if exists(select 1 from realtime.messages where not private) then raise exception 'public broadcast emitted'; end if;
  perform public.story_mutate(student,false,'message',request);
  if (select count(*) from realtime.messages where topic='story-room:'||rid::text||':opinions') <> 1 then
    raise exception 'idempotent retry emitted duplicate hints';
  end if;
  insert into public.messages(room_id,role,nickname,content,visibility,round_number)
    values(rid,'member','보류','검사를 통과하지 못한 내용','held',1),
          (rid,'host','교사','교사 발언','visible',1);
  if (select count(*) from realtime.messages where topic='story-room:'||rid::text||':opinions') <> 1 then
    raise exception 'held or non-member insert emitted a public-opinion hint';
  end if;
  perform public.story_mutate(host,false,'message_visibility',jsonb_build_object('room_id',rid,'message_id',message_id,'visibility','hidden'));
  if not exists(select 1 from realtime.messages where payload->>'operation'='UPDATE' and (payload->>'message_id')::bigint=message_id) then
    raise exception 'hidden opinion did not invalidate pending hints';
  end if;
  set constraints broadcast_teacher_opinion_scope immediate;
  if not exists(select 1 from realtime.messages where event='room_changed' and payload @> jsonb_build_object('room_id',rid,'messages_epoch',1)) then
    raise exception 'cache epoch change did not invalidate hints';
  end if;
  if exists(select 1 from realtime.messages where event='room_changed' and (payload->>'revision')::bigint<>(select revision from public.rooms where id=rid)) then
    raise exception 'scope hint has an intermediate mutation revision';
  end if;
  set constraints broadcast_teacher_opinion_scope deferred;
  select count(*) into hint_count from realtime.messages;
  perform public.story_mutate(host,false,'heartbeat',jsonb_build_object('room_id',rid));
  if (select count(*) from realtime.messages) <> hint_count then raise exception 'heartbeat emitted unnecessary hint'; end if;
  perform public.story_mutate(host,false,'next_round',jsonb_build_object('room_id',rid,'expected_round',1));
  set constraints broadcast_teacher_opinion_scope immediate;
  if not exists(select 1 from realtime.messages where event='room_changed' and payload @> jsonb_build_object('room_id',rid,'round_number',2)) then
    raise exception 'round transition did not invalidate hints';
  end if;
  set constraints broadcast_teacher_opinion_scope deferred;
  select count(*) into scope_count from realtime.messages where event='room_changed';
  update public.rooms set round_open=false where id=rid;
  update public.rooms set revision=revision+1 where id=rid;
  update public.rooms set round_open=true,revision=revision+1 where id=rid returning revision into final_revision;
  if (select count(*) from realtime.messages where event='room_changed')<>scope_count then
    raise exception 'scope hints were sent before the transaction finished';
  end if;
  set constraints broadcast_teacher_opinion_scope immediate;
  if (select count(*) from realtime.messages where event='room_changed' and payload @> jsonb_build_object('room_id',rid,'round_number',2,'round_open',true,'revision',final_revision))<>2 then
    raise exception 'repeated scope writes did not publish the final committed revision';
  end if;
  -- A hint is transactional: aborted writes cannot send identifiers of rows
  -- which never became visible in the database.
  select count(*) into hint_count from realtime.messages;
  begin
    insert into public.messages(room_id,role,nickname,content,visibility,round_number)
      values(rid,'member','취소','취소한 의견','visible',2);
    raise exception 'rollback_probe';
  exception when others then if sqlerrm <> 'rollback_probe' then raise; end if;
  end;
  if (select count(*) from realtime.messages) <> hint_count then raise exception 'aborted write left broadcast hint'; end if;
end;
$$;
rollback;
