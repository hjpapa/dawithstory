begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare host uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); guest uuid; rid uuid; rid2 uuid; code text; mids uuid[]:='{}'; uids uuid[]:='{}'; obj jsonb; denied boolean; actor uuid;
begin
 insert into auth.users(id,email) values(host,'presentation-host@example.invalid'),(outsider,'presentation-outsider@example.invalid');
 insert into public.profiles(id,email,status) values(host,'presentation-host@example.invalid','approved'),(outsider,'presentation-outsider@example.invalid','approved');
 obj:=public.story_mutate(host,false,'create_room','{"title":"Presentation fixture","topic":"Synthetic discussion","kind":"discussion"}'); rid:=(obj->>'id')::uuid; code:=obj->>'code';
 perform public.story_mutate(host,false,'room_state',jsonb_build_object('room_id',rid,'state','active'));
 for i in 1..3 loop
  guest:=gen_random_uuid(); uids:=array_append(uids,guest); insert into auth.users(id,is_anonymous) values(guest,true);
  obj:=public.story_mutate(guest,false,'join',jsonb_build_object('code',code,'nickname','가상발표자'||i,'avatar','🐰')); mids:=array_append(mids,(obj->>'id')::uuid);
  perform public.story_mutate(host,false,'member',jsonb_build_object('room_id',rid,'member_id',mids[i],'state','approved'));
 end loop;
 foreach actor in array array[uids[1],outsider] loop
  denied:=false; begin perform public.story_mutate(actor,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids',to_jsonb(mids[1:2]))); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL unauthorized presentation'; end if;
 end loop;
 denied:=false; begin perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids','[]'::jsonb)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL empty presenters'; end if;
 denied:=false; begin perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids',jsonb_build_array(gen_random_uuid()))); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL foreign member accepted'; end if;
 perform public.story_mutate(host,false,'member',jsonb_build_object('room_id',rid,'member_id',mids[1],'muted',true));
 denied:=false; begin perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids',to_jsonb(mids[1:2]))); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL muted member selected'; end if;
 perform public.story_mutate(host,false,'member',jsonb_build_object('room_id',rid,'member_id',mids[1],'muted',false));
 perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids',to_jsonb(mids[1:2])));
 if (select cardinality(speaker_ids) from public.rooms where id=rid)<>2 then raise exception 'FAIL multiple selection persistence'; end if;
 denied:=false; begin perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',1,'member_ids',to_jsonb(mids))); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL stale presentation repeated'; end if;
 for i in reverse 2..1 loop
  perform public.story_mutate(uids[i],false,'message',jsonb_build_object('room_id',rid,'expected_round',2,'client_id',gen_random_uuid(),'content','선택된 가상 발표'));
 end loop;
 denied:=false; begin perform public.story_mutate(uids[3],false,'message',jsonb_build_object('room_id',rid,'expected_round',2,'client_id',gen_random_uuid(),'content','선택되지 않은 발표')); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL unselected speaker allowed'; end if;
 for i in 1..2 loop perform public.story_mutate(host,false,'message',jsonb_build_object('room_id',rid,'client_id',gen_random_uuid(),'content','교사 진행 발언')); end loop;
 perform public.story_mutate(host,false,'round_control',jsonb_build_object('room_id',rid,'expected_round',2,'open',false));
 perform public.story_mutate(host,false,'message',jsonb_build_object('room_id',rid,'client_id',gen_random_uuid(),'content','잠금 중 교사 발언'));
 perform public.story_mutate(host,false,'presentation_start',jsonb_build_object('room_id',rid,'expected_round',2,'member_ids',jsonb_build_array(mids[1])));
 perform public.story_mutate(uids[1],false,'message',jsonb_build_object('room_id',rid,'expected_round',3,'client_id',gen_random_uuid(),'content','재선택 발표'));
 perform public.story_mutate(host,false,'next_round',jsonb_build_object('room_id',rid,'expected_round',3));
 if (select speaker_ids from public.rooms where id=rid) is not null then raise exception 'FAIL everyone mode not restored'; end if;
 perform public.story_mutate(uids[3],false,'message',jsonb_build_object('room_id',rid,'expected_round',4,'client_id',gen_random_uuid(),'content','모두 대화'));
 if (select count(*) from public.messages where room_id=rid)<>7 then raise exception 'FAIL lost conversation history'; end if;
 raise notice 'PASS selected speakers, free order, host authority, muted/foreign/empty/stale rejection, teacher uninterrupted, reselection, everyone restored, history';
end $$;
rollback;
