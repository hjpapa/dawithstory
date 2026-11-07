import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { safety, incomingSafety } from "../supabase/functions/story-api/safety";

const actor = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const roomId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const jwt = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature`;
const context = () => ({
  room: { id: roomId, title: "Fixture room", state: "active", host_seen_at: new Date().toISOString(), round_number: 1, round_open: true, is_demo: false, revision: 3, messages_epoch: 0 },
  isHost: false,
  me: { id: "member", state: "approved", muted: false, can_ask_ai: false },
  aiEnabled: true,
  aiKey: "fixture-provider-key",
});
const source = readFile("supabase/functions/story-api/index.ts", "utf8").then((code) =>
  stripTypeScriptTypes(code.replace(/^import .+ from ".+";\r?\n/gm, "")),
);

async function handler(options: {
  context?: ReturnType<typeof context> | null;
  invalidJwt?: boolean;
  flagged?: boolean;
  moderationGate?: Promise<void>;
  mutateError?: string;
  tables?: Record<string, Record<string, any>[]>;
} = {}) {
  const calls: { name: string; payload?: any }[] = [];
  let serve: (request: Request) => Promise<Response>;
  const db = {
    auth: { getUser: async () => {
      calls.push({ name: "auth" });
      return { data: { user: options.invalidJwt ? null : { id: actor, is_anonymous: true } }, error: null };
    } },
    from: (table: string) => {
      if (!options.tables) throw Error("Message preflight must not issue separate table reads");
      const queryState = { columns: "*", filters: [] as ((row: Record<string, any>) => boolean)[], single: false, offset: 0, end: Infinity };
      calls.push({ name: "table:" + table, payload: queryState });
      const query: any = {
        select: (columns: string) => { queryState.columns = columns; return query; },
        eq: (column: string, value: unknown) => { queryState.filters.push((row) => row[column] === value); return query; },
        gt: (column: string, value: number) => { queryState.filters.push((row) => row[column] > value); return query; },
        in: (column: string, values: unknown[]) => { queryState.filters.push((row) => values.includes(row[column])); return query; },
        order: () => query,
        range: (offset: number, end: number) => { queryState.offset = offset; queryState.end = end + 1; return query; },
        limit: (limit: number) => { queryState.end = limit; return query; },
        maybeSingle: () => { queryState.single = true; return query; },
        single: () => { queryState.single = true; return query; },
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          const rows = (options.tables![table] || [])
            .filter((row) => queryState.filters.every((filter) => filter(row)))
            .slice(queryState.offset, queryState.end)
            .map((row) => queryState.columns === "*" ? row : Object.fromEntries(queryState.columns.split(",").map((key) => [key, row[key]])));
          return Promise.resolve({ data: queryState.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async (name: string, payload: unknown) => {
      calls.push({ name, payload });
      if (name === "story_message_context")
        return { data: Object.hasOwn(options, "context") ? options.context : context(), error: null };
      if (name === "story_mutate")
        return options.mutateError
          ? { data: null, error: { message: options.mutateError } }
          : { data: { id: 1, visibility: (payload as any).p.visibility }, error: null };
      if (name === "story_config") return { data: {}, error: null };
      if (name === "story_session_valid") return { data: true, error: null };
      throw Error("Unexpected RPC: " + name);
    },
  };
  runInNewContext(await source, {
    createClient: () => db,
    createJobProcessor: () => async () => { calls.push({ name: "worker" }); },
    AVATARS: [], safety,
    incomingSafety: async (key: string | null, content: string, ask: boolean) => {
      calls.push({ name: "moderation" });
      await options.moderationGate;
      return incomingSafety(key, content, ask, async () => Response.json({ results: [{ flagged: options.flagged ?? false }] }));
    },
    Deno: { env: { get: () => "fixture" }, serve: (callback: typeof serve) => { serve = callback; } },
    EdgeRuntime: { waitUntil: () => {} },
    Request, Response, Headers, TextEncoder, crypto, performance, atob,
  });
  const invoke = (payload: Record<string, unknown> = {}, bearer = jwt) => serve(new Request("https://fixture.invalid/story-api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
    body: JSON.stringify({ action: "message", room_id: roomId, client_id: requestId, content: "꽃을 함께 돌보고 싶어요", expected_round: 1, ...payload }),
  }));
  return { calls, invoke };
}

test("message preflight reduces DB calls and never mutates before safety completes", async () => {
  let release!: () => void;
  const moderationGate = new Promise<void>((resolve) => { release = resolve; });
  const { calls, invoke } = await handler({ moderationGate });
  const pending = invoke({ p_actor: "forged", p_admin: true, visibility: "visible" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.name), ["auth", "story_message_context", "moderation"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)), { p_actor: actor, p_session: sessionId, p_room: roomId });
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 1, visibility: "visible" });
  assert.equal(calls.at(-1)?.name, "story_mutate");
  assert.equal(calls.at(-1)?.payload.p_actor, actor);
  assert.equal(calls.at(-1)?.payload.p_admin, false);
  assert.match(response.headers.get("server-timing")!, /context;dur=/);
  assert.doesNotMatch(JSON.stringify(await (await invoke()).json()), /fixture-provider-key/);
});

test("invalid JWT and revoked session stop before moderation and mutation", async () => {
  const missing = await handler();
  assert.equal((await missing.invoke({}, "")).status, 401);
  assert.equal(missing.calls.length, 0);
  const invalid = await handler({ invalidJwt: true });
  assert.equal((await invalid.invoke()).status, 401);
  assert.deepEqual(invalid.calls.map((call) => call.name), ["auth"]);
  const revoked = await handler({ context: null });
  assert.equal((await revoked.invoke()).status, 401);
  assert.deepEqual(revoked.calls.map((call) => call.name), ["auth", "story_message_context"]);
});

test("preflight preserves room, member, AI permission, and edit-round gates", async () => {
  const cases = [
    { change: (c: ReturnType<typeof context>) => { c.room.state = "paused"; }, payload: {} },
    { change: (c: ReturnType<typeof context>) => { c.room.host_seen_at = new Date(0).toISOString(); }, payload: {} },
    { change: (c: ReturnType<typeof context>) => { c.me.muted = true; }, payload: {} },
    { change: (c: ReturnType<typeof context>) => { c.me.state = "waiting"; }, payload: {} },
    { change: () => {}, payload: { action: "ask_ai" } },
    { change: () => {}, payload: { action: "edit_message", message_id: 1, expected_round: 2 } },
  ];
  for (const scenario of cases) {
    const c = context();
    scenario.change(c);
    const { calls, invoke } = await handler({ context: c });
    assert.equal((await invoke(scenario.payload)).status, 400);
    assert.deepEqual(calls.map((call) => call.name), ["auth", "story_message_context"]);
  }
});

test("local and provider-flagged speech remain held, and final DB checks can reject a send", async () => {
  const local = await handler();
  const pii = await local.invoke({ content: "가상 연락처 010-0000-0000" });
  assert.equal((await pii.json()).visibility, "held");
  assert.ok(!local.calls.some((call) => call.name === "moderation"));
  const external = await handler({ flagged: true });
  assert.equal((await (await external.invoke()).json()).visibility, "held");
  assert.equal(external.calls.at(-1)?.payload.p.visibility, "held");
  const raced = await handler({ mutateError: "현재 장이 변경됐어요." });
  assert.equal((await raced.invoke()).status, 400);
  assert.deepEqual(raced.calls.map((call) => call.name), ["auth", "story_message_context", "moderation", "story_mutate"]);
});

test("non-message actions retain the existing config and session validation", async () => {
  const { calls, invoke } = await handler();
  const response = await invoke({ action: "me" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.name), ["story_config", "auth", "story_session_valid"]);
});

test("pending and unchanged snapshots use current access without loading content or an AI key", async () => {
  const pendingContext = context();
  pendingContext.me.state = "waiting";
  const pending = await handler({ context: pendingContext });
  const pendingResponse = await pending.invoke({ action: "snapshot" });
  assert.equal(pendingResponse.status, 200);
  assert.deepEqual(await pendingResponse.json(), {
    room: { id: roomId, title: "Fixture room", state: "active" },
    me: pendingContext.me,
    waiting: true,
  });
  assert.deepEqual(pending.calls.map((call) => call.name), ["auth", "story_message_context"]);
  assert.equal(pending.calls[1].payload.p_include_ai_key, false);

  const c = context();
  const version = JSON.stringify([c.room.revision, c.room.state, c.room.messages_epoch, null, true, false, false, null]);
  const unchanged = await handler({ context: c });
  const unchangedResponse = await unchanged.invoke({ action: "snapshot", sync: { after: 0, epoch: 0, host: false, version } });
  assert.equal(unchangedResponse.status, 200);
  assert.deepEqual(await unchangedResponse.json(), { unchanged: true, version });
  assert.deepEqual(unchanged.calls.map((call) => call.name), ["auth", "story_message_context"]);

  const revoked = await handler({ context: null });
  assert.equal((await revoked.invoke({ action: "snapshot" })).status, 401);
  assert.deepEqual(revoked.calls.map((call) => call.name), ["auth", "story_message_context"]);
});

test("member snapshots retain roster, held-message, and provider-key privacy", async () => {
  const c = context();
  const tables = {
    rooms: [c.room],
    members: [
      { id: "member", room_id: roomId, user_id: actor, state: "approved", nickname: "Me" },
      { id: "other", room_id: roomId, user_id: "private-other-user", state: "approved", nickname: "Peer" },
      { id: "pending", room_id: roomId, user_id: "private-pending-user", state: "waiting", nickname: "Private waiting name" },
    ],
    messages: [
      { id: 1, room_id: roomId, role: "member", member_id: "member", user_id: actor, content: "Visible opinion", visibility: "visible", safety_reason: "private-moderation-note", round_number: 1 },
      { id: 2, room_id: roomId, role: "member", member_id: "other", user_id: "private-other-user", content: "Private held opinion", visibility: "held", round_number: 1 },
    ],
    praise: [
      { id: "awarded", room_id: roomId, member_id: "other", status: "awarded", points: 20 },
      { id: "pending", room_id: roomId, member_id: "other", status: "pending", content: "Private pending praise" },
    ],
  };
  const active = await handler({ context: c, tables });
  const activeResponse = await active.invoke({ action: "snapshot" });
  assert.equal(activeResponse.status, 200);
  const result = await activeResponse.json();
  assert.deepEqual(result.members.map((member: any) => member.nickname), ["Me", "Peer"]);
  assert.deepEqual(result.messages.map((message: any) => message.content), ["Visible opinion"]);
  assert.equal(result.messages[0].user_id, undefined);
  assert.equal(result.messages[0].safety_reason, undefined);
  assert.equal(result.praise.length, 1);
  assert.equal(result.praise[0].points, undefined);
  assert.doesNotMatch(JSON.stringify(result), /fixture-provider-key|private-other-user|Private waiting name|Private held opinion|Private pending praise/);
  assert.equal(active.calls[1].payload.p_include_ai_key, false);
  assert.equal(active.calls.filter((call) => call.name === "table:rooms").length, 1);
  assert.ok(!active.calls.some((call) => ["story_config", "story_ai_key", "story_session_valid", "table:profiles", "table:reports"].includes(call.name)));

  c.room.state = "ended";
  const ended = await handler({ context: c, tables });
  const endedResponse = await ended.invoke({ action: "snapshot" });
  assert.equal(endedResponse.status, 200);
  const review = await endedResponse.json();
  assert.equal(review.reviewOnly, true);
  assert.equal(review.canHeartbeat, false);
  assert.deepEqual(review.reports, []);
  assert.deepEqual(review.jobs, []);
  assert.deepEqual(review.praise, []);
  assert.doesNotMatch(JSON.stringify(review), /fixture-provider-key|private-other-user|private-moderation-note|Private waiting name|Private held opinion/);
  assert.equal(ended.calls[1].payload.p_include_ai_key, false);
});
