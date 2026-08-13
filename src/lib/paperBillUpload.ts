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
  "File too large — use a smaller photo or a lower-resolution PDF (about 8 MB max).";

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
  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length > MAX_DATA_URL_CHARS) throw new Error(FILE_TOO_LARGE_MESSAGE);
  return dataUrl;
}

/** Turns any auto-read failure into a short, honest message for the biller. */
export function ocrErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (!raw) return "Couldn't read this file — try again.";
  if (raw.includes("too large") || raw.includes("Too large")) return FILE_TOO_LARGE_MESSAGE;
  if (/429|rate limit|busy/i.test(raw))
    return "Auto-read is busy right now — try again in a moment.";
  if (/402|credit/i.test(raw)) return "Auto-read credits are exhausted — enter details manually.";
  return `Couldn't read this file — ${raw}`;
}
