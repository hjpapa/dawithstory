"use client";
import {
  ArrowRight,
  LockKeyhole,
  LockKeyholeOpen,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import type { Snapshot } from "@/lib/domain";
import {
  plazaSeats,
  roundMessage,
  speakerMessages,
  type Speaker,
} from "@/lib/plaza";
import { Mascot } from "./ui";

export function Plaza({
  data,
  thinking,
  busy,
  onSpeaker,
  onLock,
  onNext,
}: {
  data: Snapshot;
  thinking: boolean;
  busy: boolean;
  onSpeaker: (speaker: Speaker) => void;
  onLock: () => void;
  onNext: () => void;
}) {
  const { room, messages, members, isHost, me } = data;
  const approved = members.filter((m) => m.state === "approved");
  const seats = plazaSeats(approved.length);
  const spoken = new Set(
    messages
      .filter(
        (m) => m.role === "member" && m.round_number === room.round_number,
      )
      .map((m) => m.member_id),
  );
  if (data.myRoundSubmitted && me) spoken.add(me.id);
  const count = approved.filter((m) => spoken.has(m.id)).length;
  const hostMessage = roundMessage(
    messages,
    { role: "host" },
    room.round_number,
  );
  const aiMessage = messages
    .filter((m) => m.role === "ai" && m.visibility === "visible")
    .at(-1);
  return (
    <>
      <div className="plaza-heading">
        <div>
          <span className="plaza-eyebrow">OUR STORY SQUARE</span>
          <h2>
            우리의 이야기 광장 <span>🌱</span>
          </h2>
        </div>
        <span className="plaza-round">{room.round_number}번째 차례</span>
      </div>
      <div className="round-bar">
        <div aria-live="polite">
          <b>
            {room.state === "active" && room.round_open
              ? "생각을 모으고 있어요"
              : "모인 생각을 함께 읽어요"}
          </b>
          <span>
            {count}/{approved.length}명 발언 · 한 차례에 한 번
          </span>
        </div>
        {isHost && (
          <div className="round-controls">
            <button
              type="button"
              className="button secondary small"
              onClick={onLock}
              disabled={busy || room.state !== "active"}
            >
              {room.round_open ? (
                <LockKeyhole size={15} />
              ) : (
                <LockKeyholeOpen size={15} />
              )}
              {room.round_open ? "발언 잠금" : "발언 다시 받기"}
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={onNext}
              disabled={busy || room.state !== "active"}
            >
              다음 차례 <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
      {room.round_prompt && (
        <div className="round-question">
          <MessageCircle size={17} />
          <span>
            이번 질문 <b>{room.round_prompt}</b>
          </span>
        </div>
      )}
      <div className="plaza-scroll">
        <div
          className={`plaza-ground ${seats.columns === 5 ? "plaza-crowd" : ""}`}
          aria-label="캐릭터 토론 광장"
        >
          <div className="plaza-path" aria-hidden="true" />
          <button
            type="button"
            className="plaza-seat host-seat"
            style={seats.host}
            onClick={() => onSpeaker({ role: "host" })}
            aria-label="진행자 전체 발언 보기"
          >
            <span
              className={`seat-bubble ${!hostMessage ? "bubble-empty" : ""}`}
            >
              <span>
                {hostMessage?.content ||
                  "서로의 생각을 듣고, 다음 이야기를 함께 열어요."}
              </span>
            </span>
            <span className="character-podium">
              <span className="character-emoji">🌷</span>
              <i>✦</i>
            </span>
            <b className="seat-name">
              진행자 <small>모임의 중심</small>
            </b>
          </button>
          {approved.map((member, i) => {
            const speaker: Speaker = { role: "member", memberId: member.id };
            const message = roundMessage(messages, speaker, room.round_number);
            const history = speakerMessages(messages, speaker);
            const submitted = spoken.has(member.id);
            return (
              <button
                type="button"
                key={member.id}
                className={`plaza-seat seat-tone-${i % 5} ${message ? "has-speech" : ""} ${me?.id === member.id ? "my-seat" : ""}`}
                style={seats.members[i]}
                onClick={() => onSpeaker(speaker)}
                aria-label={`${member.nickname} 전체 발언 ${history.length}개 보기`}
              >
                <span
                  className={`seat-bubble ${!message ? "bubble-empty" : ""}`}
                >
                  <span>
                    {message?.content ||
                      (submitted
                        ? "진행자가 발언을 확인하고 있어요"
                        : member.muted
                          ? "친구들의 이야기를 듣고 있어요"
                          : "어떤 생각을 나눌까요? ☁️")}
                  </span>
                  {message && <small>전체 보기 ↗</small>}
                </span>
                <span className="character-podium">
                  <span className="character-emoji">{member.avatar}</span>
                  {submitted && <i aria-label="발언 완료">✓</i>}
                </span>
                <b className="seat-name">
                  {member.nickname}
                  {me?.id === member.id && <em>나</em>}
                </b>
                <small className="seat-status">
                  {message
                    ? "생각을 남겼어요"
                    : submitted
                      ? "발언 확인 중"
                      : "생각 모으는 중"}
                </small>
              </button>
            );
          })}
          {!approved.length && (
            <p className="plaza-empty">
              초대 코드로 친구들을 불러 보세요.
              <br />
              승인된 참여자의 캐릭터가 이곳에 모여요.
            </p>
          )}
        </div>
      </div>
      <div className="plaza-footer">
        <span>✦ 캐릭터를 누르면 모든 차례의 발언을 볼 수 있어요</span>
        <span>{approved.length} / 30명</span>
      </div>
      <button
        type="button"
        className={`plaza-ai ${thinking ? "is-thinking" : ""}`}
        onClick={() => onSpeaker({ role: "ai" })}
      >
        <Mascot size={66} />
        <span>
          <b>
            <Sparkles size={14} /> 광장 곁의 이야기별{" "}
            {thinking && <small>생각하는 중…</small>}
          </b>
          <span>
            {thinking
              ? "여러분의 생각을 모아 정리하고 있어요. 대화는 계속 나눠 주세요."
              : aiMessage?.content ||
                "우리의 의견을 연결하고, 함께 생각할 질문을 제안할게요."}
          </span>
        </span>
        <ArrowRight size={17} />
      </button>
    </>
  );
}
