import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOpenAiOcr } from "../openAiOcr.server";

afterEach(() => vi.unstubAllEnvs());
const success = (content = '{"name":{"v":"Test Rider","c":0.95}}', finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }));

describe("direct OpenAI OCR", () => {
  it("keeps credentials server-side and disables stored completions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const send = vi.fn().mockResolvedValue(success());
    const result = await requestOpenAiOcr([{ role: "user", content: "Read JSON" }], 1600, send);
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(options.body)).toMatchObject({ store: false, response_format: { type: "json_object" } });
    expect(result.name).toEqual({ v: "Test Rider", c: 0.95 });
  });
  it("stops immediately for insufficient quota rather than retrying 429", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }));
    await expect(requestOpenAiOcr([], 1600, send)).rejects.toThrow("402");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retries transient throttling", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const send = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 })).mockResolvedValueOnce(success());
    await requestOpenAiOcr([], 1600, send, async () => {});
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([["{}", "stop"], ["broken", "stop"], ["{}", "length"]])("rejects empty, malformed, and truncated responses", async (content, finish) => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    await expect(requestOpenAiOcr([], 1600, vi.fn().mockResolvedValue(success(content, finish)))).rejects.toThrow("Auto-read");
  });
  it("never exposes a provider error body", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-secret");
    const send = vi.fn().mockResolvedValue(new Response('{"error":{"message":"sensitive input"}}', { status: 400 }));
    await expect(requestOpenAiOcr([], 1600, send)).rejects.toThrow("Auto-read could not process this document (400).");
  });
  it("does not call the provider without a credential", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const send = vi.fn();
    await expect(requestOpenAiOcr([], 1600, send)).rejects.toThrow("403");
    expect(send).not.toHaveBeenCalled();
  });
});
