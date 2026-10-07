"use client";
import Link from "next/link";
import { ArrowLeft, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
export function Mascot({
  className = "",
  size = 100,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      className={`mascot ${className}`}
      src="/star-mascot.png"
      alt="별 모양 AI 도우미 이야기별"
      width={size}
      height={size}
    />
  );
}
export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Sparkles size={25} />
        </span>
        <span>
          다함께 <b>이야기</b>
          <small>생각이 만나 반짝이는 곳</small>
        </span>
      </Link>
      <nav>
        {children || (
          <>
            <Link href="/demo" className="nav-text">
              미리 둘러보기
            </Link>
            <Link href="/login" className="button secondary small">
              진행자 로그인
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
export function Back({
  href = "/",
  children = "처음으로",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="back-link">
      <ArrowLeft size={17} />
      {children}
    </Link>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return children ? (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <main className="center-state">
      <Mascot size={140} />
      <h2>이야기를 준비하고 있어요</h2>
      <p>조금만 기다려 주세요.</p>
    </main>
  );
}
export function Modal({
  title,
  children,
  close,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} className={`modal ${className}`} onCancel={close}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="닫기">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
