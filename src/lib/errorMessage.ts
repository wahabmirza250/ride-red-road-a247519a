/**
 * Turns any thrown value into a short, human-safe message.
 *
 * Server-function calls that fail at the edge (500 / HTML error shell) reject with
 * the raw HTML document as the message. Rendering that in a toast dumps the whole
 * "This page didn't load" page on screen, so we detect and replace it.
 */
export function friendlyErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const message = raw.trim();
  if (!message) return fallback;
  if (looksLikeHtml(message)) return fallback;
  if (message.length > 300) return fallback;
  return message;
}

function looksLikeHtml(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.startsWith("<!doctype") ||
    lower.startsWith("<html") ||
    (lower.includes("<html") && lower.includes("</html>")) ||
    lower.includes("<script") ||
    lower.includes("this page didn't load")
  );
}
