import { describe, it, expect } from "vitest";
import { readPaperBillDataUrl, ocrErrorMessage, MAX_RAW_FILE_BYTES, MAX_DATA_URL_CHARS } from "@/lib/paperBillUpload";

describe("paper bill upload guards", () => {
  it("rejects a file whose base64 would exceed the server limit", async () => {
    const big = new File([new Uint8Array(MAX_RAW_FILE_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    await expect(readPaperBillDataUrl(big)).rejects.toThrow(/File too large/);
  });
  it("accepts a file just under the limit and stays within the server cap", async () => {
    const ok = new File([new Uint8Array(1024)], "ok.jpg", { type: "image/jpeg" });
    const url = await readPaperBillDataUrl(ok);
    expect(url.startsWith("data:")).toBe(true);
    expect(url.length).toBeLessThan(MAX_DATA_URL_CHARS);
  });
  it("maps gateway failures to visible messages", () => {
    expect(ocrErrorMessage(new Error("Auto-read is busy right now (429) — try again in a moment."))).toMatch(/busy/);
    expect(ocrErrorMessage(new Error(""))).toMatch(/Couldn't read this file/);
  });
  it("old 9MB client check would have passed a file the server rejects", () => {
    const raw = 9 * 1024 * 1024 - 1; // passed the old check
    expect(Math.ceil(raw / 3) * 4).toBeGreaterThan(MAX_DATA_URL_CHARS); // server rejects
    expect(raw).toBeGreaterThan(MAX_RAW_FILE_BYTES); // new check rejects it first
  });
});
