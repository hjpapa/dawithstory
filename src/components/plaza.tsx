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
  latestVisibleMessage,
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
  const hostMessage = latestVisibleMessage(messages, { role: "host" });
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
              ? "서로의 말에 이어 대화해요"
              : "잠시 멈추고 서로의 이야기를 들어요"}
          </b>
          <span>
            자유로운 순서 · 이번 차례 {count}명 참여 · 진행자는 언제든 발언
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
              {room.round_open ? "발언 잠금" : "대화 계속하기"}
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={onNext}
              disabled={busy || room.state !== "active"}
            >
              다음 대화 열기 <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
      {room.round_prompt && (
        <div className="round-question">
          <MessageCircle size={17} />
          <span>
            진행 안내 <b>{room.round_prompt}</b>
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
            const message = latestVisibleMessage(messages, speaker);
            const isCurrent = message?.round_number === room.round_number;
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
                  {message && !isCurrent && (
                    <em className="previous-speech">이전에 나눈 말</em>
                  )}
                  <span>
                    {message?.content ||
                      (submitted
                        ? "진행자가 발언을 확인하고 있어요"
                        : member.muted
                          ? "친구들의 이야기를 듣고 있어요"
                          : "친구의 이야기를 듣고 있어요 ☁️")}
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
                  {isCurrent
                    ? "이번 차례에 이야기했어요"
                    : submitted
                      ? "발언 확인 중"
                      : room.state === "active" &&
                          room.round_open &&
                          !member.muted
                        ? "이어서 이야기할 수 있어요"
                        : "다음 발언을 기다려요"}
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
        <button type="button" onClick={() => onSpeaker({ role: "all" })}>
          대화 흐름 보기 ↗
        </button>
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
