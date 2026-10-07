import type { Snapshot } from "./domain";

export function reviewContent(data: Snapshot) {
  const speeches = data.messages.filter(m => m.visibility === "visible" && ["host", "member"].includes(m.role));
  const summary = data.summary?.content;
  return {
    title: data.room.title, topic: data.room.topic,
    ended: data.room.ended_at ? new Date(data.room.ended_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "체험 기록",
    participants: data.members.filter(m => m.state === "approved").length,
    speeches: speeches.length, rounds: data.room.round_number,
    final: !!data.summary?.is_final,
    overview: summary?.overview || (speeches.length ? "최종 AI 요약이 아직 준비되지 않았습니다. 아래는 공개 발언의 일부 발췌입니다." : "이번 대화에는 공개된 진행자·참여자 발언이 없습니다."),
    opinions: summary?.opinions.map(x => x.text) || speeches.slice(0, 5).map(m => m.content),
    agreements: summary?.agreements.map(x => x.text) || [],
    differences: summary?.differences.map(x => x.text) || [],
    questions: summary?.questions || [],
  };
}
export type ReviewContent = ReturnType<typeof reviewContent>;
