import { test } from "node:test";
import assert from "node:assert/strict";
import { aiRequestAllowed, clearSentDraft } from "../src/lib/composer";

test("global AI stop releases hosts as well as permitted participants from AI mode", () => {
  for (const isHost of [true, false]) {
    const state = { isHost, aiEnabled: true, me: { can_ask_ai: true } };
    assert.equal(aiRequestAllowed(state), true);
    assert.equal(aiRequestAllowed({ ...state, aiEnabled: false }), false);
  }
  assert.equal(
    aiRequestAllowed({
      isHost: false,
      aiEnabled: true,
      me: { can_ask_ai: false },
    }),
    false,
  );
  assert.equal(
    aiRequestAllowed({ isHost: true, aiEnabled: true, me: null }),
    true,
  );
});

test("delayed send completion preserves the next draft", async () => {
  let draft = "첫 발언";
  const sent = draft;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const send = pending.then(() => {
    draft = clearSentDraft(draft, sent);
  });
  draft = "다음 발언을 작성 중";
  finish();
  await send;
  assert.equal(draft, "다음 발언을 작성 중");
  assert.equal(clearSentDraft(sent, sent), "");
  assert.equal(clearSentDraft("", sent), "");
});
