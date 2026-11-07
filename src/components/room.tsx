"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  QrCode,
  Download,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Pause,
  Pencil,
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
import { api as userApi, adminApi, supabase } from "@/lib/supabase";
import {
  CATEGORIES,
  KINDS,
  STATES,
  transcriptCsv,
  type Message,
  type Room,
  type Snapshot,
  type SummaryItem,
} from "@/lib/domain";
import { Header, Loading, Mascot, Modal, Notice } from "./ui";
import { Plaza } from "./plaza";
import { PraiseBoard } from "./praise-board";
import { PresenterPicker } from "./presenter-picker";
import { InviteDialog } from "./invite-dialog";
import { DiscussionReview } from "./discussion-review";
import { RoundOpinions } from "./round-opinions";
import { speakerMessages, type Speaker } from "@/lib/plaza";
import { aiRequestAllowed, clearSentDraft } from "@/lib/composer";
import { AVATAR_CATALOG } from "../../supabase/functions/story-api/avatars";

type RoomVersion = Pick<Room, "revision" | "state" | "messages_epoch" | "ai_error">;

function sameRoomVersion(left: RoomVersion, right: RoomVersion) {
  return left.revision === right.revision &&
    left.state === right.state &&
    left.messages_epoch === right.messages_epoch &&
    left.ai_error === right.ai_error;
}

function sameOpinionRound(left: Room, right: Room) {
  return left.id === right.id &&
    left.state === right.state &&
    left.round_number === right.round_number &&
    left.messages_epoch === right.messages_epoch;
}

export function RoomView({
  roomId,
  initial,
  demo = false,
  adminView = false,
}: {
  roomId: string;
  initial?: Snapshot;
  demo?: boolean;
  adminView?: boolean;
}) {
  const api = adminView ? adminApi : userApi;
  const [snapshot, setData] = useState<Snapshot | null>(initial || null);
  const [liveOpinions, setLiveOpinions] = useState<Message[]>([]);
  const snapshotRef = useRef<Snapshot | null>(null);
  const realtimeRoom = useRef<Room | null>(null);
  const invalidatedOpinions = useRef(new Set<number>());
  // Only the server snapshot advances the cursor. A missed Realtime event can
  // still arrive in the next snapshot, even if later opinions are on screen.
  const data = useMemo(() => {
    if (!snapshot?.isHost || !snapshot.canHeartbeat ||
        snapshot.room.state !== "active" || !liveOpinions.length)
      return snapshot;
    const known = new Set(snapshot.messages.map((message) => message.id));
    const additions = liveOpinions.filter(
      (message) => message.round_number === snapshot.room.round_number && !known.has(message.id),
    );
    if (!additions.length) return snapshot;
    return {
      ...snapshot,
      messages: [...snapshot.messages, ...additions].sort((a, b) => a.id - b.id),
    };
  }, [snapshot, liveOpinions]);
  const confirmedRoom = useRef<Pick<Room, "id" | "revision"> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [info, setInfo] = useState("");
  const [inviteOrigin, setInviteOrigin] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [text, setText] = useState("");
  const [ask, setAsk] = useState(false);
  const [stance, setStance] = useState("neutral");
  const [editDraft, setEditDraft] = useState<{
    original: Message;
    content: string;
    stance: string;
  } | null>(null);
  const [pendingOpinion, setPendingOpinion] = useState<{
    content: string;
    edit: boolean;
  } | null>(null);
  const [tab, setTab] = useState("chat");
  const [side, setSide] = useState("summary");
  const [reviewRecords, setReviewRecords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [selected, setSelected] = useState<{
    message: Message;
    type: "praise" | "report";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [category, setCategory] = useState("reason");
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const [roundOpinions, setRoundOpinions] = useState(false);
  const [focusMessage, setFocusMessage] = useState<number | null>(null);
  const [nextRound, setNextRound] = useState(false);
  const [roundBusy, setRoundBusy] = useState(false);
  const [pickingPresenters, setPickingPresenters] = useState(false);
  const topicRef = useRef<HTMLElement>(null);
  const [topicHeight, setTopicHeight] = useState(100);
  useEffect(() => {
    const element = topicRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setTopicHeight(Math.ceil(element.getBoundingClientRect().height)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [data?.room.id, waiting]);
  useEffect(() => {
    if (!speaker || !focusMessage) return;
    document
      .getElementById("message-" + focusMessage)
      ?.scrollIntoView({ block: "nearest" });
  }, [speaker, focusMessage]);
  useEffect(() => {
    if (data && !aiRequestAllowed(data))
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
    setCelebrating(false);
    previousPoints.current = points;
  }, [data?.myPoints]);
  const refresh = useCallback(async () => {
    if (demo) return;
    if (refreshInFlight.current) {
      refreshAgain.current = true;
      return refreshInFlight.current;
    }
    const run = async () => {
      do {
        refreshAgain.current = false;
        try {
          const previous = snapshotRef.current;
          const result = await api<Snapshot & { waiting?: boolean; unchanged?: boolean }>("snapshot", {
            room_id: roomId,
            ...(previous?.room.id === roomId && previous.messages ? {
              sync: {
                after: previous.messages.at(-1)?.id || 0,
                epoch: previous.room.messages_epoch,
                host: previous.isHost,
                version: previous.version,
              },
            } : {}),
          });
          if (result.unchanged) {
            setError("");
            continue;
          }
          if (
            !result.waiting &&
            confirmedRoom.current?.id === result.room.id &&
            result.room.revision < confirmedRoom.current.revision
          ) continue;
          const observedRoom = realtimeRoom.current;
          if (
            result.isHost && result.canHeartbeat && observedRoom &&
            result.room.revision < observedRoom.revision &&
            !sameOpinionRound(result.room, observedRoom)
          ) continue;
          if (result.messagesReset === false && previous?.room.id === roomId) {
            const messages = new Map(previous.messages.map((message) => [message.id, message]));
            for (const message of result.messages) messages.set(message.id, message);
            result.messages = [...messages.values()].sort((a, b) => a.id - b.id);
          }
          snapshotRef.current = result;
          setLiveOpinions((current) => {
            if (!current.length) return current;
            if (!result.isHost || !result.canHeartbeat || !previous ||
                !sameOpinionRound(previous.room, result.room))
              return [];
            const received = new Set(result.messages.map((message) => message.id));
            return current.filter((message) => !received.has(message.id));
          });
          setSelected((current) => {
            if (!current) return null;
            const latest = result.messages?.find((message) => message.id === current.message.id);
            if (!latest) return result.isHost ? current : null;
            return (latest.edit_client_id ?? null) === (current.message.edit_client_id ?? null)
              ? current
              : null;
          });
          setWaiting(!!result.waiting);
          setData(result);
          setError("");
        } catch (e) {
          setError((e as Error).message);
          setData(null);
          setLiveOpinions([]);
          snapshotRef.current = null;
        }
      } while (refreshAgain.current);
    };
    refreshInFlight.current = run();
    try {
      await refreshInFlight.current;
    } finally {
      refreshInFlight.current = null;
    }
  }, [roomId, demo, api]);
  const realtimeRole = snapshot?.room.id === roomId
    ? snapshot.isHost ? "host" : "member"
    : null;
  useEffect(() => {
    if (snapshotRef.current?.room.id !== roomId) void refresh();
    if (demo) return;
    const client = supabase();
    const interval = setInterval(refresh, 14000 + Math.random() * 2000);
    let disposed = false;
    let channel: RealtimeChannel | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (disposed || timeout !== undefined) return;
      timeout = setTimeout(() => {
        timeout = undefined;
        void refresh();
      }, 100);
    };
    const subscribe = async () => {
      if (!realtimeRole) return;
      const { data: { session } } = await client.auth.getSession();
      if (!session || disposed) return;
      await client.realtime.setAuth(session.access_token);
      if (disposed) return;
      const roomChannel = client.channel("room:" + roomId, {
        config: { postgres_changes_options: { wait: true } },
      });
      channel = roomChannel;
      roomChannel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          ({ eventType, new: changedRoom }: RealtimePostgresChangesPayload<Room>) => {
            const current = snapshotRef.current?.room;
            if (
              eventType === "UPDATE" && changedRoom.id === roomId &&
              changedRoom.revision >= (realtimeRoom.current?.revision ?? -1) &&
              changedRoom.revision >= (current?.revision ?? -1)
            ) {
              realtimeRoom.current = changedRoom;
              if (current && !sameOpinionRound(changedRoom, current))
                setLiveOpinions((opinions) => opinions.length ? [] : opinions);
            }
            // A heartbeat updates host_seen_at without changing the displayed room.
            if (eventType === "UPDATE" && current?.id === roomId && sameRoomVersion(changedRoom, current))
              return;
            scheduleRefresh();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "members", filter: `room_id=eq.${roomId}` },
          scheduleRefresh,
        );
      // Every saved opinion also changes the room revision. Participants need
      // that one signal; only teachers use message rows for immediate previews.
      if (realtimeRole === "host") roomChannel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
          (change: RealtimePostgresChangesPayload<Message>) => {
            const current = snapshotRef.current;
            if (current?.isHost && current.canHeartbeat && current.room.state === "active") {
              if (change.eventType === "INSERT") {
                const opinion = change.new;
                const observed = realtimeRoom.current;
                if (
                  opinion.room_id === roomId && opinion.role === "member" &&
                  opinion.visibility === "visible" && opinion.member_id &&
                  Number.isSafeInteger(opinion.id) &&
                  !invalidatedOpinions.current.has(opinion.id) &&
                  opinion.round_number === current.room.round_number &&
                  !current.messages.some((message) => message.id === opinion.id) &&
                  (!observed || observed.revision < current.room.revision ||
                    sameOpinionRound(current.room, observed))
                ) {
                  const liveOpinion: Message = {
                    id: opinion.id, room_id: opinion.room_id, role: opinion.role,
                    member_id: opinion.member_id, nickname: opinion.nickname, avatar: opinion.avatar,
                    content: opinion.content, stance: opinion.stance, visibility: opinion.visibility,
                    round_number: opinion.round_number, created_at: opinion.created_at,
                  };
                  setLiveOpinions((opinions) =>
                    opinions.some((message) => message.id === liveOpinion.id)
                      ? opinions
                      : [...opinions, liveOpinion],
                  );
                }
              } else {
                const id = change.eventType === "UPDATE" ? change.new.id : change.old.id;
                if (id != null) invalidatedOpinions.current.add(id);
                setLiveOpinions((opinions) => opinions.some((message) => message.id === id)
                  ? opinions.filter((message) => message.id !== id)
                  : opinions);
              }
            }
            scheduleRefresh();
          },
        );
      roomChannel.subscribe((status: string) => {
          if (!disposed) setLiveOpinions((opinions) => opinions.length ? [] : opinions);
          if (status === "SUBSCRIBED") scheduleRefresh();
        });
    };
    void subscribe().catch(() => {});
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(timeout);
      if (channel) void client.removeChannel(channel);
    };
  }, [refresh, roomId, demo, realtimeRole]);
  const streamOpinions = !demo && !adminView && snapshot?.isHost === true &&
    snapshot.canHeartbeat === true && snapshot.room.state === "active";
  useEffect(() => {
    if (!streamOpinions) return;
    const client = supabase();
    let disposed = false;
    let generation = 0;
    let viewerId = "";
    let channel: RealtimeChannel | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    const pending = new Set<number>();
    const scheduleRead = () => {
      if (disposed || reading || timer !== undefined || !pending.size) return;
      timer = setTimeout(() => { timer = undefined; void readOpinions(); }, 25);
    };
    // Broadcast carries identifiers only. The RPC rechecks the current session
    // and owning teacher once, then returns visible opinions in one snapshot.
    const readOpinions = async () => {
      const ids = [...pending].slice(0, 100);
      for (const id of ids) pending.delete(id);
      const version = generation;
      reading = true;
      try {
        const { data: result, error } = await client.rpc("story_teacher_opinions", {
          p_room: roomId, p_ids: ids,
        });
        if (disposed || version !== generation) return;
        const current = snapshotRef.current;
        if (error || !result || result.room?.owner_id !== viewerId ||
            result.room?.id !== roomId || !current?.isHost || !current.canHeartbeat) {
          setLiveOpinions([]);
          void refresh();
          return;
        }
        const { messages, room } = result as { room: Room; messages: Message[] };
        if (room.revision >= (realtimeRoom.current?.revision ?? -1))
          realtimeRoom.current = room as Room;
        if (!sameOpinionRound(current.room, room as Room) || room.state !== "active") {
          setLiveOpinions([]);
          void refresh();
          return;
        }
        const observed = realtimeRoom.current;
        if (observed && !sameOpinionRound(room as Room, observed)) return;
        const additions = (messages as Message[]).filter((message) =>
          message.round_number === room.round_number && message.member_id &&
          !invalidatedOpinions.current.has(message.id) &&
          !current.messages.some((known) => known.id === message.id),
        );
        setLiveOpinions((opinions) => {
          const merged = new Map(opinions.map((message) => [message.id, message]));
          for (const message of additions) merged.set(message.id, message);
          return [...merged.values()];
        });
      } catch {
        // Regular authenticated snapshots and Postgres Changes remain available.
        if (!disposed) void refresh();
      } finally {
        reading = false;
        scheduleRead();
      }
    };
    const subscribe = async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session || disposed) return;
      viewerId = session.user.id;
      await client.realtime.setAuth(session.access_token);
      if (disposed) return;
      channel = client.channel(`story-room:${roomId}:opinions`, { config: { private: true } })
        .on("broadcast", { event: "opinion_changed" }, ({ payload }: { payload: {
          room_id?: string; message_id: number; operation?: string; round_number?: number;
        } }) => {
          if (disposed || payload?.room_id !== roomId || !Number.isSafeInteger(payload.message_id)) return;
          if (payload.operation !== "INSERT") {
            generation += 1;
            invalidatedOpinions.current.add(payload.message_id);
            pending.delete(payload.message_id);
            setLiveOpinions((opinions) => opinions.filter((message) => message.id !== payload.message_id));
            void refresh();
            return;
          }
          const current = snapshotRef.current;
          if (current?.room.round_number !== payload.round_number ||
              invalidatedOpinions.current.has(payload.message_id)) return;
          pending.add(payload.message_id);
          scheduleRead();
        })
        .on("broadcast", { event: "room_changed" }, ({ payload }: { payload: {
          room_id?: string; messages_epoch: number; round_number: number;
          state: Room["state"]; round_open: boolean; revision: number;
        } }) => {
          const current = snapshotRef.current?.room;
          if (payload?.room_id !== roomId || !current ||
              !Number.isSafeInteger(payload.revision) ||
              payload.revision < current.revision ||
              payload.revision < (realtimeRoom.current?.revision ?? -1)) return;
          realtimeRoom.current = { ...current, ...payload, id: roomId };
          generation += 1;
          pending.clear();
          setLiveOpinions([]);
          void refresh();
        })
        .subscribe((status: string) => {
          if (disposed || status === "SUBSCRIBED") return;
          generation += 1;
          pending.clear();
          setLiveOpinions([]);
        });
    };
    void subscribe().catch(() => {});
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (channel) void client.removeChannel(channel);
    };
  }, [streamOpinions, refresh, roomId]);
  const probeRoomChanges = !demo && data?.canHeartbeat === true && data.room.state === "active" &&
    data.members.some((member) => member.state === "approved");
  useEffect(() => {
    if (!probeRoomChanges) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    // If Realtime is slow, one lightweight RLS-protected lookup per teacher
    // detects new activity without requesting a full snapshot on every tick.
    const probe = async () => {
      try {
        if (document.hidden || refreshInFlight.current) return;
        const { data: version, error } = await supabase()
          .from("rooms")
          .select("revision,state,messages_epoch,ai_error")
          .eq("id", roomId)
          .maybeSingle();
        const current = snapshotRef.current?.room;
        if (!disposed && !error && current?.id === roomId &&
          (!version || !sameRoomVersion(version, current))) void refresh();
      } catch {
        // The regular snapshot remains available when the version lookup fails.
      } finally {
        if (!disposed) timer = setTimeout(probe, 2000);
      }
    };
    timer = setTimeout(probe, 2000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [probeRoomChanges, refresh, roomId]);
  useEffect(() => {
    if (!data?.isHost || data.canHeartbeat === false || demo) return;
    const beat = () => api("heartbeat", { room_id: roomId }).catch(() => {});
    beat();
    const id = setInterval(beat, 15000);
    return () => clearInterval(id);
  }, [data?.isHost, data?.canHeartbeat, roomId, demo, api]);
  async function mutate(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<boolean> {
    setError("");
    try {
      if (demo) {
        if (action === "request_summary" || action === "review_retry") {
          setData((d) => {
            if (!d || !d.isHost) return d;
            const opinions = d.messages.filter(
              (message) => message.role === "member" && message.visibility === "visible",
            );
            return {
              ...d,
              summary: {
                created_at: new Date().toISOString(),
                is_final: action === "review_retry",
                content: {
                  overview: `체험 대화에서 나눈 의견 ${opinions.length}개를 모았어요.`,
                  opinions: opinions.slice(-4).map((message) => ({
                    text: message.content,
                    message_ids: [message.id],
                  })),
                  agreements: [],
                  differences: [],
                  questions: [],
                  reply: "",
                },
              },
            };
          });
          return true;
        }
        if (["praise", "praise_status"].includes(action)) {
          setData((d) => {
            if (!d || !d.isHost) return d;
            let cards = [...d.praise];
            if (action === "praise_status")
              cards = cards.map((p) =>
                p.id === payload.praise_id
                  ? { ...p, status: String(payload.status) }
                  : p,
              );
            else {
              const message = d.messages.find(
                (m) =>
                  m.id === payload.message_id &&
                  m.visibility === "visible" &&
                  m.member_id,
              );
              if (!message) return d;
              const existing = cards.find(
                (p) =>
                  p.message_id === message.id &&
                  p.category === payload.category,
              );
              if (existing)
                cards = cards.map((p) =>
                  p.id === existing.id
                    ? {
                        ...p,
                        status: "awarded",
                        reason: String(payload.reason),
                      }
                    : p,
                );
              else
                cards.unshift({
                  id: crypto.randomUUID(),
                  member_id: message.member_id!,
                  message_id: message.id,
                  category: payload.category as keyof typeof CATEGORIES,
                  reason: String(payload.reason),
                  status: "awarded",
                  created_at: new Date().toISOString(),
                });
            }
            return {
              ...d,
              praise: cards,
              members: d.members.map((m) => ({
                ...m,
                points: cards.filter(
                  (p) => p.member_id === m.id && p.status === "awarded",
                ).length,
              })),
              myPoints: d.me
                ? cards.filter(
                    (p) => p.member_id === d.me!.id && p.status === "awarded",
                  ).length
                : 0,
            };
          });
          return true;
        }
        if (
          [
            "next_round",
            "presentation_start",
            "round_control",
            "room_state",
          ].includes(action)
        ) {
          setData((d) =>
            d
              ? {
                  ...d,
                  myRoundSubmitted: [
                    "next_round",
                    "presentation_start",
                  ].includes(action)
                    ? false
                    : d.myRoundSubmitted,
                  room: {
                    ...d.room,
                    ...(["next_round", "presentation_start"].includes(action)
                      ? {
                          round_number: d.room.round_number + 1,
                          round_open: true,
                          round_prompt: String(payload.prompt || ""),
                          speaker_ids:
                            action === "presentation_start"
                              ? (payload.member_ids as string[])
                              : null,
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
      const result = await api<{ room?: Room }>(action, { room_id: roomId, ...payload });
      const savedRoom = result?.room;
      if (savedRoom?.id === roomId && savedRoom.state !== "ended") {
        const confirmed = confirmedRoom.current;
        if (confirmed?.id !== roomId || savedRoom.revision > confirmed.revision)
          confirmedRoom.current = savedRoom;
        setData((current) =>
          current?.room.id === roomId && savedRoom.revision > current.room.revision
            ? { ...current, room: savedRoom }
            : current,
        );
        void refresh();
      } else {
        await refresh();
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!data || busy || sendBlocked || editConflict || editUnchanged || !composerText.trim())
      return;
    const content = composerText;
    const messageStance = data.room.kind === "debate" ? composerStance : null;
    const isAiRequest = ask && !editing;
    setBusy(true);
    setSendError("");
    setInfo("");
    if (!isAiRequest) setPendingOpinion({ content, edit: !!editing });
    try {
      if (demo) {
        const m: Message = editing ? {
          ...editing.original,
          content,
          stance: messageStance ?? undefined,
          edited_at: new Date().toISOString(),
          edit_client_id: crypto.randomUUID(),
        } : {
          id: Date.now(),
          room_id: "demo",
          role: isAiRequest ? "ai" : data.isHost ? "host" : "member",
          member_id: !isAiRequest && !data.isHost ? data.me!.id : null,
          nickname: isAiRequest
            ? "이야기별"
            : data.isHost
              ? "진행자"
              : data.me!.nickname,
          avatar: isAiRequest ? "⭐" : data.isHost ? "🌷" : data.me!.avatar,
          round_number: data.room.round_number,
          content: isAiRequest
            ? "체험용 답변이에요. 서로의 생각에서 공통점을 찾아보고, 함께 실천할 한 가지를 골라 볼까요?"
            : content,
          stance: messageStance ?? undefined,
          visibility: "visible",
          created_at: new Date().toISOString(),
        };
        setData((d) =>
          d
            ? {
                ...d,
                myRoundSubmitted: !isAiRequest && !d.isHost ? true : d.myRoundSubmitted,
                messages: editing
                  ? d.messages.map((message) => message.id === m.id ? m : message)
                  : [...d.messages, m],
                summary: editing ? null : d.summary,
              }
            : d,
        );
        setInfo(editing ? "체험 의견을 수정했어요." : "체험 대화는 이 화면에만 남아요.");
      } else {
        const signature = JSON.stringify([
          roomId,
          content,
          isAiRequest,
          messageStance,
          data.room.round_number,
          editing?.original.id,
          editing?.original.edit_client_id,
        ]);
        if (pendingSend.current?.signature !== signature)
          pendingSend.current = { signature, id: crypto.randomUUID() };
        const result = await api<{ visibility?: string; safety_reason?: string }>(
          editing ? "edit_message" : isAiRequest ? "ask_ai" : "message",
          {
            room_id: roomId,
            content,
            stance: messageStance,
            client_id: pendingSend.current.id,
            expected_round: data.room.round_number,
            ...(editing ? {
              message_id: editing.original.id,
              expected_edit_id: editing.original.edit_client_id ?? null,
            } : {}),
          },
        );
        setPendingOpinion(null);
        if (result.visibility === "held")
          setInfo("저장했어요. 진행자가 안전을 확인한 뒤 의견이 공개돼요.");
        else if (result.safety_reason)
          setInfo("저장했어요. 외부 안전 검사가 지연되어 기본 검사를 적용했어요.");
        else if (isAiRequest) setInfo("이야기별에게 요청했어요. 잠시 기다려 주세요.");
        else if (editing) setInfo("의견을 수정했어요.");
        else setInfo("의견을 저장했어요.");
        await refresh();
      }
      if (editing) setEditDraft(null);
      else setText((current) => clearSentDraft(current, content));
      pendingSend.current = null;
      input.current?.focus();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setPendingOpinion(null);
      setBusy(false);
    }
  }
  async function changeRound(action: "next_round" | "round_control") {
    if (roundBusy || !data) return;
    setRoundBusy(true);
    const changed = await mutate(action, {
      expected_round: data.room.round_number,
      open: !data.room.round_open,
    });
    if (changed && action === "next_round") {
      setNextRound(false);
      setInfo(
        "같은 주제로 대화를 이어가요. 자유로운 순서로 다시 이야기할 수 있어요.",
      );
    }
    setRoundBusy(false);
  }
  async function startPresentation(memberIds: string[]) {
    if (!data?.isHost || roundBusy) return;
    setRoundBusy(true);
    const changed = await mutate("presentation_start", {
      expected_round: data.room.round_number,
      member_ids: memberIds,
    });
    if (changed) {
      setPickingPresenters(false);
      setInfo(
        "선택한 친구들의 발표를 시작했어요. 교사는 언제든 함께 말할 수 있어요.",
      );
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
  if (data.room.state === "ended" && (!data.isHost || !reviewRecords)) return <DiscussionReview data={data} demo={demo} records={() => setReviewRecords(true)} retry={async () => {if (!await mutate("review_retry")) throw new Error("최종 요약을 요청하지 못했어요. AI 연결 상태를 확인하고 다시 시도해 주세요.");}} />;
  const { room, isHost, members, messages, summary, praise, me } = data;
  const canAsk = isHost || !!me?.can_ask_ai;
  const active = room.state === "active";
  const currentOpinion = me && (data.myRoundMessage ?? messages.find(
    (m) => m.role === "member" && m.member_id === me.id && m.round_number === room.round_number,
  ));
  const submitted = !!data.myRoundSubmitted || !!currentOpinion;
  const listening =
    !!room.speaker_ids && !room.speaker_ids.includes(me?.id || "");
  const editableOpinion =
    !isHost && me?.state === "approved" && !me.muted &&
    active && room.round_open && !listening &&
    currentOpinion &&
    ["visible", "held"].includes(currentOpinion.visibility)
      ? currentOpinion
      : null;
  const editing = editableOpinion && editDraft?.original.id === editableOpinion.id
    ? editDraft
    : null;
  const composerText = editing?.content ?? text;
  const composerStance = editing?.stance ?? stance;
  const editConflict = !!editing &&
    (editableOpinion?.edit_client_id ?? null) !== (editing.original.edit_client_id ?? null) &&
    editableOpinion?.edit_client_id !== pendingSend.current?.id;
  const editUnchanged = !!editing &&
    editing.content.trim() === editing.original.content.trim() &&
    editing.stance === (editing.original.stance ?? "neutral");
  const roundBlocked =
    !isHost && !ask && (!room.round_open || (submitted && !editing) || listening);
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
  const summaryPending = summaryBusy || data.jobs.some(
    (job) => job.kind === "summary" && ["queued", "running"].includes(job.status),
  );
  const canSummarize = isHost && data.canRequestSummary !== false;
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
    <div
      className="room-app plaza-room"
      style={{ "--topic-height": `${topicHeight}px` } as React.CSSProperties}
    >
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
                  myPoints: me
                    ? d.praise.filter(
                        (p) => p.member_id === me.id && p.status === "awarded",
                      ).length
                    : 0,
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
              setEditDraft(null);
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
        </div>
        <div className="room-top-actions">
          {isHost && (
            <button
              className="code-chip"
              title="초대 코드 크게 보기 및 QR코드"
              onClick={() => setInviteOrigin(window.location.origin)}
            >
              <small>초대 코드</small>
              <b>{room.code}</b>
              <QrCode size={18} />
            </button>
          )}
          {isHost && (room.state === "ended" ? <button className="button primary small" onClick={() => setReviewRecords(false)}>최종 정리 화면 보기</button> : <button className="button secondary small" disabled={roundBusy} onClick={() => setConfirm("end")}>대화 끝내고 정리하기</button>)}
          {isHost && room.state !== "ended" && (
            <button
              className={"button small " + (active ? "secondary" : "primary")}
              disabled={roundBusy}
              onClick={async () => {
                setRoundBusy(true);
                try {
                  await mutate("room_state", { state: active ? "paused" : "active" });
                } finally {
                  setRoundBusy(false);
                }
              }}
            >
              {active ? <Pause size={17} /> : <Play size={17} />}{" "}
              {roundBusy ? "변경 중…" : active ? "잠시 멈춤" : "대화방 열기"}
            </button>
          )}
        </div>
      </section>
      <section
        ref={topicRef}
        className="persistent-topic"
        aria-label="계속 표시되는 토론 주제"
      >
        <MessageCircle size={20} aria-hidden="true" />
        <div>
          <b>함께 이야기하는 주제</b>
          <p>{room.topic}</p>
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
          onClick={() => { setTab("summary"); requestAnimationFrame(() => document.getElementById("conversation-summary")?.scrollIntoView({block:"start"})); }}
        >
          <Sparkles size={17} />
            대화 요약
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
            onRoundOpinions={() => setRoundOpinions(true)}
            onLock={() => changeRound("round_control")}
            onNext={() => setNextRound(true)}
            onPresenters={() => {
              setError("");
              setPickingPresenters(true);
            }}
          />
          <form className="composer" onSubmit={send}>
            <div className="composer-options">
              <span>
                <Smile size={16} />
                {editing
                  ? `${room.round_number}번째 차례 · 내 의견을 고쳐요`
                  : ask
                    ? "이야기별에게 요청해요"
                    : isHost
                      ? "진행자의 이야기를 전해요"
                      : `${room.round_number}번째 차례 · 친구의 말에 이어서 대화해요`}
              </span>
              <div className="composer-actions">
                {editing ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setEditDraft(null);
                      setSendError("");
                    }}
                  >
                    수정 취소
                  </button>
                ) : (
                  <>
                    {editableOpinion && !ask && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setSendError("");
                          setEditDraft({
                            original: editableOpinion,
                            content: editableOpinion.content,
                            stance: editableOpinion.stance ?? "neutral",
                          });
                          requestAnimationFrame(() => input.current?.focus());
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        내 의견 수정
                      </button>
                    )}
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
                  </>
                )}
              </div>
            </div>
            {room.kind === "debate" && !ask && !sendBlocked && (
              <div className="stance-picker">
                {[
                  ["neutral", "자유 의견"],
                  ["for", "찬성"],
                  ["against", "반대"],
                ].map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    className={composerStance === v ? "active" : ""}
                    aria-pressed={composerStance === v}
                    disabled={!!editing && busy}
                    onClick={() => editing
                      ? setEditDraft({ ...editing, stance: v })
                      : setStance(v)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="composer-input">
              <textarea
                ref={input}
                aria-label={editing ? "의견 수정 입력" : ask ? "AI에게 요청" : "대화 입력"}
                value={roundBlocked && submitted && !pendingOpinion
                  ? currentOpinion?.content ?? ""
                  : composerText}
                onChange={(e) => editing
                  ? setEditDraft({ ...editing, content: e.target.value })
                  : setText(e.target.value)}
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
                        ? listening
                          ? "지금은 발표하는 친구들의 이야기를 들어요"
                          : submitted
                            ? "이번 차례에 생각을 남겼어요"
                            : "진행자가 발언을 열면 이야기할 수 있어요"
                        : ask
                          ? "이야기별에게 궁금한 점을 물어보세요"
                          : "친구의 말에 이어 의견, 질문, 반론을 나눠 주세요…"
                }
                maxLength={2000}
                rows={2}
                disabled={sendBlocked || (!!editing && busy)}
              />
              <button
                className={`send-button${editing ? " edit-save" : ""}`}
                aria-label={editing ? "수정 내용 저장" : ask ? "AI 요청 보내기" : "메시지 보내기"}
                disabled={busy || sendBlocked || editConflict || editUnchanged || !composerText.trim()}
              >
                {editing ? "저장" : <Send size={20} />}
              </button>
            </div>
            {pendingOpinion && (
              <div className="composer-pending" role="status">
                <b>{pendingOpinion.edit ? "수정 내용을 확인하고 있어요" : "보낸 의견을 확인하고 있어요"}</b>
                <p>{pendingOpinion.content}</p>
              </div>
            )}
            {editConflict && !busy && (
              <Notice error>다른 곳에서 의견이 수정됐어요. 수정 취소를 누르고 최신 의견을 열어 주세요.</Notice>
            )}
            <Notice error>{sendError}</Notice>
            <div className="composer-hint">
              <span>
                {editing
                  ? "Enter 저장 · Shift+Enter 줄바꿈"
                  : !ask && submitted && currentOpinion?.visibility === "held"
                    ? "진행자가 공개 전에 의견을 확인하고 있어요"
                    : !isHost && !ask
                      ? "같은 주제로 대화를 이어가요 · 지난 발언은 기록에 남아요"
                      : "Enter 전송 · Shift+Enter 줄바꿈"}
              </span>
              {!sendBlocked && <span>{composerText.length}/2000</span>}
            </div>
          </form>
        </section>
        <aside
          id="conversation-summary"
          className={`summary-panel panel ${tab === "summary" ? "mobile-show" : ""}`}
        >
          <div className="summary-heading">
            <Mascot size={62} />
            <div>
              <h2>대화 요약</h2>
              <p>지금까지의 의견·공통점·차이를 정리해요</p>
            </div>
            <Sparkles size={18} />
          </div>
          {canAsk && (
            <div className="ai-quick-actions" aria-label="이야기별에게 요청">
              {canSummarize && (
                <button
                  type="button"
                  className="manual-summary-button"
                  disabled={!active || !data.aiEnabled || summaryPending || !messages.some(
                    (message) => message.visibility === "visible" && ["host", "member"].includes(message.role),
                  )}
                  onClick={async () => {
                    setSummaryBusy(true);
                    setSide("summary");
                    await mutate("request_summary", { client_id: crypto.randomUUID() });
                    setSummaryBusy(false);
                  }}
                >
                  {summaryPending ? "요약 만드는 중…" : "AI 요약 만들기"}
                </button>
              )}
              {[
                [
                  "진행 도와줘",
                  "현재 차례의 대화를 자연스럽게 이어갈 진행 멘트를 제안해 줘.",
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
              지금까지의 요약
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
                      {demo
                        ? "체험용 요약이에요. 원문과 함께 확인해 주세요."
                        : "AI가 정리한 내용이에요. 원문과 함께 확인해 주세요."}
                    </p>
                  </>
                ) : (
                  <div className="small-empty">
                    <Mascot size={120} />
                    <h3>어떤 생각이 모일까요?</h3>
                    <p role="status">
                      {summaryPending
                        ? "이야기별이 대화를 정리하고 있어요."
                        : "진행자가 AI 요약을 요청하면 이곳에 표시돼요."}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <PraiseBoard
                key={isHost ? "host" : "member"}
                data={data}
                change={(id, status) =>
                  mutate("praise_status", { praise_id: id, status })
                }
                openMessage={(id) => {
                  const message = messages.find((m) => m.id === id);
                  if (message) {
                    openSpeaker(
                      { role: "member", memberId: message.member_id! },
                      id,
                    );
                  }
                }}
              />
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
      {roundOpinions && <RoundOpinions data={data} close={() => setRoundOpinions(false)} />}
      {speaker && (
        <Modal
          title={
            speaker.role === "all"
              ? "함께 나눈 대화"
              : speakerName + "의 이야기 모음"
          }
          close={() => setSpeaker(null)}
        >
          <p>
            {speaker.role === "all"
              ? "교사와 친구들이 주고받은 대화를 발언 순서대로 볼 수 있어요."
              : "모든 차례의 발언을 차곡차곡 모았어요."}{" "}
            총 {historyMessages.length}개
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
                      {isHost && !(m.role === "ai" && m.visibility === "hidden") && (
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
                  {isHost && m.visibility === "visible" && m.safety_reason && (
                    <div className="held-label">{m.safety_reason}</div>
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
          title={
            room.speaker_ids
              ? "모두 함께 대화할까요?"
              : "이어서 대화할 수 있도록 열까요?"
          }
          close={() => setNextRound(false)}
        >
          <p>
            같은 토론 주제로 대화를 이어갑니다. 친구의 의견에 답하거나, 질문하고
            반론할 수 있도록 다음 발언 차례를 열어요.
          </p>
          <Notice error>{error}</Notice>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changeRound("next_round");
            }}
          >
            <button className="button primary full" disabled={roundBusy}>
              {roundBusy
                ? "차례를 여는 중…"
                : room.speaker_ids
                  ? "모두 대화하기"
                  : "다음 대화 열기"}
            </button>
          </form>
        </Modal>
      )}
      {pickingPresenters && isHost && (
        <PresenterPicker
          members={members}
          current={room.speaker_ids}
          busy={roundBusy}
          error={error}
          close={() => setPickingPresenters(false)}
          start={startPresentation}
        />
      )}
      {selected && (
        <Modal
          title={
            selected.type === "praise"
              ? "따뜻한 칭찬을 선물해요"
              : "진행자에게 알려 주세요"
          }
          close={() => {
            if (!feedbackBusy) setSelected(null);
          }}
        >
          <blockquote>{selected.message.content}</blockquote>
          <Notice error>{error}</Notice>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (feedbackBusy) return;
              setFeedbackBusy(true);
              try {
                if (
                  await mutate(
                    selected.type === "praise" ? "praise" : "report",
                    {
                      message_id: selected.message.id,
                      category,
                      reason,
                    },
                  )
                ) {
                  setInfo(
                    selected.type === "praise"
                      ? "칭찬 별 1점을 선물했어요. 칭찬 별의 지급 내역에서 확인하세요."
                      : "진행자에게 전달했어요.",
                  );
                  setSelected(null);
                }
              } finally {
                setFeedbackBusy(false);
              }
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
            <button
              className="button primary full"
              disabled={feedbackBusy || !reason.trim()}
            >
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
              ? "발언을 마치고, 승인된 참여자 모두가 대화 정리 화면으로 이동해요. 진행자는 그 화면에서 최종 AI 요약을 요청할 수 있어요. 정리 내용은 A4 한 장 PDF로 저장하거나 출력할 수 있어요. 기록은 90일 동안 보관되며 종료한 방은 다시 열 수 없어요."
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
              {confirm === "end" ? "대화 끝내고 정리하기" : "삭제하기"}
            </button>
          </div>
        </Modal>
      )}
      {inviteOrigin && isHost && <InviteDialog key={room.code} room={room} origin={inviteOrigin} demo={demo} close={() => setInviteOrigin(null)} />}
    </div>
  );
}
