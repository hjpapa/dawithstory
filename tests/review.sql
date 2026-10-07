-- Run within a transaction and roll back; no production records are retained.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare h uuid:=gen_random_uuid(); guest uuid:=gen_random_uuid(); r uuid; j jsonb; mid bigint; result jsonb:='{"overview":"가상 최종 요약","reply":"게시하지 않을 답변","opinions":[],"agreements":[],"differences":[],"questions":[],"praise":[]}';
begin
 insert into auth.users(id,email,is_anonymous) values(h,'review@example.invalid',false),(guest,null,true);
 insert into public.profiles(id,email,status) values(h,'review@example.invalid','approved');
 insert into public.rooms(owner_id,title,topic,kind,state,is_demo,ai_mode) values(h,'가상 회고 검증','가상의 의견','discussion','active',true,'off') returning id into r;
 insert into public.members(room_id,user_id,nickname,avatar,state) values(r,guest,'가상 참여자','🐰','approved');
 insert into public.messages(room_id,role,nickname,content) values(r,'host','진행자','마지막 공개 발언') returning id into mid;
 begin
  perform public.story_mutate(guest,false,'room_state',jsonb_build_object('room_id',r,'state','ended'));
  raise exception 'TEST participant ended room';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 perform public.story_mutate(h,false,'room_state',jsonb_build_object('room_id',r,'state','ended'));
 perform public.story_mutate(h,false,'room_state',jsonb_build_object('room_id',r,'state','ended'));
 if (select count(*) from public.ai_jobs where room_id=r and kind='final')<>1 then raise exception 'duplicate final job'; end if;
 update public.ai_jobs set created_at='1800-01-01' where room_id=r;
 update public.rooms set host_seen_at='1800-01-01' where id=r;
 j:=public.story_claim_job();
 if (j->>'room_id')::uuid<>r or j->>'kind'<>'final' then raise exception 'final job not claimed after end'; end if;
 if not public.story_finish_job((j->>'id')::uuid,result,1,1,(j->>'attempts')::integer) then raise exception 'final completion failed'; end if;
 if not exists(select 1 from public.summaries where room_id=r and is_final and through_message_id=mid) then raise exception 'missing final summary'; end if;
 if exists(select 1 from public.messages where room_id=r and role='ai') then raise exception 'final generated chat message'; end if;
 begin
  perform public.story_mutate(h,false,'message',jsonb_build_object('room_id',r,'content','종료 후 발언','client_id',gen_random_uuid()));
  raise exception 'TEST post-end speech allowed';
 exception when others then if SQLERRM like 'TEST%' then raise; end if; end;
 insert into auth.sessions(id,user_id) values(guest,guest);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',guest,'session_id',guest)::text,true);
 if not private.can_read_review(r) then raise exception 'approved review access denied'; end if;
 update public.members set state='kicked' where room_id=r;
 if private.can_read_review(r) then raise exception 'kicked review access allowed'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.story_mutate(h,false,'message_visibility',jsonb_build_object('room_id',r,'message_id',mid,'visibility','hidden'));
 if exists(select 1 from public.summaries where room_id=r) then raise exception 'hidden final derivative remains'; end if;
 perform public.story_mutate(h,false,'review_retry',jsonb_build_object('room_id',r));
 update public.ai_jobs set created_at='1800-01-01' where room_id=r and status='queued';
 j:=public.story_claim_job();
 perform public.story_set_config('{"ai_live_enabled":"false"}');
 if public.story_finish_job((j->>'id')::uuid,result,1,1,(j->>'attempts')::integer) then raise exception 'disabled final job published'; end if;
 raise notice 'PASS end idempotency, host-only end, final job after disconnect, latest speech cursor, no new chat, post-end speech denial, membership checks, hidden invalidation and global stop';
end $$;
