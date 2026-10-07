"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Users, MessageCircle, Sparkles, LogOut } from "lucide-react";
import { adminApi as api } from "@/lib/supabase";
import { STATES, type Room } from "@/lib/domain";
import { Header, Mascot, Notice, Loading, Modal } from "@/components/ui";
type AdminData = {
  profiles: { id: string; email: string; status: string }[];
  rooms: Room[];
  usage: {
    completed: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
  aiEnabled: boolean;
};
export default function Admin() {
  const [signed, setSigned] = useState<boolean | null>(null);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enable, setEnable] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [resetUser, setResetUser] = useState<{
    id: string;
    email: string;
  } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<AdminData>("admin_overview"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    fetch("/api/admin")
      .then((r) => r.json())
      .then((d) => setSigned(d.admin))
      .catch(() => setSigned(false));
  }, []);
  useEffect(() => {
    if (signed) load();
  }, [signed, load]);
  async function change(action: string, payload: Record<string, unknown>) {
    try {
      setError("");
      await api(action, payload);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  if (signed === null)
    return (
      <>
        <Header />
        <Loading />
      </>
    );
  if (!signed)
    return (
      <>
        <Header />
        <main className="auth-page">
          <section className="auth-card">
            <Mascot size={100} />
            <h1>운영자 공간</h1>
            <p>이야기가 안전하게 이어지도록 돌봐요.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const res = await fetch("/api/admin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id, password }),
                  });
                  const result = await res.json();
                  if (!res.ok) throw new Error(result.error);
                  setPassword("");
                  setSigned(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label htmlFor="admin-id">운영자 아이디</label>
              <input
                id="admin-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoComplete="username"
                required
              />
              <label htmlFor="admin-password">비밀번호</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <Notice error>{error}</Notice>
              <button className="button primary full" disabled={busy}>
                운영자 로그인
              </button>
            </form>
          </section>
        </main>
      </>
    );
  return (
    <>
      <Header>
        <span className="badge yellow">
          <Shield size={15} />
          운영자
        </span>
        <button
          className="icon-button"
          aria-label="운영자 로그아웃"
          onClick={async () => {
            await fetch("/api/admin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logout: true }),
            });
            setSigned(false);
          }}
        >
          <LogOut size={19} />
        </button>
      </Header>
      <main className="dashboard">
        <div className="section-heading">
          <div>
            <span className="eyebrow">STORY CARE</span>
            <h1>함께하는 이야기를 돌봐요</h1>
            <p>가입 승인과 대화방, AI 사용 현황을 한눈에.</p>
          </div>
          <button className="button secondary" onClick={load}>
            새로고침
          </button>
        </div>
        <Notice error>{error}</Notice>
        <Notice>{notice}</Notice>
        {data && (
          <>
            <div className="stats-grid">
              <article>
                <Users />
                <span>승인 대기</span>
                <b>
                  {data.profiles.filter((p) => p.status === "pending").length}
                </b>
              </article>
              <article>
                <MessageCircle />
                <span>전체 대화방</span>
                <b>{data.rooms.length}</b>
              </article>
              <article>
                <Sparkles />
                <span>AI 완료 요청 · 횟수 제한 없음</span>
                <b>{data.usage.completed}</b>
                <small>
                  예상 비용 ${Number(data.usage.cost_usd).toFixed(4)}
                </small>
              </article>
            </div>
            <section className="admin-section">
              <div className="section-heading">
                <div>
                  <h2>이야기별 연결</h2>
                  <p>
                    {data.aiEnabled
                      ? "실제 대화의 AI 요약과 질문이 활성화되어 있어요."
                      : "일반 채팅은 이용할 수 있으며, AI는 연결 준비 중이에요."}
                  </p>
                </div>
                <button
                  className={
                    "button " + (data.aiEnabled ? "secondary" : "primary")
                  }
                  onClick={() =>
                    data.aiEnabled
                      ? change("admin_ai", { enabled: false })
                      : setEnable(true)
                  }
                >
                  {data.aiEnabled ? "AI 연결 멈추기" : "AI 연결 설정"}
                </button>
              </div>
            </section>
            <section className="admin-section">
              <h2>진행자 계정</h2>
              {data.profiles.length === 0 ? (
                <p className="subtle">아직 가입 신청이 없어요.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>아이디 (이메일 형식)</th>
                        <th>상태</th>
                        <th>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.profiles.map((p) => (
                        <tr key={p.id}>
                          <td>{p.email}</td>
                          <td>
                            <span className="badge">
                              {p.status === "approved"
                                ? "승인"
                                : p.status === "pending"
                                  ? "승인 대기"
                                  : "이용 정지"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="button small secondary"
                              onClick={() => {
                                setResetUser(p);
                                setNewPassword("");
                                setRepeatPassword("");
                                setResetError("");
                                setNotice("");
                              }}
                            >
                              비밀번호 초기화
                            </button>
                            {p.status !== "approved" && (
                              <button
                                className="button small primary"
                                onClick={() =>
                                  change("admin_profile", {
                                    user_id: p.id,
                                    status: "approved",
                                  })
                                }
                              >
                                승인
                              </button>
                            )}
                            {p.status === "approved" && (
                              <button
                                className="button small secondary"
                                onClick={() =>
                                  change("admin_profile", {
                                    user_id: p.id,
                                    status: "suspended",
                                  })
                                }
                              >
                                이용 정지
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="admin-section">
              <h2>전체 대화방</h2>
              <div className="admin-rooms">
                {data.rooms.map((r) => (
                  <Link key={r.id} href={"/room/" + r.id + "?view=admin"}>
                    <span>
                      {r.title}
                      <small>{r.topic}</small>
                    </span>
                    <span className={"status-badge " + r.state}>
                      {STATES[r.state]}
                    </span>
                  </Link>
                ))}
                {data.rooms.length === 0 && (
                  <p className="subtle">첫 이야기를 기다리고 있어요.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      {resetUser && (
        <Modal
          title="진행자 비밀번호 초기화"
          close={() => {
            if (!resetBusy) {
              setResetUser(null);
              setNewPassword("");
              setRepeatPassword("");
            }
          }}
        >
          <p>
            <b>{resetUser.email}</b> 계정의 본인을 확인한 뒤 새 비밀번호를 정해
            주세요. 기존 로그인은 해제되고 진행 중인 방은 일시정지돼요.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (resetBusy) return;
              if (newPassword !== repeatPassword) {
                setResetError("두 비밀번호가 같지 않아요.");
                return;
              }
              setResetBusy(true);
              setResetError("");
              try {
                await api("admin_password", {
                  user_id: resetUser.id,
                  password: newPassword,
                });
                setNotice(
                  `${resetUser.email}의 비밀번호를 초기화했어요. 새 비밀번호를 본인에게 안전하게 전달해 주세요.`,
                );
                setResetUser(null);
                setNewPassword("");
                setRepeatPassword("");
              } catch (e) {
                setResetError((e as Error).message);
              } finally {
                setResetBusy(false);
              }
            }}
          >
            <label htmlFor="reset-new">새 비밀번호</label>
            <input
              id="reset-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <label htmlFor="reset-repeat">새 비밀번호 확인</label>
            <input
              id="reset-repeat"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
            />
            <Notice error>{resetError}</Notice>
            <button className="button primary full" disabled={resetBusy}>
              {resetBusy ? "변경 중이에요…" : "비밀번호 초기화하기"}
            </button>
          </form>
        </Modal>
      )}
      {enable && (
        <Modal title="실제 대화에 AI 연결하기" close={() => setEnable(false)}>
          <p>
            어린이도 이용하는 서비스입니다. 아동 개인정보 처리에 필요한 OpenAI
            Zero Data Retention 설정과 이용 안내·동의 절차를 확인한 뒤 활성화해
            주세요.
          </p>
          <p>
            <a
              href="https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI 미성년자 대상 안내
            </a>
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            데이터 처리 조건을 확인했습니다
          </label>
          <button
            className="button primary full"
            disabled={!confirmed}
            onClick={async () => {
              const ok = await change("admin_ai", {
                enabled: true,
                confirmation: "데이터 처리 조건을 확인했습니다",
              });
              if (ok) setEnable(false);
            }}
          >
            AI 연결 활성화
          </button>
        </Modal>
      )}
    </>
  );
}
