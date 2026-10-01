import { describe, it, expect, vi, afterEach } from "vitest";
const state = vi.hoisted(() => ({ pages: 2, destroyed: vi.fn(), renders: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: { workerPort: {} }, getDocument: () => ({ destroy: state.destroyed, promise: Promise.resolve({ numPages: state.pages, getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: (args: unknown) => { state.renders(args); return { promise: Promise.resolve() }; } }) }) }) }));
import { readPaperBillDataUrl } from "./paperBillUpload";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.pages = 2; });
describe("visible PDF OCR input", () => {
  it("sends rendered pixels rather than PDF bytes and keeps both pages", async () => {
    const drawImage = vi.fn();
    const canvases: any[] = [];
    vi.stubGlobal("document", { createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), drawImage }), toDataURL: () => "data:image/png;base64,cGl4ZWxz" };
      canvases.push(canvas); return canvas;
    } });
    const result = await readPaperBillDataUrl(new File(["%PDF-hidden text must not reach OCR"], "scan.pdf", { type: "application/pdf" }));
    expect(result).toBe("data:image/png;base64,cGl4ZWxz");
    expect(state.renders).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0][0]).not.toBe(drawImage.mock.calls[1][0]);
    expect(drawImage.mock.calls[1][2]).toBeGreaterThan(0);
    expect(state.destroyed).toHaveBeenCalledOnce();
  });
  it("rejects excess pages explicitly instead of silently dropping them", async () => {
    state.pages = 5;
    await expect(readPaperBillDataUrl(new File(["%PDF"], "scan.pdf", { type: "application/pdf" }))).rejects.toThrow("up to 4 pages");
    expect(state.destroyed).toHaveBeenCalledOnce();
  });
});
