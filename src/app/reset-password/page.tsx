"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Header, Notice, Back } from "@/components/ui";
export default function Reset() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return (
    <>
      <Header />
      <main className="auth-page">
        <Back href="/login" />
        <section className="auth-card">
          <h1>새 비밀번호</h1>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await supabase().auth.updateUser({ password });
              setMessage(
                error
                  ? "재설정 링크를 다시 확인해 주세요."
                  : "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.",
              );
            }}
          >
            <label htmlFor="new-password">새 비밀번호</label>
            <input
              id="new-password"
              type="password"
              minLength={8}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <button className="button primary full">비밀번호 변경</button>
            <Notice>{message}</Notice>
          </form>
        </section>
      </main>
    </>
  );
}
