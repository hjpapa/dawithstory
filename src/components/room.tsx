"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Shield,
  Smile,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { api, supabase } from "@/lib/supabase";
import {
  CATEGORIES,
  KINDS,
  STATES,
  transcriptCsv,
  type Message,
  type Snapshot,
  type SummaryItem,
} from "@/lib/domain";
import { Header, Loading, Mascot, Modal, Notice } from "./ui";
import { Plaza } from "./plaza";
import { speakerMessages, type Speaker } from "@/lib/plaza";
import { AVATAR_CATALOG } from "../../supabase/functions/story-api/avatars";
export function RoomView({
  roomId,
  initial,
  demo = false,
}: {
  roomId: string;
  initial?: Snapshot;
  demo?: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(initial || null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [text, setText] = useState("");
  const [ask, setAsk] = useState(false);
  const [stance, setStance] = useState("neutral");
  const [tab, setTab] = useState("chat");
  const [side, setSide] = useState("summary");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{
    message: Message;
    type: "praise" | "report";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("reason");
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const [focusMessage, setFocusMessage] = useState<number | null>(null);
  const [nextRound, setNextRound] = useState(false);
  const [roundPrompt, setRoundPrompt] = useState("");
  const [roundBusy, setRoundBusy] = useState(false);
  useEffect(() => {
    if (!speaker || !focusMessage) return;
    document
      .getElementById("message-" + focusMessage)
      ?.scrollIntoView({ block: "nearest" });
  }, [speaker, focusMessage]);
  useEffect(() => {
    if (data && !data.isHost && (!data.me?.can_ask_ai || !data.aiEnabled))
      setAsk(false);
  }, [data?.isHost, data?.me?.can_ask_ai, data?.aiEnabled]);
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingSend = useRef<{ signature: string; id: string } | null>(null);
  const previousPoints = useRef<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const points = data?.myPoints;
    if (points == null) return;
    if (previousPoints.current !== null && points > previousPoints.current) {
      setCelebrating(true);
      const timer = setTimeout(() => setCelebrating(false), 3500);
      previousPoints.current = points;
      return () => clearTimeout(timer);
    }
    previousPoints.current = points;
  }, [data?.myPoints]);
  const refresh = useCallback(async () => {
    if (demo) return;
    try {
      const result = await api<Snapshot & { waiting?: boolean }>("snapshot", {
        room_id: roomId,
      });
      setWaiting(!!result.waiting);
      setData(result);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    }
  }, [roomId, demo]);
  useEffect(() => {
    refresh();
    if (demo) return;
    const interval = setInterval(refresh, 5000);
    let timeout: ReturnType<typeof setTimeout>;
    const channel = supabase()
      .channel("room:" + roomId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        () => {
          clearTimeout(timeout);
          timeout = setTimeout(refresh, 100);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "members",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          clearTimeout(timeout);
          timeout = setTimeout(refresh, 100);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          clearTimeout(timeout);
          timeout = setTimeout(refresh, 100);
        },
      )
      .subscribe();
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      supabase().removeChannel(channel);
    };
  }, [refresh, roomId, demo]);
  useEffect(() => {
    if (!data?.isHost || data.canHeartbeat === false || demo) return;
    const beat = () => api("heartbeat", { room_id: roomId }).catch(() => {});
    beat();
    const id = setInterval(beat, 15000);
    return () => clearInterval(id);
  }, [data?.isHost, data?.canHeartbeat, roomId, demo]);
  async function mutate(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<boolean> {
    setError("");
    try {
      if (demo) {
        if (["next_round", "round_control", "room_state"].includes(action)) {
          setData((d) =>
            d
              ? {
                  ...d,
                  myRoundSubmitted:
                    action === "next_round" ? false : d.myRoundSubmitted,
                  room: {
                    ...d.room,
                    ...(action === "next_round"
                      ? {
                          round_number: d.room.round_number + 1,
                          round_open: true,
                          round_prompt: String(payload.prompt || ""),
                        }
                      : action === "round_control"
                        ? { round_open: !!payload.open }
                        : {
                            state: payload.state as Snapshot["room"]["state"],
                          }),
                  },
                }
              : d,
          );
          return true;
        }
        setInfo("체험 화면이에요. 직접 대화방을 만들면 사용할 수 있어요.");
        return true;
      }
      await api(action, { room_id: roomId, ...payload });
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy || !data) return;
    if (
      !data.isHost &&
      !ask &&
      (!data.room.round_open || data.myRoundSubmitted)
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        const m: Message = {
          id: Date.now(),
          room_id: "demo",
          role: ask ? "ai" : data.isHost ? "host" : "member",
          member_id: !ask && !data.isHost ? data.me!.id : null,
          nickname: ask
            ? "이야기별"
            : data.isHost
              ? "진행자"
              : data.me!.nickname,
          avatar: ask ? "⭐" : data.isHost ? "🌷" : data.me!.avatar,
          round_number: data.room.round_number,
          content: ask
            ? "체험용 답변이에요. 서로의 생각에서 공통점을 찾아보고, 함께 실천할 한 가지를 골라 볼까요?"
            : text,
          visibility: "visible",
          created_at: new Date().toISOString(),
        };
        setData((d) =>
          d
            ? {
                ...d,
                myRoundSubmitted: !ask && !d.isHost ? true : d.myRoundSubmitted,
                messages: [...d.messages, m],
              }
            : d,
        );
        setInfo("체험 대화는 이 화면에만 남아요. AI 요약은 예시예요.");
      } else {
        const signature = JSON.stringify([
          roomId,
          text,
          ask,
          stance,
          data.room.round_number,
        ]);
        if (pendingSend.current?.signature !== signature)
          pendingSend.current = { signature, id: crypto.randomUUID() };
        const result = await api<{ visibility?: string }>(
          ask ? "ask_ai" : "message",
          {
            room_id: roomId,
            content: text,
            stance: data?.room.kind === "debate" ? stance : null,
            client_id: pendingSend.current.id,
            expected_round: data.room.round_number,
          },
        );
        if (result.visibility === "held")
          setInfo("이 발언은 안전 확인을 위해 진행자 검토를 기다려요.");
        else if (ask) setInfo("이야기별에게 요청했어요. 잠시 기다려 주세요.");
        await refresh();
      }
      setText("");
      pendingSend.current = null;
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeRound(action: "next_round" | "round_control") {
    if (roundBusy || !data) return;
    setRoundBusy(true);
    const changed = await mutate(action, {
      expected_round: data.room.round_number,
      open: !data.room.round_open,
      prompt: roundPrompt,
    });
    if (changed && action === "next_round") {
      setNextRound(false);
      setRoundPrompt("");
      setInfo("새 차례를 열었어요. 지난 발언은 캐릭터의 기록에 남아 있어요.");
    }
    setRoundBusy(false);
  }
  function openSpeaker(value: Speaker, messageId: number | null = null) {
    setFocusMessage(messageId);
    setSpeaker(value);
  }
  async function exportData() {
    try {
      const snapshot = demo
        ? data
        : await api<Snapshot>("snapshot", { room_id: roomId, export: true });
      if (!snapshot) return;
      const blob = new Blob([transcriptCsv(snapshot)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `다함께이야기-${snapshot.room.title.replace(/[<>:"/\\|?*]/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data)
    return (
      <>
        <Header />
        {error ? (
          <main className="center-state">
            <Mascot />
            <h2>{error}</h2>
            <Link className="button secondary" href="/">
              처음으로 돌아가기
            </Link>
            <button className="text-button" onClick={refresh}>
              다시 연결하기
            </button>
          </main>
        ) : (
          <Loading />
        )}
      </>
    );
  if (waiting)
    return (
      <>
        <Header />
        <main className="center-state">
          <Mascot size={190} />
          <span className="badge yellow">입장 대기 중</span>
          <h1>문을 똑똑, 두드렸어요!</h1>
          <p>
            <b>{data.room.title}</b>의 진행자가 확인하고 있어요.
            <br />
            승인되면 자동으로 대화방에 들어가요.
          </p>
          <Link href="/" className="text-button">
            처음으로 돌아가기
          </Link>
        </main>
      </>
    );
  const { room, isHost, members, messages, summary, praise, me } = data;
  const canAsk = isHost || !!me?.can_ask_ai;
  const active = room.state === "active";
  const submitted =
    !!data.myRoundSubmitted ||
    (!!me &&
      messages.some(
        (m) => m.member_id === me.id && m.round_number === room.round_number,
      ));
  const roundBlocked = !isHost && !ask && (!room.round_open || submitted);
  const sendBlocked =
    !active ||
    !!me?.muted ||
    roundBlocked ||
    (ask && (!canAsk || !data.aiEnabled));
  const historyMessages = speaker ? speakerMessages(messages, speaker) : [];
  const speakerName =
    speaker?.role === "host"
      ? "진행자"
      : speaker?.role === "ai"
        ? "이야기별"
        : members.find((m) => m.id === speaker?.memberId)?.nickname || "참여자";
  const approved = members.filter((m) => m.state === "approved");
  const pending = members.filter((m) => m.state === "waiting");
  const thinking = data.jobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  function summaryItems(items: SummaryItem[]) {
    return items.map((item, i) => (
      <li key={i}>
        {item.text}
        <span className="citations">
          {item.message_ids.map((id) => (
            <button
              key={id}
              title="원문 발언 보기"
              onClick={() => {
                const original = messages.find((m) => m.id === id);
                if (original)
                  openSpeaker(
                    {
                      role: original.member_id
                        ? "member"
                        : original.role === "ai"
                          ? "ai"
                          : "host",
                      memberId: original.member_id || undefined,
                    },
                    id,
                  );
              }}
            >
              #{id}
            </button>
          ))}
        </span>
      </li>
    ));
  }
  return (
    <div className="room-app plaza-room">
      {celebrating && (
        <div className="point-celebration" role="status">
          ✦ 칭찬 별을 받았어요! ✦
        </div>
      )}
      <Header>
        <Link href={demo || !isHost ? "/" : "/dashboard"} className="nav-text">
          <ArrowLeft size={17} /> {demo || !isHost ? "처음으로" : "나의 대화방"}
        </Link>
        {isHost && (
          <button
            className="icon-button"
            onClick={exportData}
            aria-label="기록 CSV 내려받기"
          >
            <Download size={19} />
          </button>
        )}
      </Header>
      {demo && (
        <div className="demo-banner">
          ✦ {isHost ? "진행자" : "참여자"} 체험 · 가상 대화와 예시 요약이에요{" "}
          <button
            className="text-button"
            onClick={() => {
              setData((d) => {
                if (!d) return d;
                const me = d.isHost
                  ? d.members.find((m) => m.id === "h")!
                  : null;
                return {
                  ...d,
                  isHost: !d.isHost,
                  me,
                  myRoundSubmitted:
                    !!me &&
                    d.messages.some(
                      (m) =>
                        m.member_id === me.id &&
                        m.round_number === d.room.round_number,
                    ),
                };
              });
              setAsk(false);
              setTab("chat");
            }}
          >
            {isHost ? "참여자로 체험" : "진행자로 체험"}
          </button>
          <Link href="/login">내 대화방 만들기</Link>
          <button
            className="text-button"
            onClick={() =>
              setData((d) =>
                d
                  ? {
                      ...d,
                      members:
                        d.members.length > 8
                          ? d.members.slice(0, 8)
                          : [
                              ...d.members,
                              ...AVATAR_CATALOG.slice(8, 30).map(
                                (a, index) => ({
                                  id: `extra-${index}`,
                                  user_id: `extra-${index}`,
                                  room_id: "demo",
                                  nickname: a.name,
                                  avatar: a.emoji,
                                  state: "approved",
                                  muted: false,
                                  can_ask_ai: false,
                                }),
                              ),
                            ],
                    }
                  : d,
              )
            }
          >
            {members.length > 8 ? "8명으로 보기" : "30명으로 보기"}
          </button>
        </div>
      )}
      <section className="room-top">
        <div>
          <div className="room-breadcrumb">
            {KINDS[room.kind]} <span>·</span>{" "}
            <span className={"status-badge " + room.state}>
              {STATES[room.state]}
            </span>
          </div>
          <h1>{room.title}</h1>
          <p>{room.topic}</p>
        </div>
        <div className="room-top-actions">
          {isHost && (
            <button
              className="code-chip"
              title="초대 코드 복사"
              onClick={async () => {
                await navigator.clipboard.writeText(room.code);
                setInfo("초대 코드를 복사했어요.");
              }}
            >
              <small>초대 코드</small>
              <b>{room.code}</b>
              <Copy size={16} />
            </button>
          )}
          {isHost && room.state !== "ended" && (
            <button
              className={"button small " + (active ? "secondary" : "primary")}
              onClick={() =>
                mutate("room_state", { state: active ? "paused" : "active" })
              }
            >
              {active ? <Pause size={17} /> : <Play size={17} />}{" "}
              {active ? "잠시 멈춤" : "대화방 열기"}
            </button>
          )}
        </div>
      </section>
      <div className="room-notices">
        <Notice error>{error}</Notice>
        {info && (
          <div className="notice toast" role="status">
            {info}
            <button onClick={() => setInfo("")} aria-label="알림 닫기">
              <X size={15} />
            </button>
          </div>
        )}
        {!active && (
          <Notice>
            {room.state === "ended"
              ? "이야기를 마쳤어요. 기록은 90일 동안 보관돼요."
              : room.state === "draft"
                ? "준비가 되면 ‘대화방 열기’를 눌러 참여자를 초대하세요."
                : "잠시 쉬고 있어요. 진행자가 다시 열면 이야기할 수 있어요."}
          </Notice>
        )}
      </div>
      <nav className="mobile-tabs">
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageCircle size={17} />
          이야기 광장
        </button>
        <button
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          <Sparkles size={17} />
          이야기별 정리
        </button>
        <button
          className={tab === "people" ? "active" : ""}
          onClick={() => setTab("people")}
        >
          <Users size={17} />
          {isHost ? "참여 관리" : "함께하는 사람"}
          {pending.length > 0 && ` · ${pending.length}`}
        </button>
      </nav>
      <main className={`conversation-layout plaza-layout view-${tab}`}>
        <aside
          className={`people-panel panel ${tab === "people" ? "mobile-show" : ""}`}
        >
          <div className="panel-heading">
            <h2>
              <Users size={18} />
              함께하는 사람
            </h2>
            <span className="count">{approved.length}/30</span>
          </div>
          {isHost && pending.length > 0 && (
            <section className="waiting-list">
              <h3>
                똑똑! 입장을 기다려요 <b>{pending.length}</b>
              </h3>
              {pending.map((m) => (
                <div className="waiting-person" key={m.id}>
                  <span className="avatar">{m.avatar}</span>
                  <span>{m.nickname}</span>
                  <button
                    className="icon-button approve"
                    title={`${m.nickname} 입장 승인`}
                    onClick={() =>
                      mutate("member", { member_id: m.id, state: "approved" })
                    }
                  >
                    <Check size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title={`${m.nickname} 입장 거절`}
                    onClick={() =>
                      mutate("member", { member_id: m.id, state: "rejected" })
                    }
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </section>
          )}
          <div className="person">
            <span className="avatar host-avatar">🌷</span>
            <div>
              <b>진행자</b>
              <small>이야기를 이끌어요</small>
            </div>
            <Shield size={15} className="host-shield" />
          </div>
          {approved.map((m) => (
            <div key={m.id} className="person-wrap">
              <div className="person">
                <span className="avatar">{m.avatar}</span>
                <div>
                  <b>
                    {m.nickname}
                    {m.id === me?.id && <em>나</em>}
                  </b>
                  <small>
                    {m.muted
                      ? "잠시 듣는 중"
                      : m.can_ask_ai
                        ? "AI에게 질문할 수 있어요"
                        : "함께 이야기 중"}
                  </small>
                </div>
                {isHost && (
                  <span className="member-points">⭐ {m.points || 0}</span>
                )}
              </div>
              {isHost && (
                <details className="member-options">
                  <summary>{m.nickname} 관리</summary>
                  <div>
                    <button
                      onClick={() =>
                        mutate("member", {
                          member_id: m.id,
                          can_ask_ai: !m.can_ask_ai,
                        })
                      }
                    >
                      {m.can_ask_ai ? "AI 권한 회수" : "AI 권한 주기"}
                    </button>
                    <button
                      onClick={() =>
                        mutate("member", { member_id: m.id, muted: !m.muted })
                      }
                    >
                      {m.muted ? "발언 허용" : "발언 잠시 멈춤"}
                    </button>
                    <button
                      className="danger-text"
                      onClick={() =>
                        mutate("member", { member_id: m.id, state: "kicked" })
                      }
                    >
                      내보내기
                    </button>
                  </div>
                </details>
              )}
            </div>
          ))}
          {approved.length === 0 && (
            <div className="small-empty">
              <span>🐣</span>
              <p>
                친구들을 기다리고 있어요.
                <br />
                초대 코드를 나눠 주세요!
              </p>
            </div>
          )}
          <div className="people-footer">
            <Heart size={17} />
            <p>
              다른 생각에도 귀 기울여요.
              <br />
              모든 이야기가 소중하니까요.
            </p>
          </div>
          {isHost && (
            <details className="room-settings">
              <summary>
                <Settings2 size={16} />
                대화방 설정
              </summary>
              <label htmlFor="ai-mode">이야기별 참여 정도</label>
              <select
                id="ai-mode"
                value={room.ai_mode}
                onChange={(e) =>
                  mutate("room_settings", { ai_mode: e.target.value })
                }
              >
                <option value="off">직접 요청만</option>
                <option value="quiet">조용히 정리</option>
                <option value="balanced">정리와 선택 반응</option>
                <option value="active">조금 더 자주</option>
              </select>
              <button
                className="text-button"
                onClick={() => mutate("rotate_code")}
              >
                <RefreshCw size={14} />
                초대 코드 다시 만들기
              </button>
              {room.state !== "ended" && (
                <button
                  className="text-button danger-text"
                  onClick={() => setConfirm("end")}
                >
                  이야기 마치기
                </button>
              )}
              <button
                className="text-button danger-text"
                onClick={() => setConfirm("delete")}
              >
                대화방 삭제
              </button>
            </details>
          )}
        </aside>
        <section
          className={`chat-panel panel ${tab === "chat" ? "mobile-show" : ""}`}
        >
          <Plaza
            data={data}
            thinking={thinking}
            busy={roundBusy}
            onSpeaker={openSpeaker}
            onLock={() => changeRound("round_control")}
            onNext={() => setNextRound(true)}
          />
          <form className="composer" onSubmit={send}>
            <div className="composer-options">
              <span>
                <Smile size={16} />
                {ask
                  ? "이야기별에게 요청해요"
                  : isHost
                    ? "진행자의 이야기를 전해요"
                    : `${room.round_number}번째 차례 · 한 번의 소중한 생각`}
              </span>
              {canAsk && (
                <button
                  type="button"
                  className={"ai-toggle " + (ask ? "on" : "")}
                  onClick={() => setAsk(!ask)}
                  aria-pressed={ask}
                  disabled={!data.aiEnabled}
                >
                  <Sparkles size={14} />
                  이야기별에게
                </button>
              )}
            </div>
            {room.kind === "debate" && (
              <div className="stance-picker">
                {[
                  ["neutral", "자유 의견"],
                  ["for", "찬성"],
                  ["against", "반대"],
                ].map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    className={stance === v ? "active" : ""}
                    onClick={() => setStance(v)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="composer-input">
              <textarea
                ref={input}
                aria-label={ask ? "AI에게 요청" : "대화 입력"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={
                  !active
                    ? "대화방이 열리면 이야기할 수 있어요"
                    : me?.muted
                      ? "지금은 친구들의 이야기를 들어요"
                      : roundBlocked
                        ? submitted
                          ? "생각을 남겼어요. 다음 차례를 기다려 주세요"
                          : "진행자가 발언을 열면 이야기할 수 있어요"
                        : ask
                          ? "이야기별에게 궁금한 점을 물어보세요"
                          : "나누고 싶은 생각을 적어 주세요…"
                }
                maxLength={2000}
                rows={2}
                disabled={sendBlocked}
              />
              <button
                className="send-button"
                aria-label={ask ? "AI 요청 보내기" : "메시지 보내기"}
                disabled={busy || sendBlocked || !text.trim()}
              >
                <Send size={20} />
              </button>
            </div>
            <div className="composer-hint">
              <span>
                {!isHost && !ask
                  ? "발언은 고정돼요 · 다음 차례에 새 생각을 남겨요"
                  : "Enter 전송 · Shift+Enter 줄바꿈"}
              </span>
              <span>{text.length}/2000</span>
            </div>
          </form>
        </section>
        <aside
          className={`summary-panel panel ${tab === "summary" ? "mobile-show" : ""}`}
        >
          <div className="summary-heading">
            <Mascot size={62} />
            <div>
              <h2>이야기별의 노트</h2>
              <p>우리의 생각을 차곡차곡</p>
            </div>
            <Sparkles size={18} />
          </div>
          {canAsk && (
            <div className="ai-quick-actions" aria-label="이야기별에게 요청">
              {[
                [
                  "진행 도와줘",
                  "현재 차례의 대화를 자연스럽게 이어갈 진행 멘트를 제안해 줘.",
                ],
                [
                  "요약해 줘",
                  "지금까지의 주요 의견, 근거, 공통점과 차이를 정리해 줘.",
                ],
                [
                  "질문 제안",
                  "이번 차례에서 더 생각해 볼 질문 하나를 제안해 줘.",
                ],
              ].map(([label, prompt]) => (
                <button
                  key={label}
                  disabled={!active || !data.aiEnabled || busy || !!me?.muted}
                  onClick={async () => {
                    setBusy(true);
                    await mutate("ask_ai", {
                      content: prompt,
                      client_id: crypto.randomUUID(),
                    });
                    setBusy(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="side-tabs">
            <button
              className={side === "summary" ? "active" : ""}
              onClick={() => setSide("summary")}
            >
              이야기 정리
            </button>
            <button
              className={side === "praise" ? "active" : ""}
              onClick={() => setSide("praise")}
            >
              칭찬 별{" "}
              {isHost &&
                praise.filter((p) => p.status === "suggested").length > 0 && (
                  <b>{praise.filter((p) => p.status === "suggested").length}</b>
                )}
            </button>
          </div>
          <div className="summary-body">
            {side === "summary" ? (
              <>
                {!data.aiEnabled && (
                  <div className="ai-ready">
                    ⭐ 이야기별이 준비 중이에요.
                    <br />
                    일반 대화는 계속할 수 있어요.
                  </div>
                )}
                {room.ai_error && <Notice>{room.ai_error}</Notice>}
                {summary ? (
                  <>
                    <p className="summary-overview">
                      {summary.content.overview}
                    </p>
                    <section className="summary-section">
                      <h3>💡 이런 생각이 나왔어요</h3>
                      <ul>{summaryItems(summary.content.opinions)}</ul>
                    </section>
                    <section className="summary-section mint-note">
                      <h3>🤝 함께 고개를 끄덕인 생각</h3>
                      <ul>{summaryItems(summary.content.agreements)}</ul>
                    </section>
                    <section className="summary-section pink-note">
                      <h3>🌱 조금 다른 생각</h3>
                      <ul>{summaryItems(summary.content.differences)}</ul>
                    </section>
                    <section className="summary-section yellow-note">
                      <h3>❓ 더 이야기해 볼까요?</h3>
                      <ul>
                        {summary.content.questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </section>
                    <p className="summary-footnote">
                      AI가 정리한 내용이에요. 원문과 함께 확인해 주세요.
                    </p>
                  </>
                ) : (
                  <div className="small-empty">
                    <Mascot size={120} />
                    <h3>어떤 생각이 모일까요?</h3>
                    <p>
                      대화가 쌓이면 이야기별이
                      <br />
                      핵심을 보기 좋게 정리해 줘요.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {!isHost && (
                  <div className="my-points">
                    <Star fill="currentColor" />
                    <span>나의 칭찬 별</span>
                    <b>{data.myPoints}</b>
                  </div>
                )}
                {praise
                  .filter((p) =>
                    isHost ? p.status !== "dismissed" : p.status === "awarded",
                  )
                  .map((p) => (
                    <div key={p.id} className={"praise-card " + p.status}>
                      <span className="praise-star">✦</span>
                      <small>
                        {p.status === "suggested"
                          ? "이야기별의 칭찬 추천"
                          : p.status === "revoked"
                            ? "지급 취소"
                            : "칭찬 별을 받았어요!"}
                      </small>
                      <h3>
                        {members.find((m) => m.id === p.member_id)?.avatar}{" "}
                        {members.find((m) => m.id === p.member_id)?.nickname}
                      </h3>
                      <b>{CATEGORIES[p.category]}</b>
                      <p>{p.reason}</p>
                      {isHost && (
                        <div className="praise-actions">
                          {p.status === "suggested" ? (
                            <>
                              <button
                                className="button small primary"
                                onClick={() =>
                                  mutate("praise_status", {
                                    praise_id: p.id,
                                    status: "awarded",
                                  })
                                }
                              >
                                ⭐ 1점 주기
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  mutate("praise_status", {
                                    praise_id: p.id,
                                    status: "dismissed",
                                  })
                                }
                              >
                                넘기기
                              </button>
                            </>
                          ) : p.status === "awarded" ? (
                            <button
                              className="text-button"
                              onClick={() =>
                                mutate("praise_status", {
                                  praise_id: p.id,
                                  status: "revoked",
                                })
                              }
                            >
                              지급 취소
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                {praise.length === 0 && (
                  <div className="small-empty">
                    <span>🌟</span>
                    <h3>따뜻한 칭찬을 기다려요</h3>
                    <p>
                      좋은 질문, 근거, 경청, 배려에
                      <br />
                      칭찬 별을 선물할 수 있어요.
                    </p>
                  </div>
                )}
              </>
            )}
            {isHost && data.reports.length > 0 && (
              <section className="report-list">
                <h3>확인이 필요한 신고</h3>
                {data.reports.map((r) => (
                  <div key={r.id}>
                    <p>
                      #{r.message_id} · {r.reason}
                    </p>
                    <button
                      className="text-button"
                      onClick={() =>
                        mutate("resolve_report", { report_id: r.id })
                      }
                    >
                      확인 완료
                    </button>
                  </div>
                ))}
              </section>
            )}
          </div>
        </aside>
      </main>
      {speaker && (
        <Modal
          title={speakerName + "의 이야기 모음"}
          close={() => setSpeaker(null)}
        >
          <p>
            모든 차례의 발언을 차곡차곡 모았어요. 총 {historyMessages.length}개
          </p>
          <div className="speaker-history">
            {!historyMessages.length && (
              <div className="history-empty">
                ☁️
                <p>
                  아직 공개된 발언이 없어요.
                  <br />
                  생각을 남기면 이곳에서 다시 볼 수 있어요.
                </p>
              </div>
            )}
            {historyMessages.map((m) => (
              <article
                id={"message-" + m.id}
                key={m.id}
                className={`message ${focusMessage === m.id ? "focused-message" : ""} ${m.role === "ai" ? "ai-message" : ""} ${m.visibility !== "visible" ? "held-message" : ""}`}
              >
                <span className="avatar">{m.avatar}</span>
                <div className="message-main">
                  <div className="message-meta">
                    <b>{m.nickname}</b>
                    {m.role === "host" && (
                      <span className="role-label">진행자</span>
                    )}
                    {m.role === "ai" && (
                      <span className="role-label ai">AI 친구</span>
                    )}
                    <span className="history-round">
                      {m.round_number
                        ? `${m.round_number}번째 차례`
                        : "이전 기록"}
                    </span>
                    <time>
                      {new Date(m.created_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="message-bubble">
                    {m.stance && m.stance !== "neutral" && (
                      <span className={"stance " + m.stance}>
                        {m.stance === "for" ? "찬성 의견" : "반대 의견"}
                      </span>
                    )}
                    {m.content}
                  </div>
                  {m.visibility !== "visible" && (
                    <div className="held-label">
                      {m.visibility === "held"
                        ? `검토 대기 · ${m.safety_reason || ""}`
                        : "숨긴 발언"}
                      {isHost && (
                        <button
                          onClick={() =>
                            mutate("message_visibility", {
                              message_id: m.id,
                              visibility: "visible",
                            })
                          }
                        >
                          공개하기
                        </button>
                      )}
                    </div>
                  )}
                  <div className="message-actions">
                    {isHost && m.member_id && (
                      <button
                        onClick={() => {
                          setSelected({ message: m, type: "praise" });
                          setReason("");
                        }}
                      >
                        <Star size={13} />
                        칭찬하기
                      </button>
                    )}
                    {isHost && m.visibility === "visible" && (
                      <button
                        onClick={() =>
                          mutate("message_visibility", {
                            message_id: m.id,
                            visibility: "hidden",
                          })
                        }
                      >
                        <EyeOff size={13} />
                        숨기기
                      </button>
                    )}
                    {!isHost && m.visibility === "visible" && (
                      <button
                        onClick={() => {
                          setSelected({ message: m, type: "report" });
                          setReason("");
                        }}
                      >
                        <Flag size={13} />
                        신고
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {nextRound && (
        <Modal
          title={room.round_number + 1 + "번째 차례를 열까요?"}
          close={() => setNextRound(false)}
        >
          <p>
            지금의 말풍선은 발언 기록에 보관하고, 모두가 한 번씩 다시 이야기할
            수 있어요.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changeRound("next_round");
            }}
          >
            <label htmlFor="round-prompt">
              이번에 함께 생각할 질문 <span className="subtle">(선택)</span>
            </label>
            <textarea
              id="round-prompt"
              rows={3}
              value={roundPrompt}
              onChange={(e) => setRoundPrompt(e.target.value)}
              maxLength={500}
              placeholder="예: 이 생각을 함께 실천하려면 무엇이 필요할까요?"
            />
            <button className="button primary full" disabled={roundBusy}>
              {roundBusy ? "차례를 여는 중…" : "새 차례 열기"}
            </button>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={
            selected.type === "praise"
              ? "따뜻한 칭찬을 선물해요"
              : "진행자에게 알려 주세요"
          }
          close={() => setSelected(null)}
        >
          <blockquote>{selected.message.content}</blockquote>
          <Notice error>{error}</Notice>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(selected.type === "praise" ? "praise" : "report", {
                  message_id: selected.message.id,
                  category,
                  reason,
                })
              )
                setSelected(null);
            }}
          >
            {selected.type === "praise" && (
              <>
                <label htmlFor="category">칭찬의 이유</label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(CATEGORIES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="reason">
              {selected.type === "praise"
                ? "칭찬 한마디"
                : "어떤 점이 불편했나요?"}
            </label>
            <textarea
              id="reason"
              required
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button className="button primary full">
              {selected.type === "praise"
                ? "칭찬 별 1점 선물하기"
                : "신고 보내기"}
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm === "end" ? "이야기를 마칠까요?" : "대화방을 삭제할까요?"
          }
          close={() => setConfirm(null)}
        >
          <p>
            {confirm === "end"
              ? "참여자의 접속이 종료되고 기록은 90일 동안 보관돼요. 종료한 방은 다시 열 수 없어요."
              : "발언, AI 요약, 포인트 기록이 함께 삭제되며 복구할 수 없어요."}
          </p>
          <Notice error>{error}</Notice>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              돌아가기
            </button>
            <button
              className="button danger"
              onClick={async () => {
                if (
                  await mutate(
                    confirm === "end" ? "room_state" : "delete_room",
                    { state: "ended" },
                  )
                ) {
                  setConfirm(null);
                  if (confirm === "delete" && !demo)
                    window.location.href = "/dashboard";
                }
              }}
            >
              {confirm === "end" ? "이야기 마치기" : "삭제하기"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
