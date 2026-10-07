"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Printer, RefreshCw } from "lucide-react";
import type { Snapshot } from "@/lib/domain";
import { reviewContent } from "@/lib/review";
import { Header, Mascot, Notice } from "./ui";

export function DiscussionReview({data, retry, demo, records}: {data: Snapshot; retry: () => Promise<unknown>; demo: boolean; records?: () => void}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const review = reviewContent(data);
  const pending = ["queued","running"].includes(data.reviewJob?.status || "");
  async function download() {
    setBusy(true); setError("");
    try {
      const [{createReviewPdf}, response] = await Promise.all([import("@/lib/review-pdf"),fetch("/fonts/NanumGothic-Regular.ttf")]);
      if (!response.ok) throw new Error("한글 글꼴을 불러오지 못했어요. 다시 시도해 주세요.");
      const bytes = await createReviewPdf(review,new Uint8Array(await response.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"application/pdf"}));
      const a = document.createElement("a"); a.href=url; a.download=`다함께이야기-${review.title.replace(/[\\/:*?"<>|]/g,"_").slice(0,50)}-요약.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url),60000);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <><div className="review-no-print"><Header /></div><main className="review-page">
    <div className="review-welcome review-no-print"><Mascot size={82}/><div><span className="eyebrow">OUR STORY, TOGETHER</span><h1>우리의 이야기를 돌아봐요 ✨</h1><p>대화가 끝났어요. 함께 나눈 생각을 간직해 주세요.</p></div></div>
    <div className="review-actions review-no-print">
      <button className="button primary" disabled={busy || pending} onClick={download}><Download size={18}/>{busy ? "PDF 만드는 중…" : "A4 한 장 PDF 저장"}</button>
      <button className="button secondary" disabled={busy || pending} onClick={download}><Printer size={18}/>인쇄용 PDF 받기</button>
      <Link className="button secondary" href={data.isHost ? "/dashboard" : "/"}>{data.isHost ? "내 대화방으로" : "처음으로"}</Link>
      {data.isHost && records && <button className="button secondary" onClick={records}>진행자 기록 관리</button>}
    </div>
    <p className="review-no-print review-help">저장한 PDF를 열고 인쇄하면 A4 한 페이지로 출력할 수 있어요. 기록은 종료 후 90일 동안 보관되며 진행자가 먼저 삭제할 수 있어요.</p>
    <Notice error>{error}</Notice>
    {pending && <Notice>이야기별이 마지막 발언까지 모아 최종 요약을 만들고 있어요. 완료되면 자동으로 바뀝니다.</Notice>}
    {!review.final && !pending && <Notice>{data.reviewJob?.error || (data.aiEnabled ? "최종 요약이 아직 없어요. 아래는 기존 정리 또는 공개 발언 발췌입니다." : "AI가 중지되어 있어 기존 정리 또는 공개 발언 발췌를 보여드려요.")}</Notice>}
    {!review.final && !pending && data.isHost && data.aiEnabled && !demo && <button className="button secondary review-no-print" disabled={busy} onClick={async()=>{setBusy(true);try{await retry();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><RefreshCw size={16}/>최종 요약 다시 만들기</button>}
    <article className="review-sheet">
      <div className="review-sheet-label">다함께 이야기 · {review.final ? "최종 대화 요약" : "임시 대화 정리"}{demo ? " · 체험 예시" : ""}</div>
      <h2>{review.title}</h2><p className="review-topic">{review.topic}</p>
      <div className="review-meta"><span>{review.ended}</span><span>참여자 {review.participants}명</span><span>공개 발언 {review.speeches}개</span><span>{review.rounds}차례</span></div>
      <p className="review-overview">{review.overview}</p>
      {([['💡 주요 의견과 근거',review.opinions],['🤝 함께 동의한 점',review.agreements],['🌱 서로 다른 생각',review.differences],['❓ 남은 질문과 다음 이야기',review.questions]] as [string,string[]][]).map(([title,items])=><section className="review-section" key={title}><h3>{title}</h3>{items.length?<ul>{items.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p>기록된 내용이 없어요.</p>}</section>)}
      <p className="review-help">AI가 정리한 내용은 아래 공개 발언 원문과 함께 확인해 주세요. 합의되지 않은 의견을 모두의 결론으로 받아들이지 않아요.</p>
    </article>
    <details className="review-transcript review-no-print"><summary>공개 대화 기록 전체 보기</summary>{data.messages.filter(m=>m.visibility==="visible").map(m=><article key={m.id}><b>{m.avatar} {m.nickname}</b><small>{m.round_number ? `${m.round_number}번째 차례` : "이야기별"} · #{m.id}</small><p>{m.content}</p></article>)}</details>
  </main></>;
}

