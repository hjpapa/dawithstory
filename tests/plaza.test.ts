import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATARS,
  AVATAR_CATALOG,
} from "../supabase/functions/story-api/avatars";
import {
  plazaSeats,
  speakerMessages,
  latestVisibleMessage,
} from "../src/lib/plaza";
import type { Message } from "../src/lib/domain";
test("all 50 named characters are distinct and retain the original avatars", () => {
  assert.equal(AVATARS.length, 50);
  assert.equal(new Set(AVATARS).size, 50);
  assert.equal(new Set(AVATAR_CATALOG.map((a) => a.name)).size, 50);
  for (const a of ["🐰", "🐻", "🐱", "🐼", "🐸", "🦊", "🐨", "🐥"])
    assert.ok(AVATARS.includes(a));
});
test("every occupancy through 30 seats has a distinct place and a reserved host", () => {
  for (let count = 0; count <= 30; count++) {
    const layout = plazaSeats(count);
    const occupied = [layout.host, ...layout.members].map(
      (s) => `${s.gridRow}:${s.gridColumn}`,
    );
    assert.equal(new Set(occupied).size, count + 1);
    assert.ok(layout.members.every((s) => s.gridColumn <= layout.columns));
  }
});
test("conversation retains the latest public speech across rounds and preserves chronological history", () => {
  const make = (
    id: number,
    round_number: number | null,
    visibility = "visible",
    member_id = "a",
  ) =>
    ({
      id,
      round_number,
      visibility,
      member_id,
      role: "member",
      content: `speech ${id}`,
    }) as Message;
  const messages = [
    make(1, null),
    make(2, 1),
    make(3, 2, "held"),
    make(4, 2, "hidden"),
    make(5, 2, "visible", "b"),
  ];
  assert.deepEqual(
    speakerMessages(messages, { role: "member", memberId: "a" }).map(
      (m) => m.id,
    ),
    [1, 2, 3, 4],
  );
  assert.equal(
    latestVisibleMessage(messages, { role: "member", memberId: "a" })?.id,
    2,
  );
  assert.equal(
    latestVisibleMessage(messages, { role: "member", memberId: "b" })?.id,
    5,
  );
  assert.deepEqual(
    speakerMessages(messages, { role: "all" }).map((m) => m.id),
    [1, 2, 3, 4, 5],
  );
  messages.push(make(6, 3));
  assert.equal(
    latestVisibleMessage(messages, { role: "member", memberId: "a" })?.id,
    6,
  );
});
