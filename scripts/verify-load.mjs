// Run after verify-api setup / flow / ai. Only uses the recorded synthetic room.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).replace(/^"|"$/g, "")]));
const path = ".test-artifacts/api-fixtures.json";
const state = JSON.parse(fs.readFileSync(path,"utf8"));
const [host] = state.sessions;
const root = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const stats = [];
async function call(action, p={}, token=host.token) {
  const start = performance.now();
  const response = await fetch(root+"/functions/v1/story-api", { method:"POST",headers:{"Content-Type":"application/json",apikey:key,Authorization:`Bearer ${token}`}, body:JSON.stringify({action,room_id:state.room.id,...p}) });
  const body = await response.text();
  assert.equal(response.ok,true, action+": "+body);
  if(action === "snapshot") stats.push({ms:performance.now()-start,bytes:Buffer.byteLength(body)});
  return JSON.parse(body);
}
await call("room_state",{state:"active"});
await call("room_settings",{ai_mode:"off"});
const heartbeat=setInterval(()=>call("heartbeat").catch(()=>{}),15000);
const clients=[];
try {
  while (state.sessions.length < 31) {
    const client=createClient(root,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInAnonymously();
    if(error) throw error;
    state.sessions.push({id:data.user.id,token:data.session.access_token,refresh:data.session.refresh_token});
    fs.writeFileSync(path,JSON.stringify(state));
    const member=await call("join",{code:state.room.code,nickname:"부하검증"+state.sessions.length,avatar:"🐰"},data.session.access_token);
    await call("member",{member_id:member.id,state:"approved"});
  }
  const students=state.sessions.slice(1);
  assert.equal(students.length,30);
  const initial=await Promise.all(students.map(s=>call("snapshot",{},s.token)));
  assert.equal(initial[0].members.filter(m=>m.state==="approved").length,30);
  assert.ok(initial[0].messages.some(m=>m.role==="ai"),"Run ai mode first to verify derived content removal");
  await call("message_visibility",{message_id:state.message.id,visibility:"hidden"});
  const hidden=await Promise.all(students.map((s,i)=>call("snapshot",{sync:{after:initial[i].messages.at(-1)?.id||0,epoch:initial[i].room.messages_epoch,host:false}},s.token)));
  for(const snap of hidden) {
    assert.equal(snap.messagesReset,true);
    assert.ok(snap.messages.every(m=>m.id!==state.message.id && m.role!=="ai"));
  }
  const content="서른 명 실시간 전달 검증 "+crypto.randomUUID();
  const deliveries=[];
  for(const student of students) {
    const client=createClient(root,key,{auth:{persistSession:false,autoRefreshToken:false}});
    clients.push(client);
    await client.realtime.setAuth(student.token);
    let received;
    deliveries.push(new Promise(resolve=>{received=resolve;}));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("subscribe timeout")),15000);
      client.channel("load:"+student.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${state.room.id}`},payload=>{
        if(payload.new.content===content) received(true);
      }).subscribe(status=>{
        if(status==="SUBSCRIBED"){clearTimeout(timer);resolve();}
        if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){clearTimeout(timer);reject(new Error(status));}
      });
    });
  }
  const message=await call("message",{content,client_id:crypto.randomUUID()});
  let deliveryTimer;
  try {
    await Promise.race([Promise.all(deliveries),new Promise((_,reject)=>{deliveryTimer=setTimeout(()=>reject(new Error("30-session delivery timeout")),15000);})]);
  } finally {clearTimeout(deliveryTimer);}
  const updates=await Promise.all(students.map((s,i)=>call("snapshot",{sync:{after:hidden[i].messages.at(-1)?.id||0,epoch:hidden[i].room.messages_epoch,host:false}},s.token)));
  for(const snap of updates){assert.equal(snap.messagesReset,false);assert.deepEqual(snap.messages.map(m=>m.id),[message.id]);}
  for(let round=0;round<3;round++) {
    await new Promise(resolve=>setTimeout(resolve,5000));
    const snapshots=await Promise.all(students.map((s,i)=>call("snapshot",{sync:{after:message.id,epoch:updates[i].room.messages_epoch,host:false,version:updates[i].version}},s.token)));
    for(const snap of snapshots){assert.equal(snap.unchanged,true);assert.equal(snap.messages,undefined);}
  }
  const times=stats.map(s=>s.ms).sort((a,b)=>a-b);
  const report={sessions:30,realtimeDeliveries:30,snapshots:stats.length,p95Ms:Math.round(times[Math.ceil(times.length*.95)-1]),maxMs:Math.round(times.at(-1)),meanBytes:Math.round(stats.reduce((sum,s)=>sum+s.bytes,0)/stats.length),passed:["hidden AI removal","cache reset","incremental message","empty repeat delta","30 simultaneous snapshots","30 realtime subscriptions"],scope:"API and Realtime sessions; not 30 rendered browser windows"};
  fs.writeFileSync(".test-artifacts/load-result.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  clearInterval(heartbeat);
  await Promise.all(clients.map(c=>c.removeAllChannels()));
  await call("room_state",{state:"paused"});
  console.log(JSON.stringify({cleanupUserIds:state.sessions.map(s=>s.id)}));
}
