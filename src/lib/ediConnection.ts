/**
 * How the app describes its link to the EDI backend — pure, testable.
 *
 * Two very different failures must never look the same to a biller:
 *   • "nothing is connected yet"  → an onboarding task with exact next steps
 *   • "the backend answered, and said no" → the backend's own message
 *
 * Nothing here touches a credential: the probe result arrives from the server
 * already stripped of secrets, and this module only turns it into copy.
 */
import { isEdiConnectionError } from "@/lib/ediTransport";

export type EdiConnectionProbe = {
  ok: boolean;
  error?: string | null;
  status?: number | null;
  /** Which transport the server actually used / could use. */
  transport?: "bridge" | "direct" | "none" | null;
  /** True when server-only `EDI_API_BASE_URL` is present in this deployment. */
  direct_configured?: boolean;
  /** Backend-reported health payload, when it answered. */
  status_text?: string | null;
  version?: string | null;
};

export type EdiConnectionState = "checking" | "online" | "not_connected" | "error";

export type EdiConnectionView = {
  state: EdiConnectionState;
  tone: "info" | "ready" | "warn" | "error";
  /** Short label for the header pill — never a raw stack or long body. */
  pill: string;
  /** Banner headline, or null when there is nothing to show. */
  title: string | null;
  /** One-line explanation under the headline. */
  detail: string | null;
  /** Ordered, concrete things a human can do. Empty when online. */
  steps: string[];
};

const CONNECT_STEPS = [
  "Deploy the secure `redart-edi-bridge` backend function to this project — it holds the EDI credentials server-side.",
  "Or add the server-only secrets EDI_API_BASE_URL and EDI_API_TOKEN in Project Settings → Secrets.",
  "Then press Test connection. Nothing is filed with a payer until setup is complete and you explicitly submit.",
];

const ERROR_STEPS = [
  "Confirm the EDI credentials stored server-side are still valid for this environment.",
  "Check the EDI backend is up, then press Test connection.",
];

function trim(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Turns a health probe into everything the UI renders. Deliberately total:
 * every input shape maps to exactly one state.
 */
export function describeEdiConnection(
  probe: EdiConnectionProbe | null | undefined,
  loading = false,
): EdiConnectionView {
  if (loading || !probe) {
    return {
      state: "checking",
      tone: "info",
      pill: "Checking backend…",
      title: null,
      detail: null,
      steps: [],
    };
  }

  if (probe.ok) {
    const status = (probe.status_text ?? "").trim();
    const version = (probe.version ?? "").trim();
    const suffix = status && status.toLowerCase() !== "ok" ? ` ${status}` : " online";
    return {
      state: "online",
      tone: "ready",
      pill: `EDI backend${suffix}${version ? ` · v${version}` : ""}`,
      title: null,
      detail: null,
      steps: [],
    };
  }

  const error = (probe.error ?? "").trim();
  const notConnected =
    probe.transport === "none" ||
    probe.status === 404 ||
    (!probe.direct_configured && isEdiConnectionError(error)) ||
    error === "";

  if (notConnected) {
    return {
      state: "not_connected",
      tone: "error",
      pill: "Backend not connected",
      title: "Connect the EDI backend to start filing 837P claims",
      detail:
        "Import, review and provider setup all work now — validation, batching and submission need the backend link.",
      steps: CONNECT_STEPS,
    };
  }

  return {
    state: "error",
    tone: "error",
    pill: "Backend error",
    title: "The EDI backend refused the health check",
    detail: trim(error || "The backend did not explain the failure."),
    steps: ERROR_STEPS,
  };
}

/** True when validate / batch / submit actions cannot possibly succeed. */
export function ediActionsBlocked(view: EdiConnectionView): boolean {
  return view.state === "not_connected" || view.state === "error";
}
