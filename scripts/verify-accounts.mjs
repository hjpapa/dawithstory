// Uses disposable synthetic accounts; prints IDs for targeted cleanup, never credentials.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, ""),
    ]),
);
const root = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const origin = process.argv[2] || "http://127.0.0.1:3000";
const email = `account-check-${randomUUID()}@example.invalid`;
const password = randomUUID() + "aA!";
const replacement = randomUUID() + "bB!";
const client = () =>
  createClient(root, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function action(action, p = {}, token, admin = false) {
  const r = await fetch(root + "/functions/v1/story-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(admin
        ? { "x-story-admin": env.STORY_SERVER_SECRET }
        : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ action, ...p }),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}
const registered = await fetch(origin + "/api/register", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    email,
    password,
    status: "approved",
    action: "admin_ai",
  }),
});
assert.equal(registered.status, 200, "registration must work without mail");
const auth = client();
const signed = await auth.auth.signInWithPassword({ email, password });
assert.equal(signed.error, null);
const user_id = signed.data.user.id;
fs.mkdirSync(".test-artifacts", { recursive: true });
fs.writeFileSync(
  ".test-artifacts/account-cleanup.json",
  JSON.stringify({ user_id, email }),
);
console.log(JSON.stringify({ fixtureUserId: user_id, fixtureEmail: email }));
const token = signed.data.session.access_token;
const refreshToken = signed.data.session.refresh_token;
assert.equal((await action("me", {}, token)).data.profile.status, "pending");
assert.equal(
  (
    await action(
      "create_room",
      { title: "検証", topic: "仮想", kind: "discussion" },
      token,
    )
  ).ok,
  false,
);
assert.equal(
  (await action("admin_password", { user_id, password: replacement }, token))
    .status,
  403,
);
assert.equal(
  (await action("register", { email, password }, token)).status,
  403,
);
assert.equal(
  (await action("admin_profile", { user_id, status: "approved" }, null, true))
    .ok,
  true,
);
const room = await action(
  "create_room",
  {
    title: "가상 계정 검증",
    topic: "계정 검증만 진행합니다",
    kind: "discussion",
  },
  token,
);
assert.equal(room.ok, true);
assert.equal(
  (
    await action(
      "room_state",
      { room_id: room.data.id, state: "active" },
      token,
    )
  ).ok,
  true,
);
assert.equal(
  (await action("admin_password", { user_id, password: "short" }, null, true))
    .ok,
  false,
);
assert.equal(
  (
    await action(
      "admin_password",
      { user_id, password: replacement },
      null,
      true,
    )
  ).ok,
  true,
);
assert.equal(
  (await action("me", {}, token)).status,
  401,
  "old access token must be rejected",
);
assert.ok(
  (await client().auth.refreshSession({ refresh_token: refreshToken })).error,
  "old refresh token must fail",
);
const oldRead = await auth.from("rooms").select("id").eq("id", room.data.id);
assert.equal(
  oldRead.data?.length ?? 0,
  0,
  "old session must lose room RLS access",
);
assert.ok(
  (await client().auth.signInWithPassword({ email, password })).error,
  "old password must fail",
);
const fresh = await client().auth.signInWithPassword({
  email,
  password: replacement,
});
assert.equal(fresh.error, null);
assert.equal(
  (await action("me", {}, fresh.data.session.access_token)).data.profile.status,
  "approved",
);
const snap = await action(
  "snapshot",
  { room_id: room.data.id },
  fresh.data.session.access_token,
);
assert.equal(snap.data.room.state, "paused");
assert.equal(
  (await action("admin_profile", { user_id, status: "suspended" }, null, true))
    .ok,
  true,
);
assert.equal(
  (
    await action(
      "admin_password",
      { user_id, password: randomUUID() + "cC!" },
      null,
      true,
    )
  ).ok,
  true,
);
const overview = await action("admin_overview", {}, null, true);
assert.equal(
  overview.data.profiles.find((p) => p.id === user_id).status,
  "suspended",
);
console.log(
  "PASS mail-free registration, pending approval, privilege checks, password reset, old password/token/RLS rejection, paused room, status preservation",
);
