import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
  requestResponse,
} from "../supabase/functions/story-api/provider";

test("101 provider requests succeed without an application quota; storage stays disabled", async () => {
  let calls = 0;
  const mock: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.store, false);
    calls++;
    return Response.json({ id: `synthetic-${calls}`, output: [] });
  };
  for (let n = 0; n < 101; n++)
    await requestResponse("synthetic-key", { input: "가상 대화" }, mock);
  assert.equal(calls, 101);
});

test("rate limits and provider outages are retryable; credential failures are not", async () => {
  for (const status of [429, 500, 503, 401, 403]) {
    await assert.rejects(
      requestResponse(
        "synthetic-key",
        {},
        async () => new Response("", { status }),
      ),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.retry === (status === 429 || status >= 500),
    );
  }
});
