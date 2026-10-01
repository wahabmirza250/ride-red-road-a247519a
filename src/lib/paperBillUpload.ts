/**
 * Shared client-side helpers for reading a paper bill file before it is sent
 * to the OCR server function.
 *
 * The server validator rejects any data URL longer than 12,000,000 characters.
 * Base64 inflates bytes by ~4/3 (plus the small mime prefix), so a raw-byte
 * check on the file alone can pass on the client and still fail on the server.
 * Everything here measures the ENCODED size, exactly like the server does, so
 * a file that passes this check can never be rejected for size later.
 */
export const MAX_DATA_URL_CHARS = 12_000_000;

/** Roughly the largest raw file that still encodes under the server limit. */
export const MAX_RAW_FILE_BYTES = Math.floor((MAX_DATA_URL_CHARS - 200) * 0.75);

export const FILE_TOO_LARGE_MESSAGE =
  "File too large â€” use a smaller photo or a lower-resolution PDF (about 8 MB max).";

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file from your device"));
    reader.readAsDataURL(file);
  });
}

/**
 * Reads the file and enforces the same encoded-size limit the server enforces.
 * Throws a user-facing Error when the encoded payload would be rejected.
 */
export async function readPaperBillDataUrl(file: File): Promise<string> {
  if (file.size > MAX_RAW_FILE_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);
  const dataUrl = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
    ? await renderPaperPdf(file)
    : await readFileAsDataUrl(file);
  if (dataUrl.length > MAX_DATA_URL_CHARS) throw new Error(FILE_TOO_LARGE_MESSAGE);
  return dataUrl;
}

/** Turns any auto-read failure into a short, honest message for the biller. */
export function ocrErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (!raw) return "Couldn't read this file â€” try again.";
  if (raw.includes("too large") || raw.includes("Too large")) return FILE_TOO_LARGE_MESSAGE;
  if (/429|rate limit|busy/i.test(raw))
    return "Auto-read is busy right now â€” try again in a moment.";
  if (/402|credit/i.test(raw)) return "Auto-read credits are exhausted â€” enter details manually.";
  return `Couldn't read this file â€” ${raw}`;
}

/** OCR receives the visible scan, never a PDF's potentially stale hidden text layer. */
async function renderPaperPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    const { default: Worker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline");
    pdfjs.GlobalWorkerOptions.workerPort = new Worker();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 4) throw new Error("Upload up to 4 pages per paper report so every page can be read clearly.");
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
    const views = pages.map(p => p.getViewport({ scale: 1800 / p.getViewport({ scale: 1 }).width }));
    const totalHeight = views.reduce((sum, v) => sum + Math.ceil(v.height) + 24, 0);
    if (totalHeight > 12000) throw new Error("These pages are too tall to read clearly together. Upload fewer pages per report.");
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = totalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the visible PDF pages for reading.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    let top = 0;
    for (let i = 0; i < pages.length; i++) {
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = 1800;
      pageCanvas.height = Math.ceil(views[i].height);
      const pageContext = pageCanvas.getContext("2d");
      if (!pageContext) throw new Error("Could not render a PDF page.");
      await pages[i].render({ canvasContext: pageContext, viewport: views[i] }).promise;
      context.drawImage(pageCanvas, 0, top);
      pageCanvas.width = pageCanvas.height = 0;
      top += Math.ceil(views[i].height) + 24;
    }
    const image = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 0;
    return image;
  } finally { await task.destroy(); }
}
