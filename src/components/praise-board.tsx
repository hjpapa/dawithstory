"use client";
import { useState } from "react";
import { CATEGORIES, type Snapshot, type Praise } from "@/lib/domain";
import { Notice } from "./ui";

export function PraiseBoard({
  data,
  change,
  openMessage,
}: {
  data: Snapshot;
  change: (id: string, status: string) => Promise<boolean>;
  openMessage: (id: number) => void;
}) {
  const [filter, setFilter] = useState("suggested");
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const rows = data.praise.filter((p) =>
    data.isHost
      ? p.status === filter
      : p.status === "awarded" && (!mine || p.member_id === data.me?.id),
  );
  async function update(p: Praise, status: string) {
    if (busy) return;
    setBusy(p.id);
    setNotice("");
    setError("");
    try {
      if (await change(p.id, status)) {
        setCancel(null);
        setNotice(
          status === "awarded"
            ? "칭찬 별 1점을 선물했어요. 지급 내역에서 확인할 수 있어요."
            : status === "revoked"
              ? "지급을 취소하고 점수에 반영했어요."
              : "추천을 넘겼어요. 넘긴 추천에서 다시 볼 수 있어요.",
        );
      } else setError("처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="칭찬과 포인트">
      {!data.isHost && (
        <div className="my-points" aria-live="polite">
          <span>⭐ 나의 칭찬 별</span>
          <b>{data.myPoints}점</b>
        </div>
      )}
      <p className="praise-help">
        {data.isHost
          ? "이야기별은 후보를 추천하고, 선생님이 확인해 1점을 선물해요. 직접 칭찬은 캐릭터의 발언 기록에서 할 수 있어요."
          : "좋은 생각과 따뜻한 마음을 함께 응원해요. 내 점수는 나와 진행자만 볼 수 있어요."}
      </p>
      <div className="praise-filters" aria-label="칭찬 내역 선택">
        {data.isHost ? (
          [
            ["suggested", "추천"],
            ["awarded", "지급 내역"],
            ["revoked", "취소 내역"],
            ["dismissed", "넘긴 추천"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setCancel(null);
              }}
            >
              {label} {data.praise.filter((p) => p.status === value).length}
            </button>
          ))
        ) : (
          <>
            <button aria-pressed={!mine} onClick={() => setMine(false)}>
              모두의 칭찬
            </button>
            <button aria-pressed={mine} onClick={() => setMine(true)}>
              내 칭찬
            </button>
          </>
        )}
      </div>
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      {rows.map((p) => {
        const member = data.members.find((m) => m.id === p.member_id);
        const message = data.messages.find((m) => m.id === p.message_id);
        const visible = message?.visibility === "visible";
        return (
          <article key={p.id} className={"praise-card " + p.status}>
            <span className="praise-star" aria-hidden="true">
              ✦
            </span>
            <small>
              {p.status === "suggested"
                ? "이야기별의 추천 · 아직 지급 전"
                : p.status === "awarded"
                  ? "칭찬 별 +1"
                  : p.status === "revoked"
                    ? "지급 취소 · 점수 제외"
                    : "넘긴 추천"}
            </small>
            <h3>
              {member?.avatar} {member?.nickname || "참여자"}
            </h3>
            <b>{CATEGORIES[p.category]}</b>
            <p>{p.reason}</p>
            {visible && (
              <button
                className="praise-source"
                onClick={() => openMessage(p.message_id)}
              >
                <span>{message.content}</span>
                <small>칭찬받은 발언 전체 보기 ↗</small>
              </button>
            )}
            {data.isHost && (
              <div className="praise-actions">
                {["suggested", "dismissed", "revoked"].includes(p.status) && (
                  <button
                    className="button small primary"
                    disabled={!!busy || !visible}
                    onClick={() => update(p, "awarded")}
                  >
                    {busy === p.id ? "처리 중…" : "⭐ 1점 주기"}
                  </button>
                )}
                {p.status === "suggested" && (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => update(p, "dismissed")}
                  >
                    넘기기
                  </button>
                )}
                {p.status === "awarded" &&
                  (cancel === p.id ? (
                    <>
                      <span>1점을 취소할까요?</span>
                      <button
                        className="button small secondary"
                        disabled={!!busy}
                        onClick={() => update(p, "revoked")}
                      >
                        취소 확정
                      </button>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => setCancel(null)}
                      >
                        돌아가기
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => setCancel(p.id)}
                    >
                      지급 취소
                    </button>
                  ))}
                {!visible && <small>공개된 발언에만 지급할 수 있어요.</small>}
              </div>
            )}
          </article>
        );
      })}
      {rows.length === 0 && (
        <div className="small-empty">
          <span>🌟</span>
          <h3>
            {data.isHost
              ? "이 내역은 아직 비어 있어요"
              : "따뜻한 칭찬을 기다려요"}
          </h3>
          <p>근거 제시 · 경청 · 좋은 질문 · 배려를 응원해요.</p>
        </div>
      )}
    </section>
  );
}
