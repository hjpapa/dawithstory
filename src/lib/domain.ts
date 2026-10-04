export { AVATARS } from "../../supabase/functions/story-api/avatars";
export const KINDS = {
  discussion: "함께 토의",
  debate: "찬반 토론",
  daily: "일상 이야기",
} as const;
export const STATES = {
  draft: "준비 중",
  active: "이야기 중",
  paused: "잠시 쉬는 중",
  ended: "이야기 마침",
} as const;
export const CATEGORIES = {
  reason: "탄탄한 근거",
  listening: "귀 기울이기",
  question: "반짝 질문",
  kindness: "따뜻한 배려",
} as const;
export type RoomState = keyof typeof STATES;
export type Room = {
  id: string;
  owner_id: string;
  title: string;
  topic: string;
  kind: keyof typeof KINDS;
  code: string;
  state: RoomState;
  ai_mode: string;
  created_at: string;
  ended_at: string | null;
  host_seen_at: string;
  ai_error: string | null;
  revision: number;
  is_demo: boolean;
  round_number: number;
  round_open: boolean;
  round_prompt: string;
};
export type Member = {
  id: string;
  user_id: string;
  room_id: string;
  nickname: string;
  avatar: string;
  state: string;
  muted: boolean;
  can_ask_ai: boolean;
  points?: number;
};
export type Message = {
  id: number;
  room_id: string;
  role: string;
  user_id?: string;
  member_id: string | null;
  nickname: string;
  avatar: string;
  content: string;
  stance?: string;
  visibility: string;
  safety_reason?: string;
  round_number?: number | null;
  created_at: string;
};
export type SummaryItem = { text: string; message_ids: number[] };
export type Summary = {
  overview: string;
  opinions: SummaryItem[];
  agreements: SummaryItem[];
  differences: SummaryItem[];
  questions: string[];
  reply: string;
  praise?: { message_id: number; category: string; reason: string }[];
};
export type Praise = {
  id: string;
  member_id: string;
  message_id: number;
  category: keyof typeof CATEGORIES;
  reason: string;
  status: string;
  points?: number;
  created_at: string;
};
export type Snapshot = {
  room: Room;
  me: Member | null;
  isHost: boolean;
  canHeartbeat?: boolean;
  members: Member[];
  messages: Message[];
  summary: { content: Summary; created_at: string } | null;
  praise: Praise[];
  jobs: { status: string; error?: string }[];
  reports: {
    id: string;
    message_id: number;
    reason: string;
    resolved: boolean;
  }[];
  aiEnabled: boolean;
  myPoints: number;
  myRoundSubmitted?: boolean;
};
export function csvCell(value: unknown) {
  let str = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return '"' + str.replaceAll('"', '""') + '"';
}
export function transcriptCsv(snapshot: Snapshot) {
  const rows: unknown[][] = [["종류", "시간", "별명", "내용", "상태", "차례"]];
  for (const m of snapshot.messages)
    rows.push([
      "발언",
      m.created_at,
      m.nickname,
      m.content,
      m.visibility,
      m.round_number ?? "이전 기록",
    ]);
  if (snapshot.summary)
    rows.push([
      "AI 요약",
      snapshot.summary.created_at,
      "이야기별",
      JSON.stringify(snapshot.summary.content),
      "",
      "",
    ]);
  for (const p of snapshot.praise)
    rows.push([
      "칭찬",
      p.created_at,
      snapshot.members.find((m) => m.id === p.member_id)?.nickname,
      `${CATEGORIES[p.category]}: ${p.reason}`,
      p.status,
      "",
    ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
