/**
 * Retry wrapper for AI Gateway calls.
 *
 * Several billers upload paper bills at the same moment, which makes the
 * gateway answer 429 for a short burst. A single bounce used to surface as a
 * hard "auto-read failed", so we retry 429s and transient 5xx with a growing
 * delay. No timeout is ever placed on the request itself — a slow multi-page
 * read must be allowed to finish.
 */
export type GatewayRetryResult = {
  response: Response | null;
  attempts: number;
  lastError: string;
};

export async function fetchAiGatewayWithRetry(
  url: string,
  init: RequestInit,
  opts: {
    maxAttempts?: number;
    /** Delay in ms before attempt n+1 (1-indexed attempt that just failed). */
    delayMs?: (attempt: number) => number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    label?: string;
  } = {},
): Promise<GatewayRetryResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs = opts.delayMs ?? ((attempt: number) => (attempt === 1 ? 1000 : 3000));
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const label = opts.label ?? "ai-gateway";

  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === maxAttempts) return { response: null, attempts: attempt, lastError };
      await sleep(delayMs(attempt));
      continue;
    }
    if (response.ok) return { response, attempts: attempt, lastError: "" };

    const retryable = response.status === 429 || response.status >= 500;
    const text = await response.text().catch(() => "");
    lastError = `${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`;
    console.log(
      `[${label}] gateway ${response.status} on attempt ${attempt}/${maxAttempts}${retryable ? " (retrying)" : ""}`,
    );
    if (!retryable || attempt === maxAttempts)
      return { response, attempts: attempt, lastError };
    await sleep(delayMs(attempt));
  }
  return { response: null, attempts: maxAttempts, lastError };
}
