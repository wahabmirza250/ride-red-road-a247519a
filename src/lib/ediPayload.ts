/**
 * Builds the claim payload handed to the EDI backend.
 *
 * The EDI backend is the source of truth for X12/837P rules — this only maps
 * RedArt's trip/member/provider data into its request shape. Pure function so
 * it is unit-testable and safe on both client and server.
 */
import type { EdiTripDetail } from "@/lib/ediBilling.functions";
import { portalMoneyString } from "@/lib/portalCurrency";

/** Exact two-decimal money string; never a float artefact like 54.800000000001. */
const money = (v: number): string => portalMoneyString(v) ?? "0.00";

export type EdiClaimPayload = {
  external_id: string;
  environment: "test" | "production";
  member: {
    name: string | null;
    medicaid_id: string | null;
    dob: string | null;
    address: string | null;
    phone: string | null;
  };
  provider: { billing_name: string | null; npi: string | null; taxonomy_code: string | null };
  service_date: string | null;
  diagnosis_code: string | null;
  total_charge: string;
  miles: number;
  long_distance: boolean;
  service_lines: {
    procedure_code: string | null;
    modifiers: string[];
    units: number;
    charge_amount: string;
    unit_rate: string;
  }[];
};

/** Service date as YYYY-MM-DD, which is what the EDI backend expects. */
export function ediServiceDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function buildEdiClaimPayload(
  detail: EdiTripDetail,
  environment: "test" | "production",
): EdiClaimPayload {
  return {
    external_id: detail.record_id,
    environment,
    member: detail.member,
    provider: {
      billing_name: detail.provider.billing_name,
      npi: detail.provider.npi,
      taxonomy_code: detail.provider.taxonomy_code,
    },
    service_date: ediServiceDate(detail.trip.service_date),
    diagnosis_code: detail.diagnosis_code,
    total_charge: money(detail.total_charge),
    miles: detail.trip.miles,
    long_distance: detail.trip.long_distance,
    service_lines: detail.lines.map((l) => ({
      procedure_code: l.procedure_code,
      modifiers: l.modifiers,
      units: l.units,
      charge_amount: money(l.amount),
      unit_rate: money(l.rate),
    })),
  };
}

/** Local blockers that make a backend round-trip pointless. */
export function localClaimBlockers(detail: EdiTripDetail): string[] {
  const out: string[] = [];
  if (!detail.member.medicaid_id) out.push("Member Medicaid ID is missing");
  if (!detail.trip.service_date) out.push("Service date is missing");
  if (!detail.provider.configured) out.push("Provider billing profile is incomplete");
  if (detail.missing_rates.length)
    out.push(`No billing rate configured for: ${detail.missing_rates.join(", ")}`);
  if (detail.total_charge <= 0) out.push("Total charge is zero");
  return out;
}
