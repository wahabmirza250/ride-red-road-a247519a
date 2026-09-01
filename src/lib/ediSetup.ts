/**
 * Company-scoped EDI provider / trading-partner setup (pure helpers).
 *
 * This is TENANT configuration, not developer config: every transportation
 * company that onboards gets its own provider billing profile and trading
 * partner identifiers, editable from the app — routine onboarding must never
 * require a backend deploy.
 *
 * Secrets (SFTP password / private key) are NEVER part of this shape: the UI
 * only ever renders a masked "configured / not configured" status, and only a
 * secure server-side path may write them.
 */

export type EdiEnvironment = "test" | "production";

/**
 * `shared`  — the company files through RedArt's own trading-partner
 *             connection. No per-company SFTP credentials exist or are needed.
 * `company` — the company has its own connection (host/user/dirs are ordinary
 *             configuration; the secret itself lives server-side only).
 */
export type EdiTransportMode = "shared" | "company";

export type EdiCompanySettings = {
  company_id: string;
  billing_name: string | null;
  npi: string | null;
  taxonomy_code: string | null;
  tax_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  environment: EdiEnvironment;
  transport_mode: EdiTransportMode;
  production_enabled: boolean;
  sftp_host: string | null;
  sftp_port: number | null;
  sftp_username: string | null;
  sftp_directory: string | null;
  /** Read-only flag: whether a secret was installed through a secure path. */
  sftp_secret_configured: boolean;
  notes: string | null;
  updated_at?: string | null;
};

export const EMPTY_EDI_SETTINGS: Omit<EdiCompanySettings, "company_id"> = {
  billing_name: null,
  npi: null,
  taxonomy_code: null,
  tax_id: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  phone: null,
  contact_name: null,
  contact_email: null,
  sender_id: null,
  receiver_id: null,
  environment: "test",
  transport_mode: "shared",
  production_enabled: false,
  sftp_host: null,
  sftp_port: null,
  sftp_username: null,
  sftp_directory: null,
  sftp_secret_configured: false,
  notes: null,
};

/** NPI must be exactly 10 digits (backend still owns the authoritative check). */
export function isValidNpi(npi: string | null | undefined): boolean {
  return /^\d{10}$/.test((npi ?? "").trim());
}

export type EdiSetupIssue = { field: string; message: string };

/** Fields the 837P provider loop cannot be built without. */
export function ediProviderIssues(s: Partial<EdiCompanySettings>): EdiSetupIssue[] {
  const out: EdiSetupIssue[] = [];
  const req = (field: keyof EdiCompanySettings, label: string) => {
    const v = s[field];
    if (v === null || v === undefined || String(v).trim() === "")
      out.push({ field: String(field), message: `${label} is required` });
  };
  req("billing_name", "Billing / legal name");
  req("npi", "Billing NPI");
  req("address_line1", "Billing address");
  req("city", "City");
  req("state", "State");
  req("postal_code", "ZIP code");
  if (s.npi && !isValidNpi(s.npi))
    out.push({ field: "npi", message: "NPI must be exactly 10 digits" });
  if (s.postal_code && !/^\d{5}(-?\d{4})?$/.test(String(s.postal_code).trim()))
    out.push({ field: "postal_code", message: "ZIP must be 5 or 9 digits" });
  return out;
}

/** Trading-partner identifiers needed before a file can be exchanged. */
export function ediTradingPartnerIssues(s: Partial<EdiCompanySettings>): EdiSetupIssue[] {
  const out: EdiSetupIssue[] = [];
  if (!s.sender_id?.trim()) out.push({ field: "sender_id", message: "Sender ID is required" });
  if (!s.receiver_id?.trim())
    out.push({ field: "receiver_id", message: "Receiver ID is required" });
  return out;
}

/**
 * Transport readiness. Shared mode is managed centrally by RedArt, so it is
 * ready as soon as it is selected — no per-company SFTP fields are demanded.
 */
export function ediTransportIssues(s: Partial<EdiCompanySettings>): EdiSetupIssue[] {
  if ((s.transport_mode ?? "shared") === "shared") return [];
  const out: EdiSetupIssue[] = [];
  if (!s.sftp_host?.trim()) out.push({ field: "sftp_host", message: "Connection host is required" });
  if (!s.sftp_username?.trim())
    out.push({ field: "sftp_username", message: "Connection user is required" });
  if (!s.sftp_secret_configured)
    out.push({ field: "sftp_secret", message: "Secure credential setup required" });
  return out;
}

export const SHARED_TRANSPORT_LABEL = "Managed by RedArt";
export const SECRET_SETUP_REQUIRED = "Secure credential setup required";

export type EdiSetupStatus = {
  providerReady: boolean;
  tradingPartnerReady: boolean;
  transportReady: boolean;
  /** True when a claim can be built AND a file can actually be exchanged. */
  ready: boolean;
  /** True when claims may be created/validated (transport not yet needed). */
  claimReady: boolean;
  issues: EdiSetupIssue[];
};

export function evaluateEdiSetup(s: Partial<EdiCompanySettings> | null): EdiSetupStatus {
  const provider = ediProviderIssues(s ?? {});
  const partner = ediTradingPartnerIssues(s ?? {});
  const transport = ediTransportIssues(s ?? {});
  const claimReady = provider.length === 0;
  return {
    providerReady: provider.length === 0,
    tradingPartnerReady: partner.length === 0,
    transportReady: transport.length === 0,
    claimReady,
    ready: claimReady && partner.length === 0 && transport.length === 0,
    issues: [...provider, ...partner, ...transport],
  };
}

export function environmentLabel(env: EdiEnvironment | null | undefined): string {
  return env === "production" ? "PRODUCTION" : "TEST";
}

/** Can this company legally be pointed at live submission right now? */
export function canSubmitProduction(s: Partial<EdiCompanySettings> | null): boolean {
  if (!s) return false;
  return s.production_enabled === true && s.environment === "production" && evaluateEdiSetup(s).ready;
}

/**
 * A live submission is never one click away: the biller must type this exact
 * phrase. Defined here (pure) so the UI and the server function agree.
 */
export const PRODUCTION_CONFIRM_PHRASE = "SUBMIT PRODUCTION";

export function isProductionConfirmed(typed: string | null | undefined): boolean {
  return (typed ?? "").trim().toUpperCase() === PRODUCTION_CONFIRM_PHRASE;
}
