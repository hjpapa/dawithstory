"use client";

import type { Snapshot } from "@/lib/domain";
import { Modal } from "./ui";

const stanceLabels = {
  for: "찬성 의견",
  against: "반대 의견",
  neutral: "자유 의견",
} as const;

export function RoundOpinions({
  data,
  close,
}: {
  data: Snapshot;
  close: () => void;
}) {
  const { room, messages, members, isHost, me } = data;
  const opinions = messages.filter(
    (message) => message.role === "member" && message.round_number === room.round_number,
  );
  const visible = opinions.filter((message) => message.visibility === "visible");
  const submitted = new Map(opinions.map((message) => [message.member_id, message.visibility]));
  const eligible = isHost
    ? members.filter(
        (member) =>
          member.state === "approved" &&
          (!room.speaker_ids || room.speaker_ids.includes(member.id)) &&
          (!member.muted || submitted.has(member.id)),
      )
    : [];
  const missing = eligible.filter((member) => !submitted.has(member.id));
  const held = eligible.filter((member) => submitted.get(member.id) === "held").length;
  const hidden = eligible.filter((member) => submitted.get(member.id) === "hidden").length;

  return (
    <Modal title={`${room.round_number}번째 장 의견`} close={close}>
      {isHost && (
        <details className="round-participation">
          <summary>의견 제출 {eligible.length - missing.length} / {eligible.length}명</summary>
          <p>미제출 {missing.length}명 · 검토 대기 {held}명 · 숨김 {hidden}명</p>
          {missing.length > 0 && <p>미제출 학생 {missing.map((member) => member.nickname).join(" · ")}</p>}
        </details>
      )}
      <div className="speaker-history">
        <p className="round-opinions-count">공개 의견 {visible.length}개</p>
        {visible.length === 0 && (
          <div className="history-empty">
            <p>이번 장에 공개된 학생 의견이 아직 없어요.</p>
          </div>
        )}
        {visible.map((message) => {
          const stance = message.stance === "for" || message.stance === "against"
            ? message.stance
            : "neutral";
          return (
            <article key={message.id} className="message">
              <span className="avatar" aria-hidden="true">{message.avatar}</span>
              <div className="message-main">
                <div className="message-meta">
                  <b>{message.nickname}</b>
                  {me && message.member_id === me.id && <span className="history-round">내 의견</span>}
                </div>
                <div className="message-bubble">
                  {room.kind === "debate" && <span className={`stance ${stance}`}>{stanceLabels[stance]}</span>}
                  {message.content}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
