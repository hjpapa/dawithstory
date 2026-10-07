"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Link as LinkIcon, ScanLine } from "lucide-react";
import { Modal, Notice } from "./ui";
import type { Room } from "@/lib/domain";

export function InviteDialog({ room, origin, demo, close }: {
  room: Room; origin: string; demo: boolean; close: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const url = `${origin}/?code=${encodeURIComponent(room.code)}#join`;
  async function copy(value: string, label: string) {
    setNotice(""); setError("");
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label}를 복사했어요.`);
    } catch {
      setError("복사가 지원되지 않아요. 아래 코드나 초대 링크를 직접 선택해 복사해 주세요.");
    }
  }
  return (
    <Modal title="우리 이야기로 초대해요 ✨" close={close} className="invite-modal">
      <p className="invite-room-title">{room.title}</p>
      <div className="invite-layout">
        <div className="invite-code-card">
          <span className="invite-label">함께 들어오는 초대 코드</span>
          <strong className="invite-big-code" aria-label={`초대 코드 ${room.code}`}>{room.code}</strong>
          <button className="button secondary" onClick={() => copy(room.code, "초대 코드")}><Copy size={18} /> 코드 복사</button>
          <p>코드를 입력하거나<br />QR코드를 스캔해 주세요.</p>
        </div>
        <div className="invite-qr-card">
          <QRCodeSVG value={url} size={264} level="M" marginSize={4} title="대화방 참여 QR코드" />
          <span><ScanLine size={18} /> 카메라로 스캔하면 바로 연결!</span>
        </div>
      </div>
      <p className="invite-steps">① QR 스캔 → ② 별명·캐릭터 선택 → ③ 진행자 승인 후 입장</p>
      {demo ? <Notice>체험용 초대 화면이에요. 실제 참여는 진행자가 만든 방에서 가능해요.</Notice> :
        room.state !== "active" && <Notice>{room.state === "ended" ? "종료된 방이에요. 이 코드로 새로 입장할 수 없어요." : "아직 입장할 수 없어요. 초대 화면을 닫고 ‘대화방 열기’를 눌러 주세요."}</Notice>}
      <label htmlFor="invite-link">초대 링크</label>
      <div className="invite-link-row">
        <input id="invite-link" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button className="button secondary" onClick={() => copy(url, "초대 링크")}><LinkIcon size={17} /> 링크 복사</button>
      </div>
      <Notice error>{error}</Notice><Notice>{notice}</Notice>
    </Modal>
  );
}
