"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { AvatarPicker } from "@/components/avatar-picker";
import { api, supabase } from "@/lib/supabase";
import { Header, Mascot, Notice } from "@/components/ui";
export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<string>("🐰");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState(false);
  useEffect(() => {
    const invitation = new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase();
    if (invitation && /^[A-Z0-9]{8}$/.test(invitation)) {
      setCode(invitation);
      setInvited(true);
    }
  }, []);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const client = supabase();
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        const { error } = await client.auth.signInAnonymously();
        if (error)
          throw new Error(
            "참여 연결을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
          );
      }
      const member = await api<{ room_id: string }>("join", {
        code,
        nickname,
        avatar,
      });
      router.push(`/room/${member.room_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className={`home ${invited ? "invited-home" : ""}`}>
        <section className="welcome-hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span />
              작은 생각도, 함께 나누면 반짝!
            </div>
            <h1>
              우리의 이야기가
              <br />
              <span>
                반짝이는 시간<span className="title-star">✦</span>
              </span>
            </h1>
            <p className="hero-description">
              다른 생각이 만나 더 재미있는 대화.
              <br />
              AI 친구 이야기별과 함께 마음껏 나눠요!
            </p>
            <div className="hero-pills">
              <span>
                <Users size={16} />
                함께하는 30명
              </span>
              <span>
                <Sparkles size={16} />
                AI가 차곡차곡 정리
              </span>
            </div>
            <div className="hero-art">
              <div className="art-orbit" />
              <div className="floating-note note-one">
                <span>🐰</span>내 생각은 말이야…
              </div>
              <Mascot size={315} />
              <div className="floating-note note-two">
                <span>💡</span>와, 새로운 생각이네!
              </div>
              <span className="decor-star star-one">✧</span>
              <span className="decor-star star-two">✦</span>
              <div className="mascot-caption">
                반가워요! 저는 <b>이야기별</b>이에요
              </div>
            </div>
          </div>
          <div className="join-card" id="join">
            <div className="card-label">
              <span className="label-icon">
                <MessageCircle size={20} />
              </span>
              이야기 속으로 쏙!
            </div>
            <h2>함께 이야기할까요?</h2>
            <p>{invited ? "초대 코드가 준비됐어요! 별명과 캐릭터를 골라 주세요." : "초대 코드와 나만의 별명만 있으면 준비 끝!"}</p>
            <form onSubmit={join}>
              <label htmlFor="code">
                초대 코드 <span>진행자에게 받은 코드</span>
              </label>
              <input
                id="code"
                className="code-input"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                placeholder="8자리 코드를 입력해요"
                maxLength={8}
                minLength={8}
                required
                autoComplete="off"
              />
              <label htmlFor="nickname">나의 별명</label>
              <input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="어떤 이름으로 불러드릴까요?"
                maxLength={16}
                required
                autoComplete="nickname"
              />
              <AvatarPicker value={avatar} onChange={setAvatar} />
              <Notice error>{error}</Notice>
              <button className="button primary join-button" disabled={busy}>
                {busy ? "문을 두드리는 중…" : "이야기 참여하기"}
                <ArrowRight size={20} />
              </button>
            </form>
            <div className="join-hint">
              <ShieldCheck size={16} />
              진행자가 확인하면 대화방에 들어갈 수 있어요.
            </div>
            <div className="card-divider" />
            <div className="host-prompt">
              <span>이야기를 이끌고 싶다면?</span>
              <Link href="/login">
                진행자로 시작하기 <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>
        <section className="ways-section">
          <div className="section-caption">
            <span>OUR LITTLE CONVERSATIONS</span>
            <h2>어떤 이야기든 좋아요</h2>
            <p>서로의 생각을 존중하며, 함께 한 걸음 더.</p>
          </div>
          <div className="ways-grid">
            <article className="way-card blue">
              <span className="way-emoji">💬</span>
              <div>
                <h3>생각을 모으는 토의</h3>
                <p>
                  여러 생각을 모아
                  <br />
                  우리만의 답을 찾아봐요.
                </p>
              </div>
              <span className="tiny-sticker">함께 생각해요</span>
            </article>
            <article className="way-card pink">
              <span className="way-emoji">💡</span>
              <div>
                <h3>시야를 넓히는 토론</h3>
                <p>
                  다른 의견도 귀 기울이며
                  <br />
                  생각의 폭을 넓혀봐요.
                </p>
              </div>
              <span className="tiny-sticker">다름도 좋아요</span>
            </article>
            <article className="way-card mint">
              <span className="way-emoji">🌷</span>
              <div>
                <h3>마음을 나누는 일상</h3>
                <p>
                  오늘 있었던 작은 일도
                  <br />
                  다정하게 나눠봐요.
                </p>
              </div>
              <span className="tiny-sticker">편하게 말해요</span>
            </article>
          </div>
        </section>
        <section className="together-strip">
          <span className="round-star">
            <Star fill="currentColor" size={26} />
          </span>
          <div>
            <h3>좋은 이야기는, 따뜻한 칭찬으로!</h3>
            <p>좋은 질문, 귀 기울임, 배려하는 말에 칭찬 별을 모아봐요.</p>
          </div>
          <Heart size={30} className="strip-heart" />
        </section>
      </main>
      <footer className="footer">
        <span>
          다함께 이야기 <span className="footer-dot">·</span> 모든 생각이 소중한
          곳
        </span>
        <div>
          <Link href="/privacy">개인정보 안내</Link>
          <Link href="/admin">운영자</Link>
        </div>
      </footer>
    </>
  );
}
