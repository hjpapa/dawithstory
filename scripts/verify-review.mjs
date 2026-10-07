import fs from "node:fs";
import assert from "node:assert/strict";
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).replace(/^"|"$/g,'')]));
const path='.test-artifacts/api-fixtures.json';const fixture=JSON.parse(fs.readFileSync(path,'utf8'));const [host,outsider,guest]=fixture.sessions;
async function call(action,p={},token=host.token){const res=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/functions/v1/story-api',{method:'POST',headers:{'Content-Type':'application/json',apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},body:JSON.stringify({action,...p})});return {ok:res.ok,data:await res.json()};}
async function good(action,p={},token){const r=await call(action,p,token);assert.ok(r.ok,JSON.stringify(r.data));return r.data;}
const room=await good('create_room',{title:'가상 종료 요약 검증',topic:'가상 공원에 꽃을 심을까요?',kind:'discussion'});fixture.room=room;fs.writeFileSync(path,JSON.stringify(fixture));
const payload={room_id:room.id};
await good('room_settings',{...payload,ai_mode:'off'});
await good('room_state',{...payload,state:'active'});
const member=await good('join',{code:room.code,nickname:'가상토끼',avatar:'🐰'},guest.token);
await good('member',{...payload,member_id:member.id,state:'approved'});
await good('message',{...payload,content:'가상 공원에 꽃을 심으면 함께 즐길 수 있어요.',client_id:crypto.randomUUID(),expected_round:1},guest.token);
await good('message',{...payload,content:'꽃을 돌볼 방법도 다음에 함께 생각해 봅시다.',client_id:crypto.randomUUID(),expected_round:1});
const hidden=await good('message',{...payload,content:'요약에서 제외할 가상 발언입니다.',client_id:crypto.randomUUID(),expected_round:1});
await good('message_visibility',{...payload,message_id:hidden.id,visibility:'hidden'});
assert.equal((await call('room_state',{...payload,state:'ended'},guest.token)).ok,false);
await good('room_state',{...payload,state:'ended'});
await good('room_state',{...payload,state:'ended'});
let snapshot=await good('snapshot',payload,guest.token);
assert.equal(snapshot.room.state,'ended');assert.equal(snapshot.reviewOnly,true);
assert.equal(snapshot.messages.length,2);assert.ok(snapshot.messages.every(m=>!m.user_id&&!m.safety_reason));
assert.equal((await call('snapshot',payload,outsider.token)).ok,false);
assert.equal((await call('message',{...payload,content:'종료 후 발언',client_id:crypto.randomUUID()},guest.token)).ok,false);
assert.equal((await call('ask_ai',{...payload,content:'종료 후 요청',client_id:crypto.randomUUID()})).ok,false);
assert.equal((await call('join',{code:room.code,nickname:'늦은가상',avatar:'🐻'},outsider.token)).ok,false);
console.log('PASS shared review, hidden speech omission, outsider denial, ended speech/AI/join denial, duplicate end');
if(snapshot.aiEnabled){
 for(let i=0;i<24 && !snapshot.summary?.is_final;i++){await new Promise(r=>setTimeout(r,5000));snapshot=await good('snapshot',payload,guest.token);if(['failed','cancelled'].includes(snapshot.reviewJob?.status))break;}
 assert.equal(snapshot.summary?.is_final,true,'final AI review: '+JSON.stringify(snapshot.reviewJob));
 assert.ok(snapshot.summary.content.overview);console.log('PASS final AI summary is available to approved participant');
}else console.log('AI is globally disabled: live generation skipped; queue behavior covered by rollback SQL tests');
const stable=await good('snapshot',{...payload,sync:{version:snapshot.version}},guest.token);assert.equal(stable.unchanged,true);
await good('member',{...payload,member_id:member.id,state:'kicked'});assert.equal((await call('snapshot',payload,guest.token)).ok,false);
console.log('PASS unchanged review response and kicked participant denial');
await good('delete_room',payload);delete fixture.room;fs.writeFileSync(path,JSON.stringify(fixture));console.log('Removed synthetic discussion and dependent records');
