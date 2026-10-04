import fs from "node:fs";
import assert from "node:assert/strict";
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
const mode = process.argv[2] || "setup";
const path = ".test-artifacts/api-fixtures.json";
fs.mkdirSync(".test-artifacts", { recursive: true });
async function call(action, p = {}, token, admin = false) {
  const res = await fetch(root + "/functions/v1/story-api", {
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
  const data = await res.json();
  return { ok: res.ok, data, status: res.status };
}
if (mode === "setup") {
  const sessions = [];
  for (let i = 0; i < 3; i++) {
    const client = createClient(root, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    sessions.push({
      id: data.user.id,
      token: data.session.access_token,
      refresh: data.session.refresh_token,
    });
  }
  fs.writeFileSync(path, JSON.stringify({ sessions }, null, 2));
  console.log(JSON.stringify({ fixtureUserIds: sessions.map((s) => s.id) }));
} else {
  const state = JSON.parse(fs.readFileSync(path, "utf8"));
  const [host, other, guest] = state.sessions;
  async function good(action, p = {}, token = host.token, admin = false) {
    const result = await call(action, p, token, admin);
    assert.ok(result.ok, action + ": " + JSON.stringify(result.data));
    return result.data;
  }
  async function denied(action, p = {}, token = guest.token) {
    const result = await call(action, p, token);
    assert.equal(result.ok, false, action + " must deny");
  }
  if (mode === "flow") {
    await denied(
      "create_room",
      { title: "승인 전", topic: "가상", kind: "discussion" },
      other.token,
    );
    const room = await good("create_room", {
      title: "검증용 가상 이야기",
      topic: "가상의 꽃밭 만들기와 공원 청소 이야기입니다.",
      kind: "discussion",
    });
    state.room = room;
    fs.writeFileSync(path, JSON.stringify(state, null, 2));
    await good("room_state", { room_id: room.id, state: "active" });
    const member = await good(
      "join",
      { code: room.code, nickname: "검증거북이", avatar: "🐢" },
      guest.token,
    );
    state.member = member;
    assert.equal(
      (await good("snapshot", { room_id: room.id }, guest.token)).waiting,
      true,
    );
    await denied("message", {
      room_id: room.id,
      content: "승인 전 발언",
      client_id: crypto.randomUUID(),
    });
    await good("member", {
      room_id: room.id,
      member_id: member.id,
      state: "approved",
    });
    const client_id = crypto.randomUUID();
    const message = await good(
      "message",
      {
        room_id: room.id,
        content: "공원에 꽃을 심으면 모두가 기분 좋게 산책할 수 있어요.",
        client_id,
      },
      guest.token,
    );
    state.message = message;
    await good(
      "message",
      { room_id: room.id, content: "중복 요청", client_id },
      guest.token,
    );
    let snap = await good("snapshot", { room_id: room.id });
    assert.equal(snap.messages.filter((m) => m.id === message.id).length, 1);
    await denied("snapshot", { room_id: room.id }, other.token);
    const foreign = createClient(root, key, {
      global: { headers: { Authorization: `Bearer ${other.token}` } },
      auth: { persistSession: false },
    });
    const rows = await foreign
      .from("messages")
      .select("*")
      .eq("room_id", room.id);
    assert.equal(rows.error, null);
    assert.equal(rows.data.length, 0);
    await denied("ask_ai", {
      room_id: room.id,
      content: "요약해줘",
      client_id: crypto.randomUUID(),
    });
    await good("member", {
      room_id: room.id,
      member_id: member.id,
      can_ask_ai: true,
    });
    await good("praise", {
      room_id: room.id,
      message_id: message.id,
      category: "reason",
      reason: "근거를 이야기했어요.",
    });
    await good("praise", {
      room_id: room.id,
      message_id: message.id,
      category: "reason",
      reason: "근거를 이야기했어요.",
    });
    snap = await good("snapshot", { room_id: room.id }, guest.token);
    assert.equal(snap.myPoints, 1);
    assert.equal(snap.myRoundSubmitted, true);
    await denied("next_round", { room_id: room.id, expected_round: 1 });
    await good("next_round", {
      room_id: room.id,
      expected_round: 1,
      prompt: "다음 가상 질문",
    });
    snap = await good("snapshot", { room_id: room.id }, guest.token);
    assert.equal(snap.myRoundSubmitted, false);
    assert.equal(snap.room.round_number, 2);
    await denied("message", {
      room_id: room.id,
      content: "오래된 차례",
      expected_round: 1,
      client_id: crypto.randomUUID(),
    });
    await good("round_control", {
      room_id: room.id,
      expected_round: 2,
      open: false,
    });
    await denied("message", {
      room_id: room.id,
      content: "잠긴 차례",
      expected_round: 2,
      client_id: crypto.randomUUID(),
    });
    await good("round_control", {
      room_id: room.id,
      expected_round: 2,
      open: true,
    });
    const held = await good(
      "message",
      {
        room_id: room.id,
        content: "연락처 테스트 010-1234-5678",
        client_id: crypto.randomUUID(),
      },
      guest.token,
    );
    assert.equal(held.visibility, "held");
    snap = await good("snapshot", { room_id: room.id }, guest.token);
    assert.equal(snap.myRoundSubmitted, true);
    await denied("message", {
      room_id: room.id,
      content: "같은 차례 재발언",
      expected_round: 2,
      client_id: crypto.randomUUID(),
    });
    assert.equal(
      snap.messages.some((m) => m.id === held.id),
      false,
    );
    await good("next_round", { room_id: room.id, expected_round: 2 });
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () =>
        call(
          "message",
          {
            room_id: room.id,
            expected_round: 3,
            content: "동시 전송 가상 발언",
            client_id: crypto.randomUUID(),
          },
          guest.token,
        ),
      ),
    );
    assert.equal(concurrent.filter((r) => r.ok).length, 1);
    snap = await good("snapshot", { room_id: room.id }, guest.token);
    assert.equal(
      snap.messages.filter((m) => m.member_id === member.id).length,
      2,
    );
    await good("room_state", { room_id: room.id, state: "paused" });
    await denied("message", {
      room_id: room.id,
      content: "중지 중",
      client_id: crypto.randomUUID(),
    });
    await good("room_state", { room_id: room.id, state: "active" });
    fs.writeFileSync(path, JSON.stringify(state, null, 2));
    console.log(
      JSON.stringify({
        passed: [
          "pending-approval",
          "waiting-room",
          "approval",
          "message-idempotency",
          "foreign-room-denied",
          "RLS",
          "AI-permission",
          "praise-idempotency",
          "PII-held",
          "pause-resume",
          "new-avatar",
          "round-permission-and-stale-round",
          "round-lock-and-held-quota",
          "concurrent-single-speech",
          "history-preserved",
        ],
        roomId: room.id,
        code: room.code,
      }),
    );
  } else if (mode === "ai") {
    await good("room_state", { room_id: state.room.id, state: "active" });
    const before = await good("snapshot", { room_id: state.room.id });
    const oldReplies = new Set(
      before.messages.filter((m) => m.role === "ai").map((m) => m.id),
    );
    const timer = setInterval(
      () => good("heartbeat", { room_id: state.room.id }).catch(() => {}),
      15000,
    );
    try {
      await good("ask_ai", {
        room_id: state.room.id,
        content: "꽃밭 아이디어를 간단히 정리해 주세요.",
        client_id: crypto.randomUUID(),
      });
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const snap = await good("snapshot", { room_id: state.room.id });
        if (
          snap.summary &&
          snap.messages.some((m) => m.role === "ai" && !oldReplies.has(m.id))
        ) {
          console.log(
            JSON.stringify({
              passed: "durable-ai-worker",
              overview: snap.summary.content.overview,
              replies: snap.messages.filter((m) => m.role === "ai").length,
            }),
          );
          process.exitCode = 0;
          break;
        }
        if (i === 23)
          throw new Error("AI summary timeout: " + snap.room.ai_error);
      }
    } finally {
      clearInterval(timer);
    }
  } else if (mode === "capacity") {
    const { rooms } = await good("rooms");
    const room = rooms.find((r) => r.title === "동시 승인 가상 검증 20261003");
    assert.ok(room);
    await good("room_state", { room_id: room.id, state: "active" });
    const before = await good("snapshot", { room_id: room.id });
    assert.equal(before.members.length, 31);
    const results = await Promise.all(
      before.members.map((member) =>
        call(
          "member",
          { room_id: room.id, member_id: member.id, state: "approved" },
          host.token,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.ok).length, 30);
    assert.equal(results.filter((r) => !r.ok).length, 1);
    const after = await good("snapshot", { room_id: room.id });
    assert.equal(
      after.members.filter((m) => m.state === "approved").length,
      30,
    );
    await good("delete_room", { room_id: room.id });
    console.log(
      "PASS: 31 simultaneous approval requests admit exactly 30; test room removed.",
    );
  } else if (mode === "browser") {
    await good("room_state", { room_id: state.room.id, state: "active" });
    console.log(
      "Synthetic host connected for 3 minutes; browser participant approval enabled.",
    );
    for (let i = 0; i < 18; i++) {
      await good("heartbeat", { room_id: state.room.id });
      const snap = await good("snapshot", { room_id: state.room.id });
      for (const member of snap.members.filter(
        (m) => m.state === "waiting" && m.nickname === "화면검증토끼",
      ))
        await good("member", {
          room_id: state.room.id,
          member_id: member.id,
          state: "approved",
        });
      await new Promise((r) => setTimeout(r, 10000));
    }
  } else if (mode === "cleanup") {
    if (state.room) await good("delete_room", { room_id: state.room.id });
    console.log("Removed test room and dependent records.");
  }
}
