-- Ordered batches prevent an outage/backlog from advancing past unseen speech.
alter table public.ai_jobs add column if not exists after_message_id bigint not null default 0;

-- One immutable billing record per provider attempt, independent of publication.
create table if not exists private.ai_usage_attempts (
 job_id uuid not null references public.ai_jobs(id) on delete cascade,
 attempt integer not null check(attempt>0),
 response_id text,
 input_tokens integer not null check(input_tokens>=0),
 output_tokens integer not null check(output_tokens>=0),
 cost_usd numeric(12,8) not null,
 created_at timestamptz not null default now(),
 primary key(job_id,attempt)
);
alter table private.ai_usage_attempts enable row level security;
revoke all on private.ai_usage_attempts from public,anon,authenticated;
-- Preserve already-recorded historical totals; previously lost usage cannot be recovered.
insert into private.ai_usage_attempts(job_id,attempt,input_tokens,output_tokens,cost_usd)
select id,greatest(attempts,1),input_tokens,output_tokens,cost_usd from public.ai_jobs
where input_tokens>0 or output_tokens>0
on conflict do nothing;

create or replace function public.story_record_usage(p_id uuid,p_attempt integer,p_input integer,p_output integer,p_response_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; inserted integer; cost numeric;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 if p_attempt is null or p_attempt<1 or p_input is null or p_output is null or p_input<0 or p_output<0 then raise exception 'Invalid usage'; end if;
 select * into j from public.ai_jobs where id=p_id for update;
 if j.id is null then return false; end if;
 if p_attempt>j.attempts then raise exception 'Unknown attempt'; end if;
 cost:=(p_input*0.1+p_output*0.5)/1000000.0;
 insert into private.ai_usage_attempts(job_id,attempt,response_id,input_tokens,output_tokens,cost_usd)
 values(p_id,p_attempt,p_response_id,p_input,p_output,cost) on conflict do nothing;
 get diagnostics inserted = row_count;
 if inserted=1 then
  update public.ai_jobs set input_tokens=input_tokens+p_input,output_tokens=output_tokens+p_output,cost_usd=cost_usd+cost where id=p_id;
 end if;
 return inserted=1;
end $$;
revoke all on function public.story_record_usage(uuid,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.story_record_usage(uuid,integer,integer,integer,text) to service_role;

create or replace function public.story_claim_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; r public.rooms;
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
   if (j.kind='final' and r.state<>'ended') or (j.kind<>'final' and r.state<>'active') or (j.kind='auto' and r.ai_mode='off') or (j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted)) then
    update public.ai_jobs set status='cancelled' where id=j.id;
    continue;
   end if;
   update public.ai_jobs set status='running',attempts=attempts+1,leased_until=now()+interval '120 seconds',after_message_id=r.summary_cursor,
    through_message_id=case when j.kind='final' then
      (select coalesce(max(id),0) from public.messages where room_id=r.id and visibility='visible' and role in ('host','member'))
    else coalesce((select max(batch.id) from (
      select id from public.messages where room_id=r.id and visibility='visible' and role in ('host','member')
      and id>r.summary_cursor order by id limit 80
    ) batch),r.summary_cursor) end where id=j.id returning * into j;
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
 if (not r.is_demo and (select value from private.settings where key='ai_live_enabled') is distinct from 'true') or (j.kind='auto' and r.ai_mode='off') or (j.kind='final' and r.state<>'ended') or (j.kind<>'final' and (r.state<>'active' or r.host_seen_at<now()-interval '60 seconds')) or (j.kind='request' and j.requested_by<>r.owner_id and not exists(select 1 from public.members where room_id=r.id and user_id=j.requested_by and state='approved' and can_ask_ai and not muted)) then
  update public.ai_jobs set status='cancelled' where id=j.id; return false;
 end if;
 insert into public.summaries(room_id,job_id,content,through_message_id,is_final) values(r.id,j.id,p_result-'praise',j.through_message_id,j.kind='final') on conflict(job_id) do nothing;
 if j.kind<>'final' and coalesce(p_result->>'reply','')<>'' then
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
 update public.rooms set summary_cursor=greatest(summary_cursor,j.through_message_id),ai_error=null,revision=revision+1 where id=r.id;
 if j.kind<>'final' and r.ai_mode<>'off' and exists(
  select 1 from public.messages where room_id=r.id and id>j.through_message_id
  and visibility='visible' and role in ('host','member')
 ) then
  insert into public.ai_jobs(room_id,kind) values(r.id,'auto') on conflict do nothing;
 end if;
 return true;
end $$;
