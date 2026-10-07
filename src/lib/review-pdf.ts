import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReviewContent } from "./review";

export async function createReviewPdf(review: ReviewContent, fontBytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/\s+/g, " ")).filter(c => supported.has(c.codePointAt(0)!)).join("");
  const cut = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "…" : s;
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(.15, .23, .29), blue = rgb(.18, .48, .65);
  let y = 793;
  function paragraph(text: string, size: number, maxLines: number) {
    const chars = Array.from(clean(text)); const lines: string[] = []; let line = "";
    for (const char of chars) {
      if (font.widthOfTextAtSize(line + char, size) > 507) { lines.push(line); line = char; }
      else line += char;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) lines[maxLines - 1] = cut(lines[maxLines - 1], Math.max(1, lines[maxLines - 1].length - 1)) + "…";
    for (const value of lines.slice(0, maxLines)) { page.drawText(value, {x:44,y,size,font,color:ink}); y -= size * 1.5; }
  }
  page.drawRectangle({x:0,y:817,width:595.28,height:25,color:rgb(.88,.96,.99)});
  page.drawText("다함께 이야기 | 한 장으로 돌아보기", {x:44,y,size:11,font,color:blue}); y -= 31;
  paragraph(cut(review.title,100),18,2); y -= 5;
  paragraph("주제: " + cut(review.topic,180),10,4); y -= 8;
  paragraph(`${review.ended} · 참여자 ${review.participants}명 · 공개 발언 ${review.speeches}개 · ${review.rounds}차례`,9,2); y -= 13;
  paragraph(review.final ? "최종 AI 요약" : "임시 정리 · 최종 AI 요약이 아닙니다",10,1); y -= 7;
  paragraph(cut(review.overview,200),10,4); y -= 12;
  const sections: [string,string[],number,number][] = [
    [review.final ? "주요 의견과 근거" : "주요 의견 / 발언 발췌",review.opinions,4,80],
    ["함께 동의한 점",review.agreements,2,80],
    ["서로 다른 생각",review.differences,2,80],
    ["남은 질문과 다음 이야기",review.questions,2,80],
  ];
  for (const [heading,items,count,limit] of sections) {
    page.drawText(heading,{x:44,y,size:11,font,color:blue}); y -= 19;
    if (!items.length) paragraph("기록된 내용이 없습니다.",9.5,1);
    for (const item of items.slice(0,count)) paragraph("• " + cut(item,limit),9.5,2);
    y -= 12;
  }
  if (y < 55) throw new Error("요약이 한 장보다 길어요. 내용을 확인해 주세요.");
  page.drawLine({start:{x:44,y:45},end:{x:551,y:45},thickness:.6,color:rgb(.8,.85,.87)});
  page.drawText("한 장에 맞춰 일부 문장을 줄였습니다. 전체 요약·원문은 정리 화면에서 확인해 주세요.",{x:44,y:30,size:8,font,color:ink});
  pdf.setTitle("다함께 이야기 - " + clean(review.title));
  return pdf.save();
}

