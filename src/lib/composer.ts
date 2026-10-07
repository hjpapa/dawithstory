/** Global AI availability applies to hosts as well as participants. */
export function aiRequestAllowed(state: {
  aiEnabled: boolean;
  isHost: boolean;
  me?: { can_ask_ai?: boolean } | null;
}) {
  return state.aiEnabled && (state.isHost || !!state.me?.can_ask_ai);
}

/** A completed send must not erase a draft edited while the request was pending. */
export function clearSentDraft(current: string, sent: string) {
  return current === sent ? "" : current;
}
