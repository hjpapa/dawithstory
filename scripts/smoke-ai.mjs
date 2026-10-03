import fs from "node:fs";
const key = fs
  .readFileSync(".env.local", "utf8")
  .match(/^OPENAI_API_KEY=(.+)$/m)?.[1]
  .replace(/^"|"$/g, "");
const res = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-6-luna",
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 100,
    input:
      "가상의 토론입니다. 꽃밭 만들기와 공원 청소를 한 문장으로 요약해 주세요.",
  }),
});
const data = await res.json();
console.log(
  JSON.stringify({
    status: res.status,
    model: data.model,
    error: data.error
      ? {
          code: data.error.code,
          type: data.error.type,
          message: data.error.message,
        }
      : undefined,
    text: data.output
      ?.flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join(""),
    usage: data.usage,
  }),
);
