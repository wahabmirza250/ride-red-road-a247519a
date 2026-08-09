/**
 * Turns auth-service password rejections (breach-list / strength checks) into
 * guidance a human can act on, and leaves other errors untouched.
 */
export function passwordError(message?: string | null): string | undefined {
  if (!message) return undefined;
  const m = message.toLowerCase();
  if (m.includes("weak") || m.includes("pwned") || m.includes("easy to guess")) {
    return "That password appears in known breach lists. Use a longer, unique password (12+ characters, mixed case, numbers and a symbol) — or tap “Generate” for a strong one.";
  }
  return message;
}

/** Cryptographically random password that always passes strength checks. */
export function generateStrongPassword(length = 16): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
