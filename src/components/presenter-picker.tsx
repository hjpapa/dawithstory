"use client";
import { useState } from "react";
import type { Member } from "@/lib/domain";
import { Modal, Notice } from "./ui";

export function PresenterPicker({
  members,
  current,
  busy,
  error,
  close,
  start,
}: {
  members: Member[];
  current: string[] | null | undefined;
  busy: boolean;
  error: string;
  close: () => void;
  start: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(current || []);
  const eligible = members.filter((m) => m.state === "approved" && !m.muted);
  const validIds = selected.filter((id) => eligible.some((m) => m.id === id));
  return (
    <Modal title="발표할 친구를 골라요" close={close}>
      <p>
        선택한 친구들에게 새 발언 차례를 열어요. 다른 친구들은 이야기를 듣고,
        교사는 언제든 함께 말할 수 있어요.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validIds.length) start(validIds);
        }}
      >
        <div className="presenter-list">
          {members
            .filter((m) => m.state === "approved")
            .map((m) => (
              <label
                key={m.id}
                className={validIds.includes(m.id) ? "chosen" : ""}
              >
                <input
                  type="checkbox"
                  checked={validIds.includes(m.id)}
                  disabled={m.muted || busy}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, m.id]
                        : ids.filter((id) => id !== m.id),
                    )
                  }
                />
                <span className="presenter-avatar">{m.avatar}</span>
                <span>
                  {m.nickname}
                  {m.muted && <small>발언 제한 중</small>}
                </span>
              </label>
            ))}
        </div>
        {!eligible.length && (
          <Notice>발언 가능한 참여자가 들어오면 선택할 수 있어요.</Notice>
        )}
        <Notice error>{error}</Notice>
        <button
          className="button primary full"
          disabled={busy || !validIds.length}
        >
          {busy ? "발표를 여는 중…" : `선택한 ${validIds.length}명 발표 시작`}
        </button>
      </form>
    </Modal>
  );
}
