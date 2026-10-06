import { test } from "node:test";
import assert from "node:assert/strict";
import { incomingSafety, moderate } from "../supabase/functions/story-api/safety";
const outage = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
test("provider outage preserves ordinary chat but never bypasses local PII/harm checks", async () => {
  assert.deepEqual(await incomingSafety("fake", "공원에 꽃을 심어요", false, outage), { reason: null, degraded: true });
  assert.ok((await incomingSafety("fake", "010-1234-5678", false, outage)).reason);
  assert.ok((await incomingSafety("fake", "죽여버리겠어", false, outage)).reason);
  await assert.rejects(incomingSafety("fake", "요약해줘", true, outage));
});
test("flagged speech stays held and output moderation outages are retryable", async () => {
  const flagged = (async () => Response.json({ results: [{ flagged: true }] })) as typeof fetch;
  assert.ok((await incomingSafety("fake", "검증 발언", false, flagged)).reason);
  await assert.rejects(moderate("fake", "가상 답변", outage), (error: unknown) => (error as { retry: boolean }).retry === true);
});
