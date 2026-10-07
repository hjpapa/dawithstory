import { safety, incomingSafety } from "./safety.ts";
import { createJobProcessor } from "./worker.ts";
import { AVATARS } from "./avatars.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
const url = Deno.env.get("SUPABASE_URL")!;
const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
const safe = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function check(result: { data: any; error: any }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function getRoomAccess(
  roomId: string,
  actor: string | null,
  admin: boolean,
) {
  const room = check(
    await db.from("rooms").select("*").eq("id", roomId).maybeSingle(),
  );
  if (!room) throw new Error("대화방을 찾을 수 없어요.");
  const profile = actor
    ? check(
        await db
          .from("profiles")
          .select("status")
          .eq("id", actor)
          .maybeSingle(),
      )
    : null;
  const isHost =
    admin || (room.owner_id === actor && profile?.status === "approved");
  const me = actor
    ? check(
        await db
          .from("members")
          .select("*")
          .eq("room_id", roomId)
          .eq("user_id", actor)
          .maybeSingle(),
      )
    : null;
  if (
    !isHost &&
    (!me || ["kicked", "rejected"].includes(me.state) || (room.state === "ended" && me.state !== "approved"))
  )
    throw new Error("이 대화방에 접근할 수 없어요.");
  return { room, isHost, me };
}
async function readMessages(roomId: string, host: boolean, after = 0) {
  let rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .gt("id", after)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (!host) query = query.eq("visibility", "visible");
    const batch = await query;
    if (batch.error) return batch;
    rows = rows.concat(batch.data);
    if (batch.data.length < 1000) break;
  }
  return { data: rows, error: null };
}
async function readPraise(roomId: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await db.from("praise").select("*").eq("room_id", roomId)
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
    if (batch.error) return batch;
    rows.push(...batch.data);
    if (batch.data.length < 1000) return { data: rows, error: null };
  }
}
async function snapshot(
  roomId: string,
  actor: string | null,
  admin: boolean,
  config: any,
  exporting = false,
  sync?: { after?: number; epoch?: number; host?: boolean; version?: string },
  retry = true,
) {
  const access = await getRoomAccess(roomId, actor, admin);
  const { room, isHost, me } = access;
  const aiEnabled = config.ai_live_enabled === "true" || room.is_demo;
  const reviewJob = room.state === "ended" ? check(await db.from("ai_jobs").select("status,error").eq("room_id", roomId).eq("kind", "final").order("created_at", { ascending: false }).limit(1).maybeSingle()) : null;
  const version = JSON.stringify([room.revision, room.state, room.messages_epoch, room.ai_error, aiEnabled, isHost, reviewJob]);
  if (room.state === "ended" && !isHost) {
    if (!exporting && sync?.version === version) return {unchanged:true,version};
    const [messages, summary, job, members] = await Promise.all([
      readMessages(roomId, false),
      db.from("summaries").select("content,created_at,is_final,through_message_id").eq("room_id", roomId).order("is_final", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("ai_jobs").select("status,error").eq("room_id", roomId).eq("kind", "final").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("members").select("id,nickname,avatar,state").eq("room_id", roomId).eq("state", "approved"),
    ]);
    const latest = check(await db.from("rooms").select("messages_epoch").eq("id", roomId).single());
    if (latest.messages_epoch !== room.messages_epoch) {
      if (retry) return snapshot(roomId, actor, admin, config, exporting, undefined, false);
      throw new Error("대화가 변경되고 있어요. 다시 확인해 주세요.");
    }
    return { room, isHost, me, version, reviewOnly: true, reviewJob: check(job), aiEnabled,
      messagesReset: true, messages: check(messages).map((m: any) => ({ id:m.id, room_id:m.room_id, role:m.role, member_id:m.member_id, nickname:m.nickname, avatar:m.avatar, content:m.content, stance:m.stance, visibility:m.visibility, round_number:m.round_number, created_at:m.created_at })),
      members: check(members), summary: check(summary), praise: [], jobs: [], reports: [], myPoints: 0, canHeartbeat: false };
  }
  const incremental = !exporting && sync?.epoch === room.messages_epoch && sync?.host === isHost && Number.isSafeInteger(sync?.after) && sync!.after! >= 0;
  if (!isHost && me.state === "waiting")
    return {
      room: { id: room.id, title: room.title, state: room.state },
      me,
      waiting: true,
    };
  if (!exporting && incremental && sync?.version === version)
    return { unchanged: true, version };
  const [
    membersResult,
    messagesResult,
    summaryResult,
    praiseResult,
    jobsResult,
    reportsResult,
    ownRoundResult,
  ] = await Promise.all([
    db.from("members").select("*").eq("room_id", roomId).order("created_at"),
    readMessages(roomId, isHost, incremental ? sync!.after : 0),
    db
      .from("summaries")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    readPraise(roomId),
    db
      .from("ai_jobs")
      .select("status,error,created_at")
      .eq("room_id", roomId)
      .in("status", ["queued", "running"])
      .limit(20),
    isHost
      ? db
          .from("reports")
          .select("*")
          .eq("room_id", roomId)
          .eq("resolved", false)
      : Promise.resolve({ data: [], error: null }),
    me
      ? db
          .from("messages")
          .select("id")
          .eq("room_id", roomId)
          .eq("member_id", me.id)
          .eq("round_number", room.round_number)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const praises = check(praiseResult);
  const members = check(membersResult);
  // A concurrent hide must never be merged into a cache with the old epoch.
  const latest = check(await db.from("rooms").select("messages_epoch").eq("id", roomId).single());
  if (latest.messages_epoch !== room.messages_epoch) {
    if (retry) return snapshot(roomId, actor, admin, config, exporting, undefined, false);
    throw new Error("대화가 변경되고 있어요. 잠시 후 다시 확인해 주세요.");
  }
  const points = (id: string) =>
    praises.filter((p: any) => p.member_id === id && p.status === "awarded")
      .length;
  return {
    ...access,
    version,
    messagesReset: !incremental,
    canHeartbeat: room.state !== "ended" && !admin && room.owner_id === actor,
    reviewJob,
    members: members
      .filter((m: any) => isHost || m.state === "approved")
      .map((m: any) => ({
        ...m,
        ...(!isHost ? { user_id: undefined } : {}),
        ...(isHost || m.id === me?.id ? { points: points(m.id) } : {}),
      })),
    messages: check(messagesResult).map((m: any) =>
      isHost ? m : { ...m, user_id: undefined, safety_reason: undefined },
    ),
    summary: check(summaryResult),
    praise: isHost
      ? praises
      : praises
          .filter((p: any) => p.status === "awarded")
          .map((p: any) => ({ ...p, points: undefined })),
    jobs: check(jobsResult),
    reports: check(reportsResult),
    aiEnabled,
    myPoints: me ? points(me.id) : 0,
    myRoundSubmitted: check(ownRoundResult).length > 0,
  };
}
const processJobs = createJobProcessor({ db, readMessages });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ error: "내용이 너무 길어요." }, 413);
    const p = JSON.parse(raw);
    const action = safe(p.action, 40);
    const config = check(await db.rpc("story_config"));
    const adminToken = req.headers.get("x-story-admin");
    const admin =
      !!adminToken && (await hash(adminToken)) === config.backend_hash;
    if (action === "register") {
      if (!admin) return json({ error: "Forbidden" }, 403);
      const email = safe(p.email, 254).toLowerCase();
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof p.password !== "string" ||
        p.password.length < 8 ||
        p.password.length > 128
      )
        return json(
          { error: "이메일 형식의 아이디와 8~128자 비밀번호를 입력해 주세요." },
          400,
        );
      const allowed = check(
        await db.rpc("story_rate_limit", {
          p_key: "register:" + (await hash(safe(p.client_ip, 200))),
          p_limit: 5,
          p_seconds: 3600,
        }),
      );
      if (!allowed)
        return json(
          { error: "가입 신청이 많아요. 잠시 후 다시 시도해 주세요." },
          429,
        );
      const created = await db.auth.admin.createUser({
        email,
        password: p.password,
        email_confirm: true,
      });
      if (created.error)
        return json(
          {
            error:
              "가입 신청을 완료하지 못했어요. 이미 신청했다면 로그인하거나 운영자에게 문의해 주세요.",
          },
          400,
        );
      const profile = await db
        .from("profiles")
        .insert({ id: created.data.user.id, email, status: "pending" });
      if (profile.error) {
        await db.auth.admin.deleteUser(created.data.user.id);
        throw new Error("가입 신청을 저장하지 못했어요. 다시 시도해 주세요.");
      }
      return json({ ok: true });
    }
    if (action === "worker") {
      if (
        (await hash(req.headers.get("x-story-worker") || "")) !==
        config.worker_hash
      )
        return json({ error: "Forbidden" }, 403);
      await processJobs();
      return json({ ok: true });
    }
    if (action === "configure") {
      if (!admin) return json({ error: "Forbidden" }, 403);
      if (p.openai_key)
        check(await db.rpc("story_set_ai_key", { p_key: p.openai_key }));
      return json({ ok: true });
    }
    if (action === "auth_limit") {
      if (!admin) return json({ error: "Forbidden" }, 403);
      const allowed = check(
        await db.rpc("story_rate_limit", {
          p_key: "admin:" + (await hash(safe(p.key, 200))),
          p_limit: 10,
          p_seconds: 300,
        }),
      );
      return json({ ok: allowed }, allowed ? 200 : 429);
    }
    let user: any = null;
    if (!admin) {
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
      if (!bearer) return json({ error: "로그인이 필요해요." }, 401);
      const result = await db.auth.getUser(bearer);
      if (result.error || !result.data.user)
        return json({ error: "로그인이 만료됐어요. 다시 접속해 주세요." }, 401);
      user = result.data.user;
      const claims = JSON.parse(
        atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (
        !uuid.test(claims.session_id || "") ||
        !check(
          await db.rpc("story_session_valid", {
            p_user: user.id,
            p_session: claims.session_id,
          }),
        )
      )
        return json(
          { error: "로그인이 만료됐어요. 다시 로그인해 주세요." },
          401,
        );
    }
    if (action === "me") {
      if (admin) return json({ admin: true });
      if (user.is_anonymous)
        return json({ user: { id: user.id }, anonymous: true });
      const profile =
        check(
          await db
            .from("profiles")
            .upsert(
              { id: user.id, email: user.email },
              { onConflict: "id", ignoreDuplicates: true },
            )
            .select()
            .maybeSingle(),
        ) ||
        check(await db.from("profiles").select("*").eq("id", user.id).single());
      return json({ user: { id: user.id, email: user.email }, profile });
    }
    if (
      action === "admin_overview" ||
      action === "admin_profile" ||
      action === "admin_password" ||
      action === "admin_ai"
    ) {
      if (!admin) return json({ error: "운영자만 사용할 수 있어요." }, 403);
      if (action === "admin_password") {
        if (
          !uuid.test(p.user_id || "") ||
          typeof p.password !== "string" ||
          p.password.length < 8 ||
          p.password.length > 128
        )
          return json({ error: "8~128자 새 비밀번호를 입력해 주세요." }, 400);
        const profile = check(
          await db
            .from("profiles")
            .select("id")
            .eq("id", p.user_id)
            .maybeSingle(),
        );
        if (!profile)
          return json({ error: "진행자 계정을 찾을 수 없어요." }, 404);
        const result = await db.auth.admin.updateUserById(p.user_id, {
          password: p.password,
          email_confirm: true,
        });
        if (result.error)
          return json(
            {
              error:
                "비밀번호를 변경하지 못했어요. 다른 비밀번호로 다시 시도해 주세요.",
            },
            400,
          );
        check(await db.rpc("story_revoke_sessions", { p_user: p.user_id }));
        return json({ ok: true });
      }
      if (action === "admin_profile") {
        if (
          !uuid.test(p.user_id) ||
          !["approved", "suspended", "pending"].includes(p.status)
        )
          throw new Error("잘못된 요청이에요.");
        if (p.status === "approved") {
          const result = await db.auth.admin.updateUserById(p.user_id, {
            email_confirm: true,
          });
          if (result.error) throw new Error("계정을 승인하지 못했어요.");
        }
        check(
          await db
            .from("profiles")
            .update({ status: p.status })
            .eq("id", p.user_id),
        );
        if (p.status !== "approved")
          check(
            await db
              .from("rooms")
              .update({ state: "paused" })
              .eq("owner_id", p.user_id)
              .eq("state", "active"),
          );
        return json({ ok: true });
      }
      if (action === "admin_ai") {
        if (p.enabled && p.confirmation !== "데이터 처리 조건을 확인했습니다")
          throw new Error("데이터 처리 조건 확인이 필요해요.");
        check(
          await db.rpc("story_set_config", {
            p_values: { ai_live_enabled: p.enabled ? "true" : "false" },
          }),
        );
        return json({ ok: true });
      }
      const [profiles, rooms, usage] = await Promise.all([
        db
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        db.from("rooms").select("*").order("created_at", { ascending: false }),
        db.rpc("story_usage"),
      ]);
      return json({
        profiles: check(profiles),
        rooms: check(rooms),
        usage: check(usage),
        aiEnabled: config.ai_live_enabled === "true",
      });
    }
    if (action === "rooms") {
      if (admin)
        return json({
          rooms: check(
            await db
              .from("rooms")
              .select("*")
              .order("created_at", { ascending: false }),
          ),
        });
      const profile = check(
        await db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      );
      if (profile?.status !== "approved") return json({ rooms: [], profile });
      return json({
        rooms: check(
          await db
            .from("rooms")
            .select("*")
            .eq("owner_id", user.id)
            .order("created_at", { ascending: false }),
        ),
        profile,
      });
    }
    if (action === "join") {
      if (
        !/^[A-Z0-9]{8}$/i.test(safe(p.code, 8)) ||
        !safe(p.nickname, 16) ||
        !AVATARS.includes(p.avatar)
      )
        throw new Error("초대 코드와 별명을 확인해 주세요.");
      if (safety(p.nickname)) throw new Error("다른 별명을 사용해 주세요.");
      const allowed = check(
        await db.rpc("story_rate_limit", {
          p_key: "join:" + user.id,
          p_limit: 15,
          p_seconds: 60,
        }),
      );
      if (!allowed)
        return json(
          { error: "입장 요청이 너무 빨라요. 잠시 기다려 주세요." },
          429,
        );
    } else if (action !== "create_room" && !uuid.test(p.room_id || ""))
      throw new Error("대화방 주소를 확인해 주세요.");
    if (action === "snapshot")
      return json(
        await snapshot(p.room_id, user?.id || null, admin, config, !!p.export, p.sync),
      );
    if (
      action === "create_room" &&
      (!safe(p.title, 100) ||
        !safe(p.topic, 1000) ||
        !["discussion", "debate", "daily"].includes(p.kind))
    )
      throw new Error("제목과 주제를 입력해 주세요.");
    if (["message", "ask_ai"].includes(action)) {
      const access = await getRoomAccess(p.room_id, user?.id || null, admin);
      if (
        !safe(p.content) ||
        p.content.length > 2000 ||
        !uuid.test(p.client_id || "")
      )
        throw new Error("1~2000자로 입력해 주세요.");
      if (
        access.room.state !== "active" ||
        new Date(access.room.host_seen_at).getTime() < Date.now() - 60000
      )
        throw new Error("현재 대화를 보낼 수 없는 상태예요.");
      if (
        !access.isHost &&
        (access.me?.state !== "approved" || access.me.muted)
      )
        throw new Error("발언 권한이 없어요.");
      if (action === "ask_ai" && !access.isHost && !access.me?.can_ask_ai)
        throw new Error("진행자가 AI 요청 권한을 주면 사용할 수 있어요.");
      const key = (config.ai_live_enabled === "true" || access.room.is_demo)
        ? check(await db.rpc("story_ai_key")) : null;
      const { reason, degraded } = await incomingSafety(key, p.content, action === "ask_ai");
      if (action === "ask_ai" && reason) throw new Error(reason);
      p.visibility = reason ? "held" : "visible";
      p.safety_reason = reason || (degraded ? "외부 안전 검사가 지연되어 기본 검사만 적용했어요. 진행자가 확인해 주세요." : null);
    }
    const allowedActions = [
      "create_room",
      "join",
      "heartbeat",
      "room_state",
      "room_settings",
      "review_retry",
      "round_control",
      "next_round",
      "presentation_start",
      "rotate_code",
      "member",
      "message",
      "ask_ai",
      "message_visibility",
      "praise",
      "praise_status",
      "report",
      "resolve_report",
      "delete_room",
    ];
    if (!allowedActions.includes(action))
      throw new Error("지원하지 않는 요청이에요.");
    // Never pass caller-controlled role/identity values to database authority functions.
    const result = check(
      await db.rpc("story_mutate", {
        p_actor: user?.id || null,
        p_admin: admin,
        p_action: action,
        p,
      }),
    );
    if (["message", "ask_ai", "room_state", "review_retry"].includes(action))
      EdgeRuntime.waitUntil(processJobs());
    return json(result);
  } catch (error) {
    const message = (error as Error).message || "";
    const exposed = /[가-힣]/.test(message)
      ? message
      : "요청을 처리하지 못했어요. 입력 내용을 확인해 주세요.";
    return json({ error: exposed }, 400);
  }
});
