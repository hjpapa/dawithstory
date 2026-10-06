import { ProviderError } from "./provider.ts";

export function safety(text: string) {
  if (/(?:01[016789][ -]?\d{3,4}[ -]?\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{6}[ -]?[1-4]\d{6})/.test(text))
    return "연락처 등 개인정보가 포함되어 있을 수 있어요.";
  if (/(죽여버|죽여 버|자살|자해|강간|아동.{0,4}음란|씨발|시발놈|병신)/.test(text))
    return "안전을 위해 진행자의 확인이 필요해요.";
  return null;
}

export async function moderate(key: string, text: string, transport: typeof fetch = fetch) {
  const local = safety(text);
  if (local) return local;
  const res = await transport("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new ProviderError("AI 안전 확인이 지연되고 있어요.", res.status === 429 || res.status >= 500);
  const data = await res.json();
  if (!Array.isArray(data.results) || data.results.length === 0) throw new Error("AI 안전 확인 결과를 확인하지 못했어요.");
  return data.results.some((r: { flagged: boolean }) => r.flagged)
    ? "안전을 위해 진행자의 확인이 필요해요."
    : null;
}

export async function incomingSafety(key: string | null, text: string, aiRequest: boolean, transport: typeof fetch = fetch) {
  const local = safety(text);
  if (local || key === null) return { reason: local, degraded: false };
  try {
    return { reason: await moderate(key, text, transport), degraded: false };
  } catch {
    if (aiRequest) throw new Error("AI 안전 확인이 지연되고 있어요. 일반 대화는 계속할 수 있어요.");
    return { reason: null, degraded: true };
  }
}
