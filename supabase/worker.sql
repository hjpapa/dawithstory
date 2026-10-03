create extension if not exists supabase_vault with schema vault;
create or replace function public.story_ai_key() returns text language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 return (select decrypted_secret from vault.decrypted_secrets where name='story_openai_key');
end $$;
create or replace function public.story_set_ai_key(p_key text) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 select id into sid from vault.secrets where name='story_openai_key';
 if sid is null then perform vault.create_secret(p_key,'story_openai_key'); else perform vault.update_secret(sid,p_key); end if;
end $$;
revoke all on function public.story_ai_key(),public.story_set_ai_key(text) from public,anon,authenticated;
grant execute on function public.story_ai_key(),public.story_set_ai_key(text) to service_role;
-- Set private.settings.backend_hash to SHA-256 of STORY_SERVER_SECRET separately.
insert into private.settings values ('ai_live_enabled','false') on conflict(key) do nothing;
do $$ declare token text; begin
 if exists(select 1 from vault.secrets where name='story_worker_token') then return; end if;
 token:=encode(extensions.gen_random_bytes(48),'hex');
 perform vault.create_secret(token,'story_worker_token');
 insert into private.settings values('worker_hash',encode(extensions.digest(token,'sha256'),'hex'));
end $$;
select cron.schedule('story-ai-worker','10 seconds',$cron$
select net.http_post(url:='https://ftvrortfrobyfekmiwve.supabase.co/functions/v1/story-api',
 headers:=jsonb_build_object('Content-Type','application/json','x-story-worker',(select decrypted_secret from vault.decrypted_secrets where name='story_worker_token')),
 body:='{"action":"worker"}'::jsonb, timeout_milliseconds:=120000)
where exists(select 1 from public.ai_jobs where status='queued' and available_at<=now());
$cron$);
