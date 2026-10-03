/** Provider failures affect the durable AI job, never the chat transaction. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public retry: boolean,
  ) {
    super(message);
  }
}

export async function requestResponse(
  apiKey: string,
  payload: Record<string, unknown>,
  transport: typeof fetch = fetch,
) {
  const response = await transport("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(80000),
    body: JSON.stringify({ ...payload, model: "gpt-6-luna", store: false }),
  });
  if (!response.ok) {
    throw new ProviderError(
      response.status === 429
        ? "AI가 잠시 붐벼요. 자동으로 다시 시도할게요."
        : `AI 연결에 문제가 있어요. (${response.status})`,
      response.status === 429 || response.status >= 500,
    );
  }
  return response.json();
}
