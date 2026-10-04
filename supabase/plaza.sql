-- Additive migration: existing messages remain in each character's history.
begin;
alter table public.rooms add column round_number integer not null default 1 check(round_number > 0);
alter table public.rooms add column round_open boolean not null default true;
alter table public.rooms add column round_prompt text not null default '' check(char_length(round_prompt) <= 500);
alter table public.messages add column round_number integer check(round_number > 0);
create unique index one_member_speech_per_round on public.messages(room_id,member_id,round_number) where role='member' and round_number is not null;
create or replace function public.story_mutate(p_actor uuid,p_admin boolean,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; m public.members; target public.members; msg public.messages; pr public.praise; outval jsonb; ishost boolean; rid uuid; st text; uid uuid;
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
  if r.state='ended' then raise exception '종료한 방은 다시 열 수 없어요.'; end if;
  if st not in ('active','paused','ended') then raise exception '잘못된 상태예요.'; end if;
  update public.rooms set state=st,host_seen_at=now(),ended_at=case when st='ended' then now() else ended_at end where id=r.id;
  if st<>'active' then update public.ai_jobs set status='cancelled' where room_id=r.id and status in ('queued','running'); end if;
 elsif p_action in ('round_control','next_round') then
  if not ishost then raise exception '진행자만 차례를 바꿀 수 있어요.'; end if;
  if r.state<>'active' then raise exception '대화방을 먼저 열어 주세요.'; end if;
  if (p->>'expected_round')::integer is distinct from r.round_number then raise exception '차례가 바뀌었어요. 새로 확인해 주세요.'; end if;
  if p_action='next_round' then
   update public.rooms set round_number=round_number+1,round_open=true,round_prompt=coalesce(trim(p->>'prompt'),'') where id=r.id;
  else
   if jsonb_typeof(p->'open') is distinct from 'boolean' then raise exception '발언 상태를 확인해 주세요.'; end if;
   update public.rooms set round_open=(p->>'open')::boolean where id=r.id;
  end if;
 elsif p_action='room_settings' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.rooms set ai_mode=coalesce(p->>'ai_mode',ai_mode) where id=r.id;
  if p->>'ai_mode'='off' then update public.ai_jobs set status='cancelled' where room_id=r.id and kind='auto' and status in ('queued','running'); end if;
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
    if exists(select 1 from public.messages where room_id=r.id and member_id=m.id and round_number=r.round_number) then raise exception '이번 차례에는 이미 발언했어요. 다음 차례를 기다려 주세요.'; end if;
   end if;
   insert into public.messages(room_id,user_id,member_id,role,nickname,avatar,content,stance,client_id,visibility,safety_reason,round_number)
    values(r.id,p_actor,case when ishost then null else m.id end,case when ishost then 'host' else 'member' end,case when ishost then '진행자' else m.nickname end,case when ishost then '🌷' else m.avatar end,p->>'content',p->>'stance',(p->>'client_id')::uuid,coalesce(p->>'visibility','visible'),p->>'safety_reason',r.round_number)
    on conflict(room_id,client_id) do nothing returning to_jsonb(messages.*) into outval;
  end if;
 elsif p_action='message_visibility' then
  if not ishost then raise exception '진행자만 할 수 있어요.'; end if;
  update public.messages set visibility=p->>'visibility' where id=(p->>'message_id')::bigint and room_id=r.id;
  delete from public.summaries where room_id=r.id;
  update public.rooms set summary_cursor=0 where id=r.id;
  update public.ai_jobs set status='cancelled' where room_id=r.id and status in ('queued','running');
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
 update public.rooms set revision=revision+1 where id=r.id;
 return coalesce(outval,jsonb_build_object('ok',true,'room_id',r.id));
end $$;
commit;
