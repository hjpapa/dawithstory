import Link from "next/link";
import { Header, Notice, Back } from "@/components/ui";
export default function Reset() {
  return (
    <>
      <Header />
      <main className="auth-page">
        <Back href="/login" />
        <section className="auth-card">
          <h1>비밀번호 초기화 안내</h1>
          <Notice>
            가입한 아이디를 운영자에게 알려 주세요. 운영자가 본인 확인 후
            비밀번호를 초기화해 드려요. 이메일 재설정 링크는 사용하지 않아요.
          </Notice>
          <Link href="/login" className="button primary full">
            로그인으로 돌아가기
          </Link>
        </section>
      </main>
    </>
  );
}
