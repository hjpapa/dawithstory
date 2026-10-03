-- Aggregate all retained usage, without a client row limit.
create or replace function public.story_usage() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Forbidden'; end if;
 return (select jsonb_build_object('completed',count(*) filter(where status='done'),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'cost_usd',coalesce(sum(cost_usd),0)) from public.ai_jobs);
end $$;
revoke all on function public.story_usage() from public,anon,authenticated;
grant execute on function public.story_usage() to service_role;
