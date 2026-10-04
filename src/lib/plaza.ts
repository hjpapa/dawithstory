import type { Message } from "./domain";
export type Speaker = {
  role: "host" | "ai" | "member" | "all";
  memberId?: string;
};
export function speakerMessages(messages: Message[], speaker: Speaker) {
  if (speaker.role === "all") return messages;
  return messages.filter((m) =>
    speaker.role === "member"
      ? m.member_id === speaker.memberId
      : m.role === speaker.role,
  );
}
export function latestVisibleMessage(messages: Message[], speaker: Speaker) {
  return speakerMessages(messages, speaker)
    .filter((message) => message.visibility === "visible")
    .at(-1);
}
// Membership order stays stable; a central seat is reserved for the host.
export function plazaSeats(count: number) {
  const columns = count <= 8 ? 3 : 5;
  const rows = Math.max(3, Math.ceil((count + 1) / columns));
  const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
  const position = (index: number) => ({
    gridRow: Math.floor(index / columns) + 1,
    gridColumn: (index % columns) + 1,
  });
  return {
    columns,
    host: position(center),
    members: Array.from({ length: count }, (_, i) =>
      position(i < center ? i : i + 1),
    ),
  };
}
