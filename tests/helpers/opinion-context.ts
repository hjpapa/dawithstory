import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";

type Batch = { room: Record<string, unknown>; messages: Record<string, unknown>[] };
type Context = {
  room: Record<string, unknown>;
  isHost: boolean;
  me: Record<string, unknown> | null;
  aiEnabled: boolean;
  aiKey: string | null;
};

async function fixture(db: PGlite) {
  const host = crypto.randomUUID(), otherHost = crypto.randomUUID(), student = crypto.randomUUID();
  const hostSession = crypto.randomUUID(), otherSession = crypto.randomUUID(), studentSession = crypto.randomUUID();
  const room = crypto.randomUUID(), otherRoom = crypto.randomUUID();
  await db.query("insert into auth.users(id) values($1),($2),($3)", [host, otherHost, student]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$2),($3,$4),($5,$6)", [hostSession,host,otherSession,otherHost,studentSession,student]);
  await db.query("insert into public.profiles(id,email,status) values($1,'batch-host@example.invalid','approved'),($2,'batch-other@example.invalid','approved')", [host,otherHost]);
  await db.query("insert into public.rooms(id,owner_id,title,topic,kind,state,round_number) values($1,$2,'test','test','discussion','active',2),($3,$4,'other','other','discussion','active',2)", [room,host,otherRoom,otherHost]);
  const member = (await db.query<{id: string}>("insert into public.members(room_id,user_id,nickname,state) values($1,$2,'student','approved') returning id", [room,student])).rows[0].id;
  return { host,otherHost,student,hostSession,otherSession,studentSession,room,otherRoom,member };
}

function claims(db: PGlite, user?: string, session?: string, role = "authenticated") {
  return db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:user,session_id:session,role})]);
}

async function rejects(db: PGlite, run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("savepoint expected_denial");
  await assert.rejects(run(), pattern);
  await db.exec("rollback to savepoint expected_denial");
}

export async function testTeacherOpinionBatch(db: PGlite) {
  await db.exec("begin");
  try {
    const f = await fixture(db);
    const ids: number[] = [];
    for (const [index, visibility] of ["visible", "held", "hidden"].entries()) {
      let member = f.member;
      if (index) {
        const user = crypto.randomUUID();
        await db.query("insert into auth.users(id) values($1)", [user]);
        member = (await db.query<{id: string}>("insert into public.members(room_id,user_id,nickname,state) values($1,$2,$3,'approved') returning id", [f.room,user,visibility])).rows[0].id;
      }
      ids.push((await db.query<{id: number}>("insert into public.messages(room_id,user_id,member_id,role,nickname,content,visibility,round_number,safety_reason) values($1,$2,$3,'member','student',$4,$4,2,'private reason') returning id", [f.room,f.student,member,visibility])).rows[0].id);
    }
    ids.push(...(await db.query<{id: number}>(`insert into public.messages(room_id,member_id,role,nickname,content,round_number) values
      ($1,$2,'member','student','previous round',1),
      ($1,null,'host','teacher','host message',2),
      ($1,null,'ai','AI','AI message',2),
      ($1,null,'member','removed','missing member',2),
      ($3,$2,'member','student','other room',2) returning id`, [f.room,f.member,f.otherRoom])).rows.map(row => row.id));
    const query = (room = f.room, requested: (number | null)[] | null = ids) => db.query<{value: Batch}>("select public.story_teacher_opinions($1,$2::bigint[]) as value", [room,requested]);
    await claims(db,f.host,f.hostSession);
    await db.exec("set local role authenticated");
    const result = (await query()).rows[0].value;
    assert.equal(result.room.id, f.room);
    assert.equal(result.room.round_number, 2);
    assert.equal(result.room.messages_epoch, 0);
    assert.deepEqual(result.messages.map(m => m.id), [ids[0]]);
    assert.deepEqual(Object.keys(result.messages[0]).sort(), ["id","room_id","role","member_id","nickname","avatar","content","stance","visibility","round_number","created_at","edited_at"].sort());
    assert.deepEqual((await query(f.room,[ids[0],ids[0]])).rows[0].value.messages.map(m => m.id), [ids[0]]);
    assert.equal((await query(f.room,Array(100).fill(ids[0]))).rows[0].value.messages.length, 1);
    assert.equal((await query(f.room,[999999999])).rows[0].value.messages.length, 0);
    for (const bad of [null, [], [null], [0], [-1], Array(101).fill(ids[0])]) {
      await rejects(db,() => query(f.room,bad), /Invalid opinion IDs/);
    }
    await rejects(db,() => query(f.otherRoom), /Forbidden/);
    await rejects(db,() => query(crypto.randomUUID()), /Forbidden/);
    for (const [user,session] of [[f.otherHost,f.otherSession], [f.student,f.studentSession], [f.host,f.otherSession], [f.host,undefined], [undefined,undefined]]) {
      await claims(db,user,session);
      await rejects(db,() => query(), /Forbidden/);
    }
    await claims(db,f.host,f.hostSession);
    await db.exec("reset role");
    await db.query("update public.profiles set status='suspended' where id=$1", [f.host]);
    await db.exec("set local role authenticated");
    await rejects(db,() => query(), /Forbidden/);
    await db.exec("reset role");
    await db.query("update public.profiles set status='approved' where id=$1", [f.host]);
    for (const state of ["paused","ended"]) {
      await db.query("update public.rooms set state=$2 where id=$1", [f.room,state]);
      await db.exec("set local role authenticated");
      const batch = (await query()).rows[0].value;
      assert.equal(batch.room.state,state);
      assert.deepEqual(batch.messages,[]);
      await db.exec("reset role");
    }
    await db.query("update public.rooms set state='active',round_number=3,messages_epoch=messages_epoch+1 where id=$1", [f.room]);
    await db.exec("set local role authenticated");
    const newRound = (await query()).rows[0].value;
    assert.equal(newRound.room.round_number,3);
    assert.equal(newRound.room.messages_epoch,1);
    assert.deepEqual(newRound.messages,[]);
    await db.exec("reset role");
    await db.query("delete from auth.sessions where id=$1", [f.hostSession]);
    await db.exec("set local role authenticated");
    await rejects(db,() => query(), /Forbidden/);
    await db.exec("reset role; set local role anon");
    await rejects(db,() => query(), /permission denied/);
  } finally {
    await db.exec("reset role; rollback");
  }
}

export async function testMessageContext(db: PGlite) {
  await db.exec("begin");
  try {
    const f = await fixture(db);
    // Vault is Supabase infrastructure; exercise the unchanged real key reader.
    await db.exec("create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text)");
    const worker = await readFile("supabase/worker.sql", "utf8");
    const keyReader = worker.slice(worker.indexOf("create or replace function public.story_ai_key()"),worker.indexOf("create or replace function public.story_set_ai_key"));
    assert.ok(keyReader.includes("vault.decrypted_secrets"));
    await db.exec(keyReader);
    await db.query("insert into vault.decrypted_secrets values('story_openai_key',$1)", ["synthetic-test-key"]);
    const query = (actor: string | null = f.student, session: string | null = f.studentSession, room = f.room) => db.query<{value: Context | null}>("select public.story_message_context($1,$2,$3) as value", [actor,session,room]);
    const queryWithoutKey = () => db.query<{value: Context | null}>("select public.story_message_context($1,$2,$3,false) as value", [f.student,f.studentSession,f.room]);
    for (const role of ["anon", "authenticated"]) {
      await claims(db,f.student,f.studentSession,role);
      await db.exec(`set local role ${role}`);
      await rejects(db,() => query(), /permission denied/);
      await rejects(db,() => queryWithoutKey(), /permission denied/);
      await db.exec("reset role");
    }
    await claims(db,undefined,undefined,"service_role");
    await db.exec("set local role service_role");
    const context = (await query()).rows[0].value!;
    assert.equal(context.room.id,f.room);
    assert.equal(context.isHost,false);
    assert.equal(context.me?.id,f.member);
    assert.equal(context.aiEnabled,false);
    assert.equal(context.aiKey,null);
    const teacher = (await query(f.host,f.hostSession)).rows[0].value!;
    assert.equal(teacher.isHost,true);
    assert.equal(teacher.me,null);
    for (const [actor,session] of [[null,f.studentSession], [f.student,null], [f.host,f.studentSession], [f.student,crypto.randomUUID()]]) {
      // Invalid sessions return before even checking whether this room exists.
      assert.equal((await query(actor,session,crypto.randomUUID())).rows[0].value,null);
    }
    await rejects(db,() => query(f.student,f.studentSession,crypto.randomUUID()), /대화방을 찾을 수 없어요/);
    await rejects(db,() => query(f.otherHost,f.otherSession), /이 대화방에 접근할 수 없어요/);
    await rejects(db,() => query(f.student,f.studentSession,f.otherRoom), /이 대화방에 접근할 수 없어요/);
    await claims(db,undefined,undefined,"authenticated");
    await rejects(db,() => query(), /Forbidden/);
    await claims(db,undefined,undefined,"service_role");
    await db.exec("reset role");
    await db.query("update public.members set state='waiting',muted=true where id=$1", [f.member]);
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value?.me?.state,"waiting");
    assert.equal((await query()).rows[0].value?.me?.muted,true);
    await db.exec("reset role");
    await db.query("update public.rooms set state='ended' where id=$1", [f.room]);
    await db.exec("set local role service_role");
    await rejects(db,() => query(), /이 대화방에 접근할 수 없어요/);
    await db.exec("reset role");
    await db.query("update public.members set state='approved' where id=$1", [f.member]);
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value?.room.state,"ended");
    await db.exec("reset role");
    await db.query("update public.rooms set state='active' where id=$1", [f.room]);
    for (const state of ["kicked","rejected"]) {
      await db.query("update public.members set state=$2 where id=$1", [f.member,state]);
      await db.exec("set local role service_role");
      await rejects(db,() => query(), /이 대화방에 접근할 수 없어요/);
      await db.exec("reset role");
    }
    await db.query("update public.members set state='approved' where id=$1", [f.member]);
    await db.query("update public.profiles set status='suspended' where id=$1", [f.host]);
    await db.exec("set local role service_role");
    await rejects(db,() => query(f.host,f.hostSession), /이 대화방에 접근할 수 없어요/);
    await db.exec("reset role");
    await db.exec("update private.settings set value='true' where key='ai_live_enabled'");
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value?.aiEnabled,true);
    assert.equal((await query()).rows[0].value?.aiKey,"synthetic-test-key");
    assert.equal((await queryWithoutKey()).rows[0].value?.aiEnabled,true);
    assert.equal((await queryWithoutKey()).rows[0].value?.aiKey,null);
    await db.exec("reset role; update private.settings set value='false' where key='ai_live_enabled'");
    await db.query("update public.rooms set is_demo=true where id=$1", [f.room]);
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value?.aiKey,"synthetic-test-key");
    await db.exec("reset role; delete from vault.decrypted_secrets");
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value?.aiEnabled,true);
    assert.equal((await query()).rows[0].value?.aiKey,null);
    await db.exec("reset role; drop table vault.decrypted_secrets");
    await db.exec("set local role service_role");
    // Snapshot authorization must never query or return the provider key.
    assert.equal((await queryWithoutKey()).rows[0].value?.aiEnabled,true);
    assert.equal((await queryWithoutKey()).rows[0].value?.aiKey,null);
    await rejects(db,() => query(), /decrypted_secrets.*does not exist/);
    await db.exec("reset role");
    await db.query("delete from auth.sessions where id=$1", [f.studentSession]);
    await db.exec("set local role service_role");
    assert.equal((await query()).rows[0].value,null);
  } finally {
    await db.exec("reset role; rollback");
  }
}
