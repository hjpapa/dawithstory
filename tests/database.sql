begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare host uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); uid uuid; rid uuid; mid uuid; msgid bigint; obj jsonb; n integer; denied boolean; i integer; cid uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,is_anonymous) values(host,'fixture-host@example.invalid',false),(stranger,'fixture-stranger@example.invalid',false);
 insert into public.profiles(id,email,status) values(host,'fixture-host@example.invalid','approved'),(stranger,'fixture-stranger@example.invalid','pending');
 denied:=false;begin perform public.story_mutate(stranger,false,'create_room','{"title":"x","topic":"x","kind":"discussion"}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL pending user created room';end if;
 obj:=public.story_mutate(host,false,'create_room','{"title":"가상 검증","topic":"테스트","kind":"discussion"}');rid:=(obj->>'id')::uuid;
 perform public.story_mutate(host,false,'room_state',jsonb_build_object('room_id',rid,'state','active'));
 for i in 1..31 loop
  uid:=gen_random_uuid();insert into auth.users(id,is_anonymous) values(uid,true);
  obj:=public.story_mutate(uid,false,'join',jsonb_build_object('code',obj->>'code','nickname','가상'||i,'avatar','🐰'));
  -- Fetch current code independently of member response.
  mid:=(obj->>'id')::uuid;
  if i<=30 then perform public.story_mutate(host,false,'member',jsonb_build_object('room_id',rid,'member_id',mid,'state','approved'));
  else denied:=false;begin perform public.story_mutate(host,false,'member',jsonb_build_object('room_id',rid,'member_id',mid,'state','approved'));exception when others then denied:=true;end;if not denied then raise exception 'FAIL room exceeded 30';end if;end if;
  obj:=jsonb_build_object('code',(select code from public.rooms where id=rid));
 end loop;
 select user_id,id into uid,mid from public.members where room_id=rid and state='approved' limit 1;
 obj:=public.story_mutate(uid,false,'message',jsonb_build_object('room_id',rid,'content','근거를 함께 살펴봐요','client_id',cid));msgid:=(obj->>'id')::bigint;
 perform public.story_mutate(uid,false,'message',jsonb_build_object('room_id',rid,'content','근거를 함께 살펴봐요','client_id',cid));
 if (select count(*) from public.messages where room_id=rid and client_id=cid)<>1 then raise exception 'FAIL duplicate message';end if;
 denied:=false;begin perform public.story_mutate(stranger,false,'message',jsonb_build_object('room_id',rid,'content','침입','client_id',gen_random_uuid()));exception when others then denied:=true;end;if not denied then raise exception 'FAIL cross-room write';end if;
 denied:=false;begin perform public.story_mutate(uid,false,'ask_ai',jsonb_build_object('room_id',rid,'content','요약해줘','client_id',gen_random_uuid()));exception when others then denied:=true;end;if not denied then raise exception 'FAIL unauthorized AI';end if;
 perform public.story_mutate(host,false,'praise',jsonb_build_object('room_id',rid,'message_id',msgid,'category','reason','reason','근거를 살폈어요'));
 perform public.story_mutate(host,false,'praise',jsonb_build_object('room_id',rid,'message_id',msgid,'category','reason','reason','근거를 살폈어요'));
 if (select count(*) from public.praise where room_id=rid and status='awarded')<>1 then raise exception 'FAIL duplicate praise';end if;
 perform public.story_mutate(host,false,'praise_status',jsonb_build_object('room_id',rid,'praise_id',(select id from public.praise where room_id=rid limit 1),'status','revoked'));
 if exists(select 1 from public.praise where room_id=rid and status='awarded') then raise exception 'FAIL praise revoke';end if;
 update public.rooms set is_demo=true where id=rid;
 for i in 1..101 loop perform public.story_mutate(host,false,'ask_ai',jsonb_build_object('room_id',rid,'content','가상 요청 '||i,'client_id',gen_random_uuid()));end loop;
 if (select count(*) from public.ai_jobs where room_id=rid)<>101 then raise exception 'FAIL AI request quota';end if;
 update public.rooms set host_seen_at=now()-interval '61 seconds' where id=rid;perform public.story_tick();
 if (select state from public.rooms where id=rid)<>'paused' then raise exception 'FAIL heartbeat pause';end if;
 denied:=false;begin perform public.story_mutate(uid,false,'message',jsonb_build_object('room_id',rid,'content','중단 중','client_id',gen_random_uuid()));exception when others then denied:=true;end;if not denied then raise exception 'FAIL paused room write';end if;
 update public.rooms set state='ended',ended_at=now()-interval '91 days' where id=rid;perform public.story_maintenance();
 if exists(select 1 from public.rooms where id=rid) then raise exception 'FAIL retention';end if;
 if exists(select 1 from public.messages where room_id=rid) then raise exception 'FAIL cascading retention';end if;
 raise notice 'PASS pending approval, capacity 30, duplicate message, cross-room write, AI permission, praise idempotency and revoke, 101 AI requests, heartbeat, pause, 90-day retention';
end $$;
rollback;
