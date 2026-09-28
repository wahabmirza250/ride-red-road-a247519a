/** Server-only document vision. Credentials never enter browser bundles. */
export async function requestOpenAiOcr(
  messages: unknown[],
  maxTokens = 1600,
  fetchImpl: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("403 Auto-read is not configured. Contact your administrator.");

  const body = JSON.stringify({
    model: process.env.OPENAI_OCR_MODEL || "gpt-4.1",
    messages,
    temperature: 0,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    store: false,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error("Auto-read temporarily unavailable. Please retry.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      // Quota exhaustion also uses HTTP 429. It must stop a batch, not retry
      // every document as if the provider were briefly busy.
      if (payload?.error?.code === "insufficient_quota" || response.status === 402)
        throw new Error("402 Auto-read is out of AI credits. Contact your administrator.");
      if (response.status === 401 || response.status === 403)
        throw new Error("403 Auto-read access is disabled. Contact your administrator.");
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        throw new Error(response.status === 429
          ? "Auto-read is busy (429). Please retry in a moment."
          : "Auto-read temporarily unavailable. Please retry.");
      }
      // Do not expose provider response bodies, which can contain input data.
      throw new Error(`Auto-read could not process this document (${response.status}).`);
    }
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason !== "stop" || choice?.message?.refusal)
      throw new Error("Auto-read did not finish reading this document. Try a clearer or smaller file.");
    try {
      const result = JSON.parse(choice.message.content);
      if (!result || typeof result !== "object" || Array.isArray(result) || !Object.keys(result).length)
        throw new Error("Invalid result");
      return result;
    } catch {
      throw new Error("Auto-read returned an unreadable result. Please retry or enter the details manually.");
    }
  }
  throw new Error("Auto-read temporarily unavailable.");
}
