import { describe, it, expect, vi } from "vitest";
import { fetchAiGatewayWithRetry } from "@/lib/aiGatewayRetry";

const ok = () => new Response("{}", { status: 200 });
const rate = () => new Response("rate limited", { status: 429 });

describe("fetchAiGatewayWithRetry", () => {
  it("retries a 429 and succeeds on the third attempt", async () => {
    const seq = [rate(), rate(), ok()];
    const fetchImpl = vi.fn(async () => seq.shift()!);
    const sleep = vi.fn(async () => {});
    const r = await fetchAiGatewayWithRetry("u", {}, { fetchImpl: fetchImpl as any, sleep });
    expect(r.response?.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.length).toBe(2);
  });
  it("gives up after 3 attempts and reports 429", async () => {
    const fetchImpl = vi.fn(async () => rate());
    const r = await fetchAiGatewayWithRetry("u", {}, { fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.response?.status).toBe(429);
    expect(r.lastError).toContain("429");
  });
  it("does not retry a non-retryable 400", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    const r = await fetchAiGatewayWithRetry("u", {}, { fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.lastError).toContain("400");
  });
  it("retries network errors too", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => { if (++n < 3) throw new Error("socket hang up"); return ok(); });
    const r = await fetchAiGatewayWithRetry("u", {}, { fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(r.response?.status).toBe(200);
    expect(n).toBe(3);
  });
});
