// Uses verify-api setup's synthetic teacher; never reads or changes real passwords.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).replace(/^"|"$/g, "")]));
const path = ".test-artifacts/api-fixtures.json";
const fixture = JSON.parse(fs.readFileSync(path, "utf8"));
const host = fixture.sessions[0];
const origin = process.argv[2];
assert.ok(origin, "Specify test origin");
const body = Buffer.from(JSON.stringify({ exp: Date.now()+60000, nonce: randomUUID() })).toString("base64url");
const cookie = "story_admin="+body+"."+createHmac("sha256",env.STORY_SERVER_SECRET).update(body).digest("base64url");
async function call(action, payload={}, scope, adminCookie=true) {
  const response = await fetch(origin+"/api/story", { method:"POST", headers:{"Content-Type":"application/json", Origin:origin, Authorization:`Bearer ${host.token}`, ...(adminCookie?{Cookie:cookie}:{}), ...(scope?{"X-Story-Scope":scope}:{})}, body:JSON.stringify({action,...payload}) });
  return { status:response.status, data:await response.json() };
}
if (process.argv[3] === "reproduce") {
  const old = await call("me");
  assert.equal(old.data.admin,true);
  assert.equal(old.data.profile,undefined);
  console.log("REPRODUCED: operator cookie replaces the signed-in teacher identity");
} else {
  for (const scope of [undefined,"user"]) {
    const me=await call("me",{},scope);
    assert.equal(me.status,200);
    assert.equal(me.data.profile.id,host.id);
    assert.equal(me.data.profile.status,"approved");
    assert.equal(me.data.admin,undefined);
  }
  assert.equal((await call("admin_overview")).status,403);
  assert.equal((await call("admin_overview",{},"admin",false)).status,401);
  assert.equal((await call("admin_overview",{},"admin")).status,200);
  const created=await call("create_room",{title:"로그인 역할 검증",topic:"가상",kind:"discussion"});
  assert.equal(created.status,200);
  fixture.room=created.data;
  fs.writeFileSync(path,JSON.stringify(fixture));
  const ordinary=await call("snapshot",{room_id:created.data.id});
  assert.equal(ordinary.data.canHeartbeat,true);
  const operator=await call("snapshot",{room_id:created.data.id},"admin");
  assert.equal(operator.data.canHeartbeat,false);
  console.log("PASS teacher approval and room creation coexist with operator cookie; operator view requires explicit scope and valid cookie");
}
