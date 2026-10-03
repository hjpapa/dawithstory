"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, MessageCircle, LogOut, Clock, ArrowUpRight } from "lucide-react";
import { api, supabase } from "@/lib/supabase";
import { KINDS, STATES, type Room } from "@/lib/domain";
import { Header, Mascot, Notice, Modal, Loading } from "@/components/ui";
export default function Dashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [profile, setProfile] = useState<{
    status: string;
    email: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState("discussion");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const me = await api<{
        profile: { status: string; email: string };
        anonymous?: boolean;
      }>("me");
      if (me.anonymous) {
        router.replace("/login");
        return;
      }
      setProfile(me.profile);
      const result = await api<{ rooms: Room[] }>("rooms");
      setRooms(result.rooms);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);
  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const room = await api<Room>("create_room", { title, topic, kind });
      router.push("/room/" + room.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!loaded)
    return (
      <>
        <Header />
        <Loading />
      </>
    );
  return (
    <>
      <Header>
        <span className="nav-email">{profile?.email}</span>
        <button
          className="icon-button"
          aria-label="로그아웃"
          onClick={async () => {
            await supabase().auth.signOut();
            router.push("/");
          }}
        >
          <LogOut size={20} />
        </button>
      </Header>
      <main className="dashboard">
        <div className="dashboard-welcome">
          <div>
            <span className="eyebrow">MY STORY ROOM</span>
            <h1>
              오늘은 어떤 이야기를
              <br />
              나눠볼까요?
            </h1>
            <p>작은 생각이 모여 큰 이야기가 되는 공간이에요.</p>
          </div>
          <Mascot size={190} />
        </div>
        <Notice error>{error}</Notice>
        {profile?.status !== "approved" ? (
          <section className="empty-card">
            <Clock size={35} />
            <h2>
              {profile?.status === "suspended"
                ? "계정 이용이 잠시 멈춰 있어요"
                : "운영자의 승인을 기다리고 있어요"}
            </h2>
            <p>승인 후 나만의 대화방을 열 수 있어요.</p>
            <button className="button secondary" onClick={load}>
              승인 상태 확인
            </button>
          </section>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <h2>
                  나의 대화방 <span className="count">{rooms.length}</span>
                </h2>
                <p>함께 나눈 이야기들을 만나보세요.</p>
              </div>
              <button
                className="button primary"
                onClick={() => setCreate(true)}
              >
                <Plus size={19} />새 대화방 만들기
              </button>
            </div>
            <div className="filter-tabs">
              {[
                ["all", "전체"],
                ["active", "이야기 중"],
                ["draft", "준비 중"],
                ["ended", "지난 이야기"],
              ].map(([v, t]) => (
                <button
                  key={v}
                  className={filter === v ? "active" : ""}
                  onClick={() => setFilter(v)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="room-grid">
              {rooms
                .filter((r) => filter === "all" || r.state === filter)
                .map((r) => (
                  <Link href={"/room/" + r.id} className="room-card" key={r.id}>
                    <div className="room-card-top">
                      <span className={"kind-icon " + r.kind}>
                        {r.kind === "daily"
                          ? "🌷"
                          : r.kind === "debate"
                            ? "💡"
                            : "💬"}
                      </span>
                      <span className={"status-badge " + r.state}>
                        {STATES[r.state]}
                      </span>
                    </div>
                    <span className="room-kind">{KINDS[r.kind]}</span>
                    <h3>{r.title}</h3>
                    <p>{r.topic}</p>
                    <div className="room-card-foot">
                      <span>
                        {new Date(r.created_at).toLocaleDateString("ko-KR")}
                      </span>
                      <ArrowUpRight size={20} />
                    </div>
                  </Link>
                ))}
              <button
                className="room-card new-room"
                onClick={() => setCreate(true)}
              >
                <span>
                  <Plus size={30} />
                </span>
                <h3>새로운 이야기를 열어요</h3>
                <p>주제 하나면 시작할 수 있어요</p>
              </button>
            </div>
          </>
        )}
      </main>
      {create && (
        <Modal title="새로운 이야기 만들기" close={() => setCreate(false)}>
          <form onSubmit={createRoom}>
            <label htmlFor="room-title">대화방 이름</label>
            <input
              id="room-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={100}
              placeholder="우리의 반짝이는 생각 모음"
            />
            <label htmlFor="topic">함께 나눌 주제</label>
            <textarea
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              maxLength={1000}
              placeholder="어떤 이야기를 나누고 싶나요?"
            />
            <label htmlFor="kind">이야기 방식</label>
            <select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Notice error>{error}</Notice>
            <button className="button primary full" disabled={busy}>
              <MessageCircle size={18} />
              대화방 만들기
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
