/**
 * Company-scoped EDI provider / trading-partner setup (pure helpers).
 *
 * This is TENANT configuration, not developer config: every transportation
 * company that onboards gets its own provider billing profile and trading
 * partner identifiers. Secrets (SFTP password / private key) are NEVER part
 * of this shape — the UI masks them and only a secure backend endpoint may
 * ever write them.
 */

export type EdiEnvironment = "test" | "production";

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
  contact_email: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  environment: EdiEnvironment;
  sftp_host: string | null;
  sftp_port: number | null;
  sftp_username: string | null;
  sftp_directory: string | null;
  /** Read-only flag: whether a secret was installed through a secure path. */
  sftp_secret_configured: boolean;
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
  contact_email: null,
  sender_id: null,
  receiver_id: null,
  environment: "test",
  sftp_host: null,
  sftp_port: null,
  sftp_username: null,
  sftp_directory: null,
  sftp_secret_configured: false,
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

export type EdiSetupStatus = {
  providerReady: boolean;
  tradingPartnerReady: boolean;
  transportReady: boolean;
  ready: boolean;
  issues: EdiSetupIssue[];
};

export function evaluateEdiSetup(s: Partial<EdiCompanySettings> | null): EdiSetupStatus {
  const provider = ediProviderIssues(s ?? {});
  const partner = ediTradingPartnerIssues(s ?? {});
  const transportReady = Boolean(s?.sftp_host?.trim()) && Boolean(s?.sftp_secret_configured);
  return {
    providerReady: provider.length === 0,
    tradingPartnerReady: partner.length === 0,
    transportReady,
    ready: provider.length === 0 && partner.length === 0,
    issues: [...provider, ...partner],
  };
}

export function environmentLabel(env: EdiEnvironment | null | undefined): string {
  return env === "production" ? "PRODUCTION" : "TEST";
}

/** Production actions always require an explicit, typed confirmation. */
export const PRODUCTION_CONFIRM_PHRASE = "SUBMIT PRODUCTION";

export function isProductionConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === PRODUCTION_CONFIRM_PHRASE;
}
