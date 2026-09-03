/**
 * Pure payload builders for syncing RedArt company/member/trip data into the
 * EDI backend's own entities.
 *
 * The EDI backend is the source of truth: RedArt creates a provider profile, a
 * trading partner, a patient and an NEMT trip THERE, remembers the returned
 * ids, and only then creates a claim from that trip. Re-running a sync must
 * never create a second copy — that is what the fingerprints below are for:
 * an unchanged fingerprint means "nothing to send".
 *
 * Nothing here performs I/O, so every mapping decision is unit-testable.
 */
import { portalMoneyString } from "@/lib/portalCurrency";
import type { EdiCompanySettings, EdiEnvironment } from "@/lib/ediSetup";
import type { EdiTripDetail } from "@/lib/ediTypes";

/* ------------------------------------------------------------------ */
/* Fingerprints                                                        */
/* ------------------------------------------------------------------ */

/** Deterministic JSON: object keys sorted, so key order never changes a hash. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** FNV-1a — short, stable, non-cryptographic. Used only to detect changes. */
export function fingerprint(value: unknown): string {
  const text = stableJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

export function splitName(full: string | null | undefined): {
  first_name: string;
  last_name: string;
} {
  const clean = String(full ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return { first_name: "", last_name: "" };
  if (clean.includes(",")) {
    const [last = "", rest = ""] = clean.split(",", 2);
    return { first_name: rest.trim(), last_name: last.trim() };
  }
  const parts = clean.split(" ");
  if (parts.length === 1) return { first_name: "", last_name: parts[0]! };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1]! };
}

/* ------------------------------------------------------------------ */
/* Provider profile / trading partner                                  */
/* ------------------------------------------------------------------ */

const trimmed = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export type EdiProviderPayload = Record<string, unknown>;

export function buildProviderProfilePayload(s: Partial<EdiCompanySettings>): EdiProviderPayload {
  return {
    legal_name: trimmed(s.billing_name),
    billing_name: trimmed(s.billing_name),
    npi: trimmed(s.npi),
    taxonomy_code: trimmed(s.taxonomy_code),
    location_id: trimmed(s.medicaid_provider_id),
    medicaid_provider_id: trimmed(s.medicaid_provider_id),
    address_line_1: trimmed(s.address_line1),
    address_line_2: trimmed(s.address_line2),
    city: trimmed(s.city),
    state: trimmed(s.state),
    zip: trimmed(s.postal_code),
    country: "US",
    phone: trimmed(s.phone),
    email: trimmed(s.contact_email),
    is_active: true,
  };
}

export function buildTradingPartnerPayload(
  s: Partial<EdiCompanySettings>,
  environment: EdiEnvironment,
): Record<string, unknown> {
  return {
    name: trimmed(s.billing_name) ?? trimmed(s.sender_id) ?? "RedArt trading partner",
    sender_id: trimmed(s.sender_id),
    receiver_id: trimmed(s.receiver_id),
    contact_name: trimmed(s.contact_name),
    contact_phone: trimmed(s.phone),
    environment: environment.toUpperCase(),
    is_active: true,
  };
}

/** Blockers that make a company sync pointless — reported, never sent. */
export function companySyncBlockers(s: Partial<EdiCompanySettings> | null): string[] {
  const out: string[] = [];
  if (!s) return ["EDI setup has not been saved for this company yet"];
  if (!trimmed(s.billing_name)) out.push("Billing / legal name is required");
  if ((s.provider_identifier_type ?? "npi") === "health_first_colorado_id") {
    if (!trimmed(s.medicaid_provider_id)) out.push("Health First Colorado Provider ID is required");
  } else if (!trimmed(s.npi)) out.push("Billing NPI is required");
  if (!trimmed(s.address_line1) || !trimmed(s.city) || !trimmed(s.state) || !trimmed(s.postal_code))
    out.push("Complete billing address is required");
  if (!trimmed(s.sender_id) || !trimmed(s.receiver_id))
    out.push("Sender ID and Receiver ID are required");
  return out;
}

/* ------------------------------------------------------------------ */
/* Patient / trip                                                      */
/* ------------------------------------------------------------------ */

/** YYYY-MM-DD, which is what the EDI backend expects for dates. */
export function ediDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const d = new Date(direct);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function buildPatientPayload(
  member: EdiTripDetail["member"],
  _providerId: number | string | null,
): Record<string, unknown> {
  const { first_name, last_name } = splitName(member.name);
  return {
    first_name,
    last_name,
    medicaid_member_id: trimmed(member.medicaid_id),
    ...(ediDate(member.dob) ? { date_of_birth: ediDate(member.dob) } : {}),
    ...(trimmed(member.address) ? { address_line_1: trimmed(member.address) } : {}),
    phone: trimmed(member.phone),
    is_active: true,
  };
}

export function patientFingerprint(member: EdiTripDetail["member"]): string {
  return fingerprint(buildPatientPayload(member, null));
}

const money = (v: number): string => portalMoneyString(v) ?? "0.00";

export function buildNemtTripPayload(
  detail: EdiTripDetail,
  ids: { patientId: number | string; providerId: number | string | null },
): Record<string, unknown> {
  return {
    patient: ids.patientId,
    ...(ids.providerId === null || ids.providerId === undefined ? {} : { provider: ids.providerId }),
    service_date: ediDate(detail.trip.service_date),
    pickup: trimmed(detail.trip.pickup_address),
    dropoff: trimmed(detail.trip.dropoff_address),
    one_way_miles: detail.trip.miles,
    mileage_units: detail.trip.miles,
    charge: money(detail.total_charge),
    is_active: true,
  };
}

export function tripFingerprint(detail: EdiTripDetail): string {
  return fingerprint(
    buildNemtTripPayload(detail, { patientId: 0, providerId: null }),
  );
}

/** Body of POST /api/v1/claims/from-trip/ — the documented linkage. */
export function buildClaimFromTripPayload(
  tripId: number | string,
  recordId: string,
  _environment: EdiEnvironment,
  detail?: EdiTripDetail,
): Record<string, unknown> {
  return {
    trip_id: tripId,
    external_id: recordId,
    ...(detail ? {
      diagnosis_code: trimmed(detail.diagnosis_code),
      place_of_service: "41",
      service_lines: detail.lines.map((line) => ({
        procedure_code: line.procedure_code,
        modifiers: line.modifiers,
        units: line.units,
        mileage: line.procedure_code === "S0215" ? detail.trip.miles : null,
        charge: money(line.amount),
      })),
    } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Sync reporting                                                      */
/* ------------------------------------------------------------------ */

export type EdiSyncEntityResult = {
  kind: "provider" | "trading_partner";
  action: "created" | "updated" | "unchanged" | "skipped" | "failed";
  id: string | null;
  message: string | null;
};

export type EdiCompanySyncReport = {
  ok: boolean;
  environment: EdiEnvironment;
  entities: EdiSyncEntityResult[];
  provider_id: string | null;
  trading_partner_id: string | null;
  blockers: string[];
  last_synced_at: string | null;
  message: string;
};

export function summarizeCompanySync(
  entities: EdiSyncEntityResult[],
  blockers: string[],
): string {
  if (blockers.length) return blockers[0]!;
  const failed = entities.filter((e) => e.action === "failed");
  if (failed.length) return failed[0]!.message ?? "Sync failed";
  const created = entities.filter((e) => e.action === "created").length;
  const updated = entities.filter((e) => e.action === "updated").length;
  if (!created && !updated) return "Already in sync — nothing needed to change.";
  const bits: string[] = [];
  if (created) bits.push(`${created} created`);
  if (updated) bits.push(`${updated} updated`);
  return `EDI backend updated: ${bits.join(", ")}.`;
}

