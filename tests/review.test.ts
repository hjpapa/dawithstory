import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {createReviewPdf} from "../src/lib/review-pdf";
import {reviewContent, type ReviewContent} from "../src/lib/review";
import type {Snapshot} from "../src/lib/domain";

test("review excludes hidden speech and does not call an interim summary final",()=>{
 const content=reviewContent({room:{title:"가상",topic:"주제",round_number:2},members:[],messages:[{visibility:"hidden",role:"member",content:"숨김"},{visibility:"visible",role:"member",content:"공개"}],summary:null} as unknown as Snapshot);
 assert.deepEqual(content.opinions,["공개"]); assert.equal(content.speeches,1); assert.equal(content.final,false);
});
test("long Korean review exports as exactly one A4 page with embedded font",async()=>{
 const text="친구의 의견을 존중하고 근거를 들어 서로 다른 생각을 나눕니다. ";
 const review: ReviewContent={title:text.repeat(10),topic:text.repeat(30),ended:"2026. 10. 7. 오후 9:00:00",participants:30,speeches:300,rounds:10,final:true,overview:text.repeat(20),opinions:Array(5).fill(text.repeat(10)),agreements:Array(3).fill(text.repeat(10)),differences:Array(3).fill(text.repeat(10)),questions:Array(2).fill(text.repeat(10))};
 const font=await fs.readFile("public/fonts/NanumGothic-Regular.ttf");
 const bytes=await createReviewPdf(review,font);
 const pdf=await PDFDocument.load(bytes); assert.equal(pdf.getPageCount(),1);
 assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1); assert.ok(Math.abs(pdf.getPage(0).getHeight()-841.89)<.1);
 await fs.mkdir(".test-artifacts",{recursive:true}); await fs.writeFile(".test-artifacts/review-long.pdf",bytes);
});
