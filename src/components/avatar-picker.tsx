"use client";
import { useState } from "react";
import {
  AVATAR_CATALOG,
  AVATAR_GROUPS,
} from "../../supabase/functions/story-api/avatars";
import { Modal } from "./ui";
export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (avatar: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string>(AVATAR_GROUPS[0]);
  const selected =
    AVATAR_CATALOG.find((a) => a.emoji === value) || AVATAR_CATALOG[0];
  const preview = AVATAR_CATALOG.slice(0, 7);
  preview.push(
    preview.some((a) => a.emoji === value) ? AVATAR_CATALOG[7] : selected,
  );
  return (
    <fieldset className="avatar-field">
      <legend>
        오늘의 나를 골라요 <span>내 아바타</span>
      </legend>
      <div className="avatar-picker">
        {preview.map((a) => (
          <button
            type="button"
            key={a.emoji}
            className={a.emoji === value ? "selected" : ""}
            aria-label={a.name}
            aria-pressed={a.emoji === value}
            onClick={() => onChange(a.emoji)}
          >
            {a.emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="avatar-more"
        onClick={() => setOpen(true)}
      >
        <span>{selected.name}</span>
        <b>50종 모두 보기 →</b>
      </button>
      {open && (
        <Modal title="나를 닮은 친구를 골라요" close={() => setOpen(false)}>
          <p>동물부터 상상 속 친구까지, 50명의 친구가 기다려요.</p>
          <div className="avatar-categories" aria-label="캐릭터 종류">
            {AVATAR_GROUPS.map((g) => (
              <button
                type="button"
                key={g}
                aria-pressed={g === group}
                className={g === group ? "active" : ""}
                onClick={() => setGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="avatar-gallery">
            {AVATAR_CATALOG.filter((a) => a.group === group).map((a) => (
              <button
                type="button"
                key={a.emoji}
                aria-pressed={a.emoji === value}
                className={a.emoji === value ? "selected" : ""}
                onClick={() => {
                  onChange(a.emoji);
                  setOpen(false);
                }}
              >
                <span>{a.emoji}</span>
                <b>{a.name}</b>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </fieldset>
  );
}
