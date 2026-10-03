"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, supabase } from "@/lib/supabase";
import { Back, Header, Mascot, Notice } from "@/components/ui";
export default function Login() {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const auth = supabase().auth;
      if (mode === "signup") {
        const { data, error } = await auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/auth/callback",
          },
        });
        if (error) throw error;
        if (data.session) {
          await api("me");
          router.push("/dashboard");
        } else
          setNotice(
            "이메일로 받은 인증 링크를 열어 주세요. 첫 로그인 후 운영자가 가입을 승인해 드려요.",
          );
      } else if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo:
            window.location.origin + "/auth/callback?next=/reset-password",
        });
        if (error) throw error;
        setNotice("가입된 이메일이라면 비밀번호 재설정 안내가 도착해요.");
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        await api("me");
        router.push("/dashboard");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg.includes("Invalid login")
          ? "이메일과 비밀번호를 확인해 주세요."
          : msg.includes("Email not confirmed")
            ? "이메일 인증을 먼저 완료해 주세요."
            : msg.includes("rate limit")
              ? "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요."
              : msg,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="auth-page">
        <Back />
        <div className="auth-card">
          <Mascot size={110} />
          <h1>
            {mode === "login"
              ? "다시 만나 반가워요!"
              : mode === "signup"
                ? "함께할 진행자를 기다려요"
                : "비밀번호를 찾을까요?"}
          </h1>
          <p>
            {mode === "signup"
              ? "이메일 인증과 운영자 승인 후 시작할 수 있어요."
              : "우리의 생각이 반짝이는 대화를 열어 주세요."}
          </p>
          {mode !== "reset" && (
            <div className="segmented">
              <button
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                로그인
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                }}
              >
                가입 신청
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
              required
              autoComplete="email"
            />
            {mode !== "reset" && (
              <>
                <label htmlFor="password">비밀번호</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder="8자 이상 입력해 주세요"
                />
              </>
            )}
            <Notice error>{error}</Notice>
            <Notice>{notice}</Notice>
            <button className="button primary full" disabled={busy}>
              {busy
                ? "잠시만 기다려 주세요…"
                : mode === "login"
                  ? "로그인하고 시작하기"
                  : mode === "signup"
                    ? "가입 신청하기"
                    : "재설정 안내 받기"}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => setMode(mode === "reset" ? "login" : "reset")}
          >
            {mode === "reset"
              ? "로그인으로 돌아가기"
              : "비밀번호를 잊으셨나요?"}
          </button>
        </div>
      </main>
    </>
  );
}
