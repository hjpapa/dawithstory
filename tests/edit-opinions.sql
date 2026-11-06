begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
 host uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid();
 rid uuid; student_id uuid; peer_id uuid; speech_id bigint; peer_speech_id bigint; submission jsonb; edit jsonb;
 first_edit uuid:=gen_random_uuid(); next_edit uuid:=gen_random_uuid(); last_edit uuid:=gen_random_uuid(); job jsonb; row jsonb;
 summary_result jsonb:='{"overview":"가상 요약","reply":"대화에는 게시하지 않을 답변","opinions":[],"agreements":[],"differences":[],"questions":[],"praise":[]}';
begin
 insert into auth.users(id,email,is_anonymous) values(host,'edit-host@example.invalid',false),(student,null,true),(peer,null,true);
 insert into public.profiles(id,email,status) values(host,'edit-host@example.invalid','approved');
 insert into public.rooms(owner_id,title,topic,kind,state,is_demo) values(host,'의견 수정','가상 의견','debate','active',true) returning id into rid;
 insert into public.members(room_id,user_id,nickname,state) values(rid,student,'첫 참여자','approved') returning id into student_id;
 insert into public.members(room_id,user_id,nickname,state,can_ask_ai) values(rid,peer,'두 번째 참여자','approved',true) returning id into peer_id;

 submission:=jsonb_build_object('room_id',rid,'content','처음 낸 의견','stance','for','expected_round',1,'client_id',gen_random_uuid());
 row:=public.story_mutate(student,false,'message',submission);
 speech_id:=(row->>'id')::bigint;
 row:=public.story_mutate(peer,false,'message',submission||jsonb_build_object('content','다른 학생의 의견','client_id',gen_random_uuid()));
 peer_speech_id:=(row->>'id')::bigint;
 update public.messages set created_at=now()-interval '1 minute' where room_id=rid;
 perform public.story_tick();
 if exists(select 1 from public.ai_jobs where room_id=rid) then raise exception 'speech or cron queued an automatic summary'; end if;
 begin
  perform public.story_mutate(peer,false,'request_summary',jsonb_build_object('room_id',rid));
  raise exception 'TEST participant with AI permission could queue a summary';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;

 perform public.story_mutate(host,false,'request_summary',jsonb_build_object('room_id',rid));
 perform public.story_mutate(host,false,'request_summary',jsonb_build_object('room_id',rid));
 if (select count(*) from public.ai_jobs where room_id=rid and kind='summary')<>1 then raise exception 'duplicated pending summary'; end if;
 job:=public.story_claim_job();
 if job->>'kind'<>'summary' or (job->>'through_message_id')::bigint<>peer_speech_id then raise exception 'manual summary claim did not include both opinions'; end if;
 if not public.story_finish_job((job->>'id')::uuid,summary_result,1,1,(job->>'attempts')::integer) then raise exception 'manual summary did not publish'; end if;
 if exists(select 1 from public.messages where room_id=rid and role='ai') then raise exception 'manual summary generated a chat reply'; end if;
 insert into public.praise(room_id,member_id,message_id,category,reason,status,source)
 values(rid,student_id,speech_id,'reason','가상 이유','awarded','host'),
       (rid,peer_id,peer_speech_id,'reason','가상 이유','awarded','ai');
 perform public.story_mutate(host,false,'request_summary',jsonb_build_object('room_id',rid));
 job:=public.story_claim_job();

 edit:=jsonb_build_object('room_id',rid,'message_id',speech_id,'expected_round',1,'expected_edit_id',null,'client_id',first_edit,'content','바꾼 의견','stance','against','visibility','held','safety_reason','가상 보류 사유');
 begin
  perform public.story_mutate(peer,false,'edit_message',edit);
  raise exception 'TEST participant could edit someone else''s opinion';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 row:=public.story_mutate(student,false,'edit_message',edit);
 if (row->>'id')::bigint<>speech_id or row->>'client_id'<>submission->>'client_id' or row->>'edit_client_id'<>first_edit::text
    or row->>'stance'<>'against' or row->>'visibility'<>'held' or row->>'edited_at' is null then
  raise exception 'edit did not preserve the message identity or store the checked opinion';
 end if;
 if public.story_mutate(student,false,'edit_message',edit)<>row or public.story_mutate(student,false,'message',submission)<>row then
  raise exception 'edit or original submission retry changed the opinion';
 end if;
 if (select messages_epoch from public.rooms where id=rid)<>1 then raise exception 'edit did not bump cache epoch exactly once'; end if;
 if (select count(*) from public.messages where room_id=rid and member_id=student_id)<>1 then raise exception 'edit stored a second opinion'; end if;
 if exists(select 1 from public.summaries where room_id=rid) then raise exception 'stale summary remained after edit'; end if;
 if public.story_finish_job((job->>'id')::uuid,summary_result,1,1,(job->>'attempts')::integer) then raise exception 'stale in-flight summary published after edit'; end if;
 if not exists(select 1 from public.praise where message_id=speech_id and status='revoked')
    or not exists(select 1 from public.praise where message_id=peer_speech_id and status='awarded') then raise exception 'edit invalidated unrelated praise or kept stale praise'; end if;

 edit:=edit||jsonb_build_object('expected_edit_id',first_edit,'client_id',next_edit,'content','보류 후 고친 의견','visibility','visible','safety_reason',null);
 row:=public.story_mutate(host,false,'round_control',jsonb_build_object('room_id',rid,'expected_round',1,'open',false));
 if not (row @> jsonb_build_object('ok',true,'room_id',rid,'room',jsonb_build_object('round_open',false)))
    or row->'room' is distinct from (select to_jsonb(rooms.*) from public.rooms where id=rid) then
  raise exception 'round lock did not return the committed room';
 end if;
 begin
  perform public.story_mutate(student,false,'edit_message',edit);
  raise exception 'TEST edit allowed in closed round';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 perform public.story_mutate(host,false,'round_control',jsonb_build_object('room_id',rid,'expected_round',1,'open',true));
 row:=public.story_mutate(student,false,'edit_message',edit);
 if row->>'visibility'<>'visible' or row->>'safety_reason' is not null then raise exception 'held opinion could not be safely corrected'; end if;
 update public.praise set status='awarded' where message_id=speech_id;
 edit:=edit||jsonb_build_object('expected_edit_id',next_edit,'client_id',last_edit,'content','공개 의견의 오타 수정');
 perform public.story_mutate(student,false,'edit_message',edit);
 if not exists(select 1 from public.praise where message_id=speech_id and status='awarded') then
  raise exception 'visible correction removed previously awarded praise';
 end if;
 begin
  perform public.story_mutate(student,false,'edit_message',edit||jsonb_build_object('client_id',first_edit,'expected_edit_id',null));
  raise exception 'TEST stale edit overwrote a newer opinion';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 row:=public.story_mutate(host,false,'next_round',jsonb_build_object('room_id',rid,'expected_round',1,'prompt','가상 질문'));
 if not (row @> '{"room":{"round_number":2,"round_open":true,"round_prompt":"가상 질문","speaker_ids":null}}'::jsonb)
    or row->'room' is distinct from (select to_jsonb(rooms.*) from public.rooms where id=rid) then
  raise exception 'next round did not return the committed room';
 end if;
 begin
  perform public.story_mutate(student,false,'edit_message',edit||jsonb_build_object('client_id',gen_random_uuid(),'expected_edit_id',last_edit,'expected_round',2));
  raise exception 'TEST previous-round opinion could be changed';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 perform public.story_mutate(host,false,'message_visibility',jsonb_build_object('room_id',rid,'message_id',speech_id,'visibility','hidden'));
 begin
  perform public.story_mutate(student,false,'edit_message',edit);
  raise exception 'TEST student could edit a hidden opinion';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 row:=public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',2,'member_ids',jsonb_build_array(student_id)));
 if row #> '{room,speaker_ids}' is distinct from jsonb_build_array(student_id)
    or row->'room' is distinct from (select to_jsonb(rooms.*) from public.rooms where id=rid) then
  raise exception 'presentation start did not return the committed room';
 end if;
 row:=public.story_mutate(host,false,'room_state',jsonb_build_object('room_id',rid,'state','ended'));
 if row #>> '{room,state}' is distinct from 'ended' or row #>> '{room,ended_at}' is null
    or row->'room' is distinct from (select to_jsonb(rooms.*) from public.rooms where id=rid) then
  raise exception 'room end did not return the committed room';
 end if;
 if public.story_mutate(host,false,'room_state',jsonb_build_object('room_id',rid,'state','ended')) is distinct from row then
  raise exception 'repeated room end changed the stored state or acknowledgement';
 end if;
end $$;
rollback;
