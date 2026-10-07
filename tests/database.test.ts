import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createJobProcessor } from "../supabase/functions/story-api/worker";
import { ProviderError } from "../supabase/functions/story-api/provider";
import { pgApi } from "./helpers/pg-api";

test("PostgreSQL migrations and access/queue regressions", async (t) => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    // Supabase infrastructure only; application SQL below is loaded unchanged.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema extensions;
      create table auth.users(id uuid primary key, email text, is_anonymous boolean, created_at timestamptz default now());
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
      create table auth.refresh_tokens(user_id text);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth, public to authenticated, anon, service_role;
    `);
    const schema = (await readFile("supabase/schema.sql", "utf8"))
      .replace(/^create extension if not exists pg_(cron|net).*;$/gm, "")
      .replace(/^select cron\.schedule.*;$/gm, "")
      .replace(/^alter publication .*;$/gm, "");
    await db.exec(schema);
    for (const file of [
      "usage.sql",
      "account-management.sql",
      "praise-validation.sql",
      "reliability.sql",
    ])
      await db.exec(await readFile(`supabase/${file}`, "utf8"));
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.exec(
      "insert into private.settings values ('ai_live_enabled','false') on conflict do nothing",
    );

    await t.test("existing database scenarios", async () => {
      for (const file of [
        "database.sql",
        "plaza.sql",
        "presentation.sql",
        "praise.sql",
        "reliability.sql",
        "review.sql",
      ]) {
        const sql = (await readFile(`tests/${file}`, "utf8")).replace(
          /^begin;|^rollback;/gm,
          "",
        );
        await db.exec("begin");
        try {
          await db.exec(sql);
        } finally {
          await db.exec("rollback");
        }
      }
    });

    await t.test(
      "direct SELECT hides other members and rejects revoked sessions",
      async () => {
        const host = crypto.randomUUID(),
          guest = crypto.randomUUID(),
          session = crypto.randomUUID();
        const hostSession = crypto.randomUUID(),
          room = crypto.randomUUID();
        await db.exec("begin");
        try {
          await db.query("insert into auth.users(id) values ($1),($2)", [
            host,
            guest,
          ]);
          await db.query(
            "insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)",
            [session, guest, hostSession, host],
          );
          await db.query(
            "insert into public.profiles(id,email,status) values ($1,'host@example.invalid','approved')",
            [host],
          );
          await db.query(
            "insert into public.rooms(id,owner_id,title,topic,kind,state) values ($1,$2,'test','test','discussion','active')",
            [room, host],
          );
          await db.query(
            "insert into public.members(room_id,user_id,nickname,state) values ($1,$2,'self','approved')",
            [room, guest],
          );
          for (const state of ["waiting", "rejected", "kicked", "approved"]) {
            const other = crypto.randomUUID();
            await db.query("insert into auth.users(id) values ($1)", [other]);
            await db.query(
              "insert into public.members(room_id,user_id,nickname,state) values ($1,$2,$3,$3)",
              [room, other, state],
            );
          }
          const claims = async (user: string, sid: string) =>
            db.query("select set_config('request.jwt.claims',$1,true)", [
              JSON.stringify({
                role: "authenticated",
                sub: user,
                session_id: sid,
              }),
            ]);
          await claims(guest, session);
          await db.exec("set local role authenticated");
          const own = await db.query<{ nickname: string }>(
            "select * from public.members",
          );
          assert.deepEqual(
            own.rows.map((r) => r.nickname),
            ["self"],
          );
          await claims(host, hostSession);
          assert.equal(
            (await db.query("select * from public.members")).rows.length,
            5,
          );
          await db.exec("reset role; update public.rooms set state='ended'");
          await claims(guest, session);
          await db.exec("set local role authenticated");
          assert.equal(
            (await db.query("select * from public.rooms")).rows.length,
            1,
          );
          await db.exec("reset role");
          await db.query("delete from auth.sessions where id=$1", [session]);
          await db.exec("set local role authenticated");
          assert.equal(
            (await db.query("select * from public.rooms")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from public.members")).rows.length,
            0,
          );
          await claims(guest, hostSession);
          assert.equal(
            (await db.query("select * from public.rooms")).rows.length,
            0,
          );
        } finally {
          await db.exec("reset role; rollback");
        }
      },
    );
    await t.test(
      "worker drains 165 speeches in order and retains valid older citations",
      async () => {
        await db.exec("begin");
        try {
          await db.exec(
            `select set_config('request.jwt.claims','{"role":"service_role"}',true)`,
          );
          const host = crypto.randomUUID(),
            room = crypto.randomUUID();
          await db.query("insert into auth.users(id) values($1)", [host]);
          await db.query(
            "insert into public.profiles(id,email,status) values($1,'backlog@example.invalid','approved')",
            [host],
          );
          await db.query(
            "insert into public.rooms(id,owner_id,title,topic,kind,state,is_demo) values($1,$2,'test','test','discussion','active',true)",
            [room, host],
          );
          const inserted = await db.query<{ id: number }>(
            "insert into public.messages(room_id,role,nickname,content) select $1,'host','진행자','가상 발언 '||i from generate_series(1,165) i returning id",
            [room],
          );
          const ids = inserted.rows.map((r) => r.id);
          const batches: number[][] = [];
          const api = pgApi(db);
          const processor = createJobProcessor({
            db: api,
            readMessages: async () => {
              throw Error("unexpected final job");
            },
            requestResponse: async (_key, payload) => {
              const input = JSON.parse(payload.input as string);
              batches.push(input.messages.map((m: any) => m.id));
              return {
                id: `response-${batches.length}`,
                usage: { input_tokens: 200, output_tokens: 100 },
                output: [
                  {
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          overview: "가상 요약",
                          reply: "",
                          opinions: [
                            { text: "첫 발언", message_ids: [ids[0], -123] },
                          ],
                          agreements: [],
                          differences: [],
                          questions: [],
                          praise: [],
                        }),
                      },
                    ],
                  },
                ],
              };
            },
            moderate: async () => null,
          });
          await processor(); // bounded worker invocation: two batches
          assert.deepEqual(batches.flat(), ids.slice(0, 160));
          assert.equal(
            (
              await db.query<{ summary_cursor: number }>(
                "select summary_cursor from public.rooms where id=$1",
                [room],
              )
            ).rows[0].summary_cursor,
            ids[159],
          );
          await processor();
          assert.deepEqual(
            batches.map((b) => b.length),
            [80, 80, 5],
          );
          assert.deepEqual(batches.flat(), ids);
          const summaries = await db.query<{ content: any }>(
            "select content from public.summaries where room_id=$1 order by through_message_id",
            [room],
          );
          assert.equal(summaries.rows.length, 3);
          for (const row of summaries.rows)
            assert.deepEqual(row.content.opinions[0].message_ids, [ids[0]]);
          const usage = await api.rpc("story_usage");
          assert.equal(usage.data.input_tokens, 600); // finish must not double count
          assert.equal(usage.data.output_tokens, 300);
          assert.equal(
            (
              await db.query(
                "select * from public.ai_jobs where status in ('queued','running')",
              )
            ).rows.length,
            0,
          );
        } finally {
          await db.exec("rollback");
        }
      },
    );

    await t.test(
      "paid attempts survive moderation failure, retry and cancellation without duplicates",
      async () => {
        await db.exec("begin");
        try {
          await db.exec(
            `select set_config('request.jwt.claims','{"role":"service_role"}',true)`,
          );
          const host = crypto.randomUUID(),
            room = crypto.randomUUID(),
            job = crypto.randomUUID();
          await db.query("insert into auth.users(id) values($1)", [host]);
          await db.query(
            "insert into public.profiles(id,email,status) values($1,'usage@example.invalid','approved')",
            [host],
          );
          await db.query(
            "insert into public.rooms(id,owner_id,title,topic,kind,state,is_demo,ai_mode) values($1,$2,'test','test','discussion','active',true,'off')",
            [room, host],
          );
          await db.query(
            "insert into public.ai_jobs(id,room_id,kind,requested_by) values($1,$2,'request',$3)",
            [job, room, host],
          );
          const api = pgApi(db);
          let calls = 0,
            failModeration = true,
            cancel = false;
          const processor = createJobProcessor({
            db: api,
            readMessages: async () => {
              throw Error("unexpected final job");
            },
            requestResponse: async () => {
              calls++;
              if (cancel)
                await db.query(
                  "update public.ai_jobs set status='cancelled' where id=$1",
                  [job],
                );
              return {
                id: `response-${calls}`,
                usage: { input_tokens: 200, output_tokens: 100 },
                output: [
                  {
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          overview: "가상",
                          reply: "가상",
                          opinions: [],
                          agreements: [],
                          differences: [],
                          questions: [],
                          praise: [],
                        }),
                      },
                    ],
                  },
                ],
              };
            },
            moderate: async () => {
              if (failModeration)
                throw new ProviderError("AI 안전 확인 지연", true);
              return null;
            },
          });
          await processor();
          assert.equal(calls, 1);
          assert.equal((await api.rpc("story_usage")).data.input_tokens, 200);
          await db.query(
            "update public.ai_jobs set available_at=now() where id=$1",
            [job],
          );
          failModeration = false;
          await processor();
          assert.equal(calls, 2);
          assert.equal((await api.rpc("story_usage")).data.input_tokens, 400);
          await api.rpc("story_record_usage", {
            p_id: job,
            p_attempt: 2,
            p_input: 200,
            p_output: 100,
          });
          assert.equal((await api.rpc("story_usage")).data.input_tokens, 400);
          // Lease retry/cancellation after a paid response still records the third attempt.
          await db.query(
            "update public.ai_jobs set status='queued',available_at=now() where id=$1",
            [job],
          );
          cancel = true;
          await processor();
          assert.equal((await api.rpc("story_usage")).data.input_tokens, 600);
          assert.equal(
            (
              await db.query(
                "select * from public.summaries where room_id=$1",
                [room],
              )
            ).rows.length,
            1,
          );
          assert.equal(
            (
              await db.query(
                "select * from private.ai_usage_attempts where job_id=$1",
                [job],
              )
            ).rows.length,
            3,
          );
        } finally {
          await db.exec("rollback");
        }
      },
    );
  } finally {
    await db.close();
  }
});
