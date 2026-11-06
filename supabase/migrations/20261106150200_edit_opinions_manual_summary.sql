alter table public.messages add column edit_client_id uuid;
alter table public.messages add column edited_at timestamptz;

-- Keep historical jobs and usage while retiring background summaries.
alter table public.ai_jobs drop constraint ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check check(kind in ('auto','request','summary','final'));
create unique index one_pending_manual_summary on public.ai_jobs(room_id) where kind='summary' and status in ('queued','running');

create function private.invalidate_discussion_outputs(p_room uuid) returns void
language plpgsql set search_path='' as $$
begin
 -- Older replies can paraphrase edited or hidden text without a citation.
 update public.messages set visibility='hidden' where room_id=p_room and role='ai' and visibility<>'hidden';
 delete from public.summaries where room_id=p_room;
 update public.rooms set summary_cursor=0,ai_error=null where id=p_room;
 update public.ai_jobs set status='cancelled',leased_until=null where room_id=p_room and status in ('queued','running');
end $$;
revoke all on function private.invalidate_discussion_outputs(uuid) from public,anon,authenticated;

create or replace function public.story_tick() returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and current_user not in ('postgres','supabase_admin') then raise exception 'Forbidden'; end if;
 update public.rooms set state='paused',revision=revision+1 where state='active' and host_seen_at<now()-interval '60 seconds';
 update public.ai_jobs j set status='cancelled' from public.rooms r where r.id=j.room_id and ((j.kind='final' and r.state<>'ended') or (j.kind<>'final' and r.state<>'active')) and j.status in ('queued','running');
 update public.ai_jobs set status='failed',error='AI 정리가 지연되어 중단됐어요. 다시 정리를 눌러 주세요.',leased_until=null where status='running' and leased_until<now() and kind in ('summary','final') and attempts>=4;
 update public.ai_jobs set status='queued',leased_until=null,available_at=now()+interval '10 seconds' where status='running' and leased_until<now();
end $$;
create or replace function public.story_mutate(p_actor uuid,p_admin boolean,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; m public.members; target public.members; msg public.messages; outval jsonb; ishost boolean; st text; chosen uuid[];
 edit_id uuid; new_visibility text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 if not p_admin and p_actor is null then raise exception '로그인이 필요해요.'; end if;
 if p_action='create_room' then
  if not exists(select 1 from public.profiles where id=p_actor and status='approved') then raise exception '운영자 승인을 기다려 주세요.'; end if;
  insert into public.rooms(owner_id,title,topic,kind) values(p_actor,trim(p->>'title'),trim(p->>'topic'),p->>'kind') returning to_jsonb(rooms.*) into outval;
  return outval;
 end if;
 if p_action='join' then
  select * into r from public.rooms where code=upper(trim(p->>'code')) for update;
 else
  select * into r from public.rooms where id=(p->>'room_id')::uuid for update;
 end if;
 if r.id is null then raise exception '대화방을 찾을 수 없어요.'; end if;
 ishost := p_admin or (r.owner_id=p_actor and exists(select 1 from public.profiles where id=p_actor and status='approved'));
 select * into m from public.members where room_id=r.id and user_id=p_actor;
 if r.state='active' and r.host_seen_at < now()-interval '60 seconds' then
  update public.rooms set state='paused',revision=revision+1 where id=r.id;
  r.state:='paused';
 end if;
 if p_action='join' then
  if m.state in ('kicked','rejected') then raise exception '진행자가 입장을 제한했어요.'; end if;
  if r.state<>'active' then raise exception '진행자가 대화방을 열면 참여할 수 있어요.'; end if;
  if m.id is not null then return to_jsonb(m); end if;
  if exists(select 1 from public.members where room_id=r.id and nickname=trim(p->>'nickname')) then raise exception '이미 사용 중인 별명이에요.'; end if;
  insert into public.members(room_id,user_id,nickname,avatar) values(r.id,p_actor,trim(p->>'nickname'),p->>'avatar') returning to_jsonb(members.*) into outval;
 elsif p_action='heartbeat' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.rooms set host_seen_at=now() where id=r.id;
  return jsonb_build_object('state',r.state);
 elsif p_action='room_state' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  st:=p->>'state';
  if r.state='ended' then
   if st='ended' then return jsonb_build_object('ok',true,'room_id',r.id,'room',to_jsonb(r)); end if;
   raise exception '종료한 방은 다시 열 수 없어요.';
  end if;
  if st not in ('active','paused','ended') then raise exception '잘못된 상태예요.'; end if;
  update public.rooms set state=st,host_seen_at=now(),ended_at=case when st='ended' then now() else ended_at end where id=r.id;
  if st<>'active' then update public.ai_jobs set status='cancelled' where room_id=r.id and status in ('queued','running'); end if;
 elsif p_action in ('request_summary','review_retry') then
  if p_actor is distinct from r.owner_id or not exists(select 1 from public.profiles where id=p_actor and status='approved') then
   raise exception '대화방을 만든 진행자만 AI 요약을 요청할 수 있어요.';
  end if;
  if (p_action='request_summary' and r.state<>'active') or (p_action='review_retry' and r.state<>'ended') then
   raise exception '지금은 AI 요약을 요청할 수 없는 상태예요.';
  end if;
  if not r.is_demo and (select value from private.settings where key='ai_live_enabled') is distinct from 'true' then raise exception 'AI가 중지되어 있어요.'; end if;
  if p_action='review_retry' and exists(select 1 from public.summaries where room_id=r.id and is_final) then return jsonb_build_object('ok',true); end if;
  if not exists(select 1 from public.messages where room_id=r.id and role in ('host','member') and visibility='visible') then
   raise exception '공개된 의견이 있어야 AI로 요약할 수 있어요.';
  end if;
  insert into public.ai_jobs(room_id,kind,requested_by,request_id)
   values(r.id,case when p_action='review_retry' then 'final' else 'summary' end,p_actor,coalesce((p->>'client_id')::uuid,gen_random_uuid()))
   on conflict do nothing;
  update public.rooms set ai_error=null where id=r.id;
 elsif p_action in ('round_control','next_round','presentation_start') then
  if not ishost then raise exception '진행자만 차례를 바꿀 수 있어요.'; end if;
  if r.state<>'active' then raise exception '대화방을 먼저 열어 주세요.'; end if;
  if (p->>'expected_round')::integer is distinct from r.round_number then raise exception '차례가 바뀌었어요. 새로 확인해 주세요.'; end if;
  if p_action='presentation_start' then
   if jsonb_typeof(p->'member_ids') is distinct from 'array' then raise exception '발표할 참여자를 선택해 주세요.'; end if;
   select array_agg(distinct value::uuid) into chosen from jsonb_array_elements_text(p->'member_ids');
   if chosen is null or cardinality(chosen) not between 1 and 30 or array_position(chosen,null) is not null then raise exception '발표할 참여자를 1명 이상 선택해 주세요.'; end if;
   if (select count(*) from public.members where room_id=r.id and id=any(chosen) and state='approved' and not muted)<>cardinality(chosen) then raise exception '현재 발언 가능한 참여자만 선택할 수 있어요.'; end if;
   update public.rooms set round_number=round_number+1,round_open=true,speaker_ids=chosen,round_prompt='' where id=r.id;
  elsif p_action='next_round' then
   update public.rooms set round_number=round_number+1,round_open=true,speaker_ids=null,round_prompt=coalesce(trim(p->>'prompt'),'') where id=r.id;
  else
   if jsonb_typeof(p->'open') is distinct from 'boolean' then raise exception '발언 상태를 확인해 주세요.'; end if;
   update public.rooms set round_open=(p->>'open')::boolean where id=r.id;
  end if;
 elsif p_action='room_settings' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.rooms set ai_mode=coalesce(p->>'ai_mode',ai_mode) where id=r.id;
 elsif p_action='rotate_code' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.rooms set code=upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,8)) where id=r.id;
 elsif p_action='member' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  select * into target from public.members where id=(p->>'member_id')::uuid and room_id=r.id;
  if target.id is null then raise exception '참여자를 찾을 수 없어요.'; end if;
  if p->>'state'='approved' and target.state<>'approved' then
   if r.state<>'active' then raise exception '대화방을 먼저 열어 주세요.'; end if;
   if (select count(*) from public.members where room_id=r.id and state='approved')>=30 then raise exception '최대 30명까지 참여할 수 있어요.'; end if;
  end if;
  update public.members set state=coalesce(p->>'state',state),can_ask_ai=coalesce((p->>'can_ask_ai')::boolean,can_ask_ai),muted=coalesce((p->>'muted')::boolean,muted) where id=target.id;
 elsif p_action in ('message','ask_ai') then
  if r.state<>'active' then raise exception '현재 대화를 보낼 수 없는 상태예요.'; end if;
  if not ishost and (m.id is null or m.state<>'approved' or m.muted) then raise exception '발언 권한이 없어요.'; end if;
  if p_action='ask_ai' then
   if not ishost and not m.can_ask_ai then raise exception '진행자가 AI 요청 권한을 주면 사용할 수 있어요.'; end if;
   if (select value from private.settings where key='ai_live_enabled') is distinct from 'true' and not r.is_demo then raise exception 'AI 연결 준비 중이에요. 일반 대화는 계속할 수 있어요.'; end if;
   insert into public.ai_jobs(room_id,kind,requested_by,prompt,request_id) values(r.id,'request',p_actor,p->>'content',(p->>'client_id')::uuid) on conflict(room_id,request_id) do nothing;
  else
   -- A retry returns the original speech even if the host has advanced the round.
   select * into msg from public.messages where room_id=r.id and client_id=(p->>'client_id')::uuid;
   if msg.id is not null then
    if msg.user_id is distinct from p_actor then raise exception '이미 사용된 요청이에요.'; end if;
    return to_jsonb(msg);
   end if;
   if p ? 'expected_round' and (p->>'expected_round')::integer is distinct from r.round_number then raise exception '차례가 바뀌었어요. 내용을 확인하고 다시 보내 주세요.'; end if;
   if not ishost then
    if not r.round_open then raise exception '진행자가 발언을 열면 이야기할 수 있어요.'; end if;
    if r.speaker_ids is not null and not (m.id=any(r.speaker_ids)) then raise exception '지금은 선택된 참여자가 발표하는 시간이에요.'; end if;
    if exists(select 1 from public.messages where room_id=r.id and member_id=m.id and round_number=r.round_number) then raise exception '이번 차례에는 이미 발언했어요. 다음 차례를 기다려 주세요.'; end if;
   end if;
   insert into public.messages(room_id,user_id,member_id,role,nickname,avatar,content,stance,client_id,visibility,safety_reason,round_number)
    values(r.id,p_actor,case when ishost then null else m.id end,case when ishost then 'host' else 'member' end,case when ishost then '진행자' else m.nickname end,case when ishost then '🌷' else m.avatar end,p->>'content',p->>'stance',(p->>'client_id')::uuid,coalesce(p->>'visibility','visible'),p->>'safety_reason',r.round_number)
    on conflict(room_id,client_id) do nothing returning to_jsonb(messages.*) into outval;
  end if;
 elsif p_action='edit_message' then
  if ishost or m.id is null or m.state<>'approved' or m.muted then raise exception '본인이 작성한 의견만 수정할 수 있어요.'; end if;
  select * into msg from public.messages
   where id=(p->>'message_id')::bigint and room_id=r.id and role='member' and member_id=m.id and user_id=p_actor;
  if msg.id is null or msg.visibility='hidden' then raise exception '수정할 수 있는 의견을 찾을 수 없어요.'; end if;
  edit_id:=(p->>'client_id')::uuid;
  if edit_id is null then raise exception '수정 요청을 확인해 주세요.'; end if;
  if msg.edit_client_id=edit_id then return to_jsonb(msg); end if;
  if r.state<>'active' or not r.round_open then raise exception '지금은 의견을 수정할 수 없어요.'; end if;
  if (p->>'expected_round')::integer is distinct from r.round_number or msg.round_number is distinct from r.round_number then
   raise exception '이미 지난 장의 의견은 수정할 수 없어요.';
  end if;
  if r.speaker_ids is not null and not (m.id=any(r.speaker_ids)) then raise exception '지금은 선택된 참여자가 발표하는 시간이에요.'; end if;
  if msg.edit_client_id is distinct from (p->>'expected_edit_id')::uuid then
   raise exception '의견이 이미 수정됐어요. 최신 내용을 확인해 주세요.';
  end if;
  new_visibility:=coalesce(p->>'visibility','visible');
  if new_visibility not in ('visible','held') then raise exception '의견의 공개 상태를 확인해 주세요.'; end if;
  update public.messages
   set content=p->>'content',stance=p->>'stance',visibility=new_visibility,safety_reason=p->>'safety_reason',
       edit_client_id=edit_id,edited_at=clock_timestamp()
   where id=msg.id returning to_jsonb(messages.*) into outval;
  if (msg.content,msg.stance,msg.visibility) is distinct from (p->>'content',p->>'stance',new_visibility) then
   if msg.visibility='visible' or new_visibility='visible' then perform private.invalidate_discussion_outputs(r.id); end if;
   update public.praise set status=case when status='awarded' then 'revoked' else 'dismissed' end,revoked_at=now()
    where room_id=r.id and message_id=msg.id
      and (status='suggested' or (status='awarded' and new_visibility<>'visible'));
  end if;
  update public.rooms set messages_epoch=messages_epoch+1 where id=r.id;
 elsif p_action='message_visibility' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  select * into msg from public.messages where id=(p->>'message_id')::bigint and room_id=r.id;
  if msg.role='ai' and msg.visibility='hidden' and p->>'visibility'='visible' then raise exception '가려진 AI 답변은 다시 공개할 수 없어요. 새로 정리해 주세요.'; end if;
  update public.messages set visibility=p->>'visibility' where id=(p->>'message_id')::bigint and room_id=r.id;
  perform private.invalidate_discussion_outputs(r.id);
  update public.praise set status=case when status='awarded' then 'revoked' else 'dismissed' end,revoked_at=now() where room_id=r.id and source='ai';
  update public.rooms set messages_epoch=messages_epoch+1 where id=r.id;
  if p->>'visibility'<>'visible' then update public.praise set status='revoked',revoked_at=now() where room_id=r.id and message_id=(p->>'message_id')::bigint; end if;
 elsif p_action='praise' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  select * into msg from public.messages where id=(p->>'message_id')::bigint and room_id=r.id and member_id is not null;
  if msg.id is null then raise exception '참여자의 발언을 골라 주세요.'; end if;
  insert into public.praise(room_id,member_id,message_id,category,reason,status,awarded_at) values(r.id,msg.member_id,msg.id,p->>'category',p->>'reason','awarded',now())
   on conflict(room_id,message_id,category) do update set status='awarded',reason=excluded.reason,awarded_at=now(),revoked_at=null;
 elsif p_action='praise_status' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  if p->>'status' not in ('awarded','revoked','dismissed') then raise exception '잘못된 상태예요.'; end if;
  update public.praise set status=p->>'status',awarded_at=case when p->>'status'='awarded' then now() else awarded_at end,revoked_at=case when p->>'status'='revoked' then now() else null end where id=(p->>'praise_id')::uuid and room_id=r.id;
 elsif p_action='report' then
  if not ishost and (m.id is null or m.state<>'approved' or r.state='ended') then raise exception '접근할 수 없어요.'; end if;
  if not exists(select 1 from public.messages where id=(p->>'message_id')::bigint and room_id=r.id and visibility='visible') then raise exception '발언을 찾을 수 없어요.'; end if;
  insert into public.reports(room_id,message_id,reporter_id,reason) values(r.id,(p->>'message_id')::bigint,p_actor,p->>'reason') on conflict(message_id,reporter_id) do nothing;
 elsif p_action='resolve_report' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.reports set resolved=true where id=(p->>'report_id')::uuid and room_id=r.id;
 elsif p_action='delete_room' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  delete from public.rooms where id=r.id;
  return jsonb_build_object('deleted',true);
 else raise exception '지원하지 않는 요청이에요.';
 end if;
 update public.rooms set revision=revision+1 where id=r.id returning * into r;
 if p_action in ('room_state','round_control','next_round','presentation_start') then
  return jsonb_build_object('ok',true,'room_id',r.id,'room',to_jsonb(r));
 end if;
 return coalesce(outval,jsonb_build_object('ok',true,'room_id',r.id));
end $$;

create or replace function public.story_claim_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; r public.rooms; latest_message_id bigint;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 perform public.story_tick();
 -- Lock a runnable room first; a busy room never blocks another room's queue.
 for r in select room.* from public.rooms room
 where ((room.state='active' and room.host_seen_at>=now()-interval '60 seconds') or room.state='ended')
 and (room.is_demo or (select value from private.settings where key='ai_live_enabled')='true')
 and not exists(select 1 from public.ai_jobs b where b.room_id=room.id and b.status='running')
 and exists(select 1 from public.ai_jobs q where q.room_id=room.id and q.status='queued' and q.available_at<=now())
 order by (select min(created_at) from public.ai_jobs q where q.room_id=room.id and q.status='queued' and q.available_at<=now())
 for update of room skip locked loop
  for j in select * from public.ai_jobs where room_id=r.id and status='queued' and available_at<=now() order by created_at for update skip locked loop
   if j.kind='auto' or (j.kind='final' and r.state<>'ended') or (j.kind<>'final' and r.state<>'active') or (j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted)) then
    update public.ai_jobs set status='cancelled' where id=j.id;
    continue;
   end if;
   select coalesce(max(id),0) into latest_message_id from public.messages
    where room_id=r.id and visibility='visible' and role in ('host','member');
   update public.ai_jobs
    set status='running',attempts=attempts+1,leased_until=now()+interval '120 seconds',
        after_message_id=case when j.kind='request' then latest_message_id else 0 end,
        through_message_id=latest_message_id
    where id=j.id returning * into j;
   return to_jsonb(j);
  end loop;
 end loop;
 return null;
end $$;
create or replace function public.story_finish_job(p_id uuid,p_result jsonb,p_input integer,p_output integer,p_attempt integer) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; r public.rooms; rec jsonb; mid bigint; mem uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 -- Serialize disable with completion, then keep room-before-job lock order.
 perform 1 from private.settings where key='ai_live_enabled' for share;
 select * into r from public.rooms where id=(select room_id from public.ai_jobs where id=p_id) for update;
 select * into j from public.ai_jobs where id=p_id for update;
 -- Account for the provider response even when publication was cancelled or the lease expired.
 perform public.story_record_usage(p_id,p_attempt,p_input,p_output);
 if j.id is null or j.status<>'running' or j.attempts is distinct from p_attempt then return false; end if;
 if (not r.is_demo and (select value from private.settings where key='ai_live_enabled') is distinct from 'true') or j.kind='auto' or (j.kind='final' and r.state<>'ended') or (j.kind<>'final' and (r.state<>'active' or r.host_seen_at<now()-interval '60 seconds')) or (j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted)) then
  update public.ai_jobs set status='cancelled' where id=j.id; return false;
 end if;
 if j.kind in ('summary','final') then
  insert into public.summaries(room_id,job_id,content,through_message_id,is_final) values(r.id,j.id,p_result-'praise',j.through_message_id,j.kind='final') on conflict(job_id) do nothing;
 end if;
 if j.kind='request' and coalesce(p_result->>'reply','')<>'' then
  insert into public.messages(room_id,role,nickname,avatar,content,client_id) values(r.id,'ai','이야기별','⭐',left(p_result->>'reply',2000),j.id) on conflict(room_id,client_id) do nothing;
 end if;
 for rec in select value from jsonb_array_elements(case when j.kind='final' then '[]'::jsonb else coalesce(p_result->'praise','[]'::jsonb) end) loop
  begin
   mid:=(rec->>'message_id')::bigint;
   select member_id into mem from public.messages where id=mid and room_id=r.id and member_id is not null and visibility='visible';
   if mem is not null and rec->>'category' in ('reason','listening','question','kindness') then
    insert into public.praise(room_id,member_id,message_id,category,reason,source) values(r.id,mem,mid,rec->>'category',left(rec->>'reason',200),'ai') on conflict do nothing;
   end if;
  exception when invalid_text_representation then null;
  end;
 end loop;
 update public.ai_jobs set status='done',leased_until=null,error=null where id=j.id;
 update public.rooms
  set summary_cursor=case when j.kind in ('summary','final') then j.through_message_id else summary_cursor end,
      ai_error=null,revision=revision+1 where id=r.id;
 return true;
end $$;

update public.ai_jobs set status='cancelled',leased_until=null where kind='auto' and status in ('queued','running');
