-- Dawith Story: private operations, read-only RLS clients, durable AI queue.
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null, status text not null default 'pending' check(status in ('pending','approved','suspended')),
 created_at timestamptz not null default now()
);
create table public.rooms (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 title text not null check(char_length(title) between 1 and 100), topic text not null check(char_length(topic) between 1 and 1000),
 kind text not null check(kind in ('discussion','debate','daily')),
 code text not null unique default upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,8)),
 state text not null default 'draft' check(state in ('draft','active','paused','ended')),
 ai_mode text not null default 'balanced' check(ai_mode in ('off','quiet','balanced','active')),
 is_demo boolean not null default false,
 round_number integer not null default 1 check(round_number > 0),
 round_open boolean not null default true,
 speaker_ids uuid[] check(speaker_ids is null or (cardinality(speaker_ids) between 1 and 30 and array_position(speaker_ids,null) is null)),
 round_prompt text not null default '' check(char_length(round_prompt) <= 500),
 host_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), ended_at timestamptz,
 summary_cursor bigint not null default 0, ai_error text, revision bigint not null default 0
);
create table public.members (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check(char_length(nickname) between 1 and 16), avatar text not null default '🐰',
 state text not null default 'waiting' check(state in ('waiting','approved','rejected','kicked')),
 can_ask_ai boolean not null default false, muted boolean not null default false,
 created_at timestamptz not null default now(), unique(room_id,user_id), unique(room_id,nickname)
);
create table public.messages (
 id bigint generated always as identity primary key, room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid, member_id uuid references public.members(id) on delete cascade,
 role text not null check(role in ('host','member','ai','system')), nickname text not null, avatar text not null default '⭐',
 content text not null check(char_length(content) between 1 and 2000), stance text check(stance in ('for','against','neutral')),
 visibility text not null default 'visible' check(visibility in ('visible','held','hidden')),
 safety_reason text, client_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(),
 round_number integer check(round_number > 0),
 unique(room_id,client_id)
);
create table public.summaries (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 job_id uuid not null unique, content jsonb not null, through_message_id bigint not null,
 created_at timestamptz not null default now()
);
create table public.praise (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 member_id uuid not null references public.members(id) on delete cascade,
 message_id bigint references public.messages(id) on delete cascade,
 category text not null check(category in ('reason','listening','question','kindness')),
 reason text not null check(char_length(reason) between 1 and 200),
 status text not null default 'suggested' check(status in ('suggested','awarded','revoked','dismissed')),
 points integer not null default 1 check(points = 1), source text not null default 'host' check(source in ('host','ai')),
 created_at timestamptz not null default now(), awarded_at timestamptz, revoked_at timestamptz,
 unique(room_id,message_id,category)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 message_id bigint not null references public.messages(id) on delete cascade, reporter_id uuid not null,
 reason text not null check(char_length(reason) between 1 and 300), resolved boolean not null default false,
 created_at timestamptz not null default now(), unique(message_id,reporter_id)
);
create table public.ai_jobs (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 kind text not null check(kind in ('auto','request')), requested_by uuid, prompt text,
 request_id uuid not null default gen_random_uuid(), status text not null default 'queued' check(status in ('queued','running','done','failed','cancelled')),
 attempts integer not null default 0, available_at timestamptz not null default now(), leased_until timestamptz,
 through_message_id bigint, error text, input_tokens integer not null default 0, output_tokens integer not null default 0,
 cost_usd numeric(12,8) not null default 0, created_at timestamptz not null default now(), unique(room_id,request_id)
);
create unique index one_pending_auto_job on public.ai_jobs(room_id) where kind='auto' and status in ('queued','running');
create index messages_room_order on public.messages(room_id,id);
create unique index one_member_speech_per_round on public.messages(room_id,member_id,round_number) where role='member' and round_number is not null;
create index members_user on public.members(user_id,room_id);
create index rooms_owner on public.rooms(owner_id);
create index praise_room on public.praise(room_id,member_id);
create index ai_jobs_due on public.ai_jobs(status,available_at);
create table private.settings (key text primary key, value text not null);
create table private.rate_limits (key text primary key, count integer not null, window_start timestamptz not null);

create function private.is_host(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rooms r join public.profiles p on p.id=r.owner_id where r.id=p_room and r.owner_id=auth.uid() and p.status='approved');
$$;
create function private.can_read_room(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_host(p_room) or exists(select 1 from public.members m join public.rooms r on r.id=m.room_id where m.room_id=p_room and m.user_id=auth.uid() and m.state='approved' and r.state<>'ended');
$$;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on function private.is_host(uuid),private.can_read_room(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.members enable row level security;
alter table public.messages enable row level security;
alter table public.summaries enable row level security;
alter table public.praise enable row level security;
alter table public.reports enable row level security;
alter table public.ai_jobs enable row level security;
create policy profile_self on public.profiles for select to authenticated using(id=auth.uid());
create policy room_access on public.rooms for select to authenticated using(private.can_read_room(id));
create policy member_access on public.members for select to authenticated using(user_id=auth.uid() or private.can_read_room(room_id));
create policy message_access on public.messages for select to authenticated using(private.is_host(room_id) or (private.can_read_room(room_id) and visibility='visible'));
create policy summary_access on public.summaries for select to authenticated using(private.can_read_room(room_id));
-- Praise totals and private AI/report details are only served by the API.
create policy praise_host on public.praise for select to authenticated using(private.is_host(room_id));
create policy reports_host on public.reports for select to authenticated using(private.is_host(room_id));
create policy jobs_host on public.ai_jobs for select to authenticated using(private.is_host(room_id));
revoke all on public.profiles,public.rooms,public.members,public.messages,public.summaries,public.praise,public.reports,public.ai_jobs from anon,authenticated;
grant select on public.profiles,public.rooms,public.members,public.messages,public.summaries,public.praise,public.reports,public.ai_jobs to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

create function public.story_config(p_secret text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 if p_secret is not null and not exists(select 1 from private.settings where key='backend_hash' and value=encode(extensions.digest(p_secret,'sha256'),'hex')) then raise exception 'Forbidden'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into result from private.settings;
 return result;
end $$;
create function public.story_set_config(p_values jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 insert into private.settings(key,value) select key,value from jsonb_each_text(p_values) on conflict(key) do update set value=excluded.value;
end $$;
create function public.story_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare c integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 insert into private.rate_limits(key,count,window_start) values(p_key,1,now()) on conflict(key) do update set
 count=case when private.rate_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else private.rate_limits.count+1 end,
 window_start=case when private.rate_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else private.rate_limits.window_start end returning count into c;
 return c<=p_limit;
end $$;

-- Every mutating room operation locks the room, including capacity checks and message writes.
create function public.story_mutate(p_actor uuid,p_admin boolean,p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; m public.members; target public.members; msg public.messages; pr public.praise; outval jsonb; ishost boolean; rid uuid; st text; uid uuid; chosen uuid[];
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
    if r.speaker_ids is not null and not (m.id=any(r.speaker_ids)) then raise exception '지금은 선택된 참여자가 발표하는 시간이에요.'; end if;
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

create function public.story_tick() returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and current_user not in ('postgres','supabase_admin') then raise exception 'Forbidden'; end if;
 update public.rooms set state='paused',revision=revision+1 where state='active' and host_seen_at<now()-interval '60 seconds';
 update public.ai_jobs j set status='cancelled' from public.rooms r where r.id=j.room_id and r.state<>'active' and j.status in ('queued','running');
 update public.ai_jobs set status='queued',leased_until=null,available_at=now()+interval '10 seconds' where status='running' and leased_until<now();
 insert into public.ai_jobs(room_id,kind)
 select r.id,'auto' from public.rooms r
 join lateral(select count(*) n,min(created_at) oldest from public.messages where room_id=r.id and id>r.summary_cursor and role in ('host','member') and visibility='visible') c on true
 where r.state='active' and r.ai_mode<>'off' and (r.is_demo or (select value from private.settings where key='ai_live_enabled')='true')
 and c.n>0 and (c.n>=case when r.ai_mode='active' then 3 when r.ai_mode='quiet' then 8 else 5 end or c.oldest<now()-make_interval(secs=>case when r.ai_mode='quiet' then 60 else 30 end))
 on conflict do nothing;
end $$;
create function public.story_claim_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; r public.rooms;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 perform public.story_tick();
 select * into j from public.ai_jobs where status='queued' and available_at<=now() order by created_at for update skip locked limit 1;
 if j.id is null then return null; end if;
 select * into r from public.rooms where id=j.room_id for update;
 if r.state<>'active' or r.host_seen_at<now()-interval '60 seconds' then update public.ai_jobs set status='cancelled' where id=j.id; return null; end if;
 if j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted) then update public.ai_jobs set status='cancelled' where id=j.id; return null; end if;
 if exists(select 1 from public.ai_jobs where room_id=r.id and status='running' and id<>j.id) then return null; end if;
 update public.ai_jobs set status='running',attempts=attempts+1,leased_until=now()+interval '120 seconds',through_message_id=(select coalesce(max(id),0) from public.messages where room_id=r.id and visibility='visible') where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.story_complete_job(p_id uuid,p_result jsonb,p_input integer,p_output integer) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; r public.rooms; rec jsonb; mid bigint; mem uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 select * into j from public.ai_jobs where id=p_id for update;
 if j.status<>'running' then return false; end if;
 select * into r from public.rooms where id=j.room_id for update;
 update public.ai_jobs set input_tokens=p_input,output_tokens=p_output,cost_usd=(p_input*0.1+p_output*0.5)/1000000.0 where id=j.id;
 if r.state<>'active' or r.host_seen_at<now()-interval '60 seconds' or (j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted)) then
  update public.ai_jobs set status='cancelled' where id=j.id; return false;
 end if;
 insert into public.summaries(room_id,job_id,content,through_message_id) values(r.id,j.id,p_result-'praise',j.through_message_id) on conflict(job_id) do nothing;
 if coalesce(p_result->>'reply','')<>'' then
  insert into public.messages(room_id,role,nickname,avatar,content,client_id) values(r.id,'ai','이야기별','⭐',left(p_result->>'reply',2000),j.id) on conflict(room_id,client_id) do nothing;
 end if;
 for rec in select value from jsonb_array_elements(coalesce(p_result->'praise','[]'::jsonb)) loop
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
 update public.rooms set summary_cursor=greatest(summary_cursor,j.through_message_id),ai_error=null,revision=revision+1 where id=r.id;
 return true;
end $$;
create function public.story_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.rooms where ended_at<now()-interval '90 days';
 delete from private.rate_limits where window_start<now()-interval '1 day';
 -- Remove anonymous identities with no remaining room membership, after a grace period.
 delete from auth.users u where u.is_anonymous=true and u.created_at<now()-interval '90 days' and not exists(select 1 from public.members where user_id=u.id);
end $$;
revoke all on function public.story_config(text),public.story_set_config(jsonb),public.story_rate_limit(text,integer,integer),public.story_mutate(uuid,boolean,text,jsonb),public.story_tick(),public.story_claim_job(),public.story_complete_job(uuid,jsonb,integer,integer),public.story_maintenance() from public,anon,authenticated;
grant execute on function public.story_config(text),public.story_set_config(jsonb),public.story_rate_limit(text,integer,integer),public.story_mutate(uuid,boolean,text,jsonb),public.story_tick(),public.story_claim_job(),public.story_complete_job(uuid,jsonb,integer,integer) to service_role;
select cron.schedule('story-maintenance','10 18 * * *','select public.story_maintenance()');
select cron.schedule('story-tick','10 seconds','select public.story_tick()');
alter publication supabase_realtime add table public.rooms, public.members, public.messages, public.summaries;
