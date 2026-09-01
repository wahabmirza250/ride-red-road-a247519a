/**
 * Shared Super EDI shapes (pure — safe on client and server).
 */
import type { EdiLongDistance } from "@/lib/ediLongDistance";

export type EdiCandidate = {
  id: string;
  trip_id: string;
  status: string;
  service_date: string | null;
  member_name: string | null;
  medicaid_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  edi_claim_id: number | null;
  edi_status: string | null;
};

export type EdiServiceLine = {
  label: string;
  procedure_code: string | null;
  modifiers: string[];
  units: number;
  unit_word: string;
  rate: number;
  amount: number;
};

export type EdiProviderProfile = {
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
  sender_id: string | null;
  receiver_id: string | null;
  configured: boolean;
};

export type EdiClaimState = {
  edi_claim_id: number | null;
  edi_batch_id: number | null;
  edi_file_id: number | null;
  edi_status: string | null;
  /** Raw backend validation payload, JSON-encoded for safe RPC transport. */
  edi_validation_json: string | null;
  /** Raw payload of GET /claims/{id}/status/ (999 / 277 / 835), JSON-encoded. */
  edi_status_detail_json: string | null;
  edi_environment: string | null;
  edi_last_sync_at: string | null;
  edi_last_error: string | null;
};

export type EdiTripDetail = {
  record_id: string;
  trip_id: string;
  company_id: string;
  status: string;
  member: {
    name: string | null;
    medicaid_id: string | null;
    dob: string | null;
    address: string | null;
    phone: string | null;
  };
  trip: {
    service_date: string | null;
    trip_kind: string | null;
    vehicle_type: string | null;
    pickup_address: string | null;
    dropoff_address: string | null;
    miles: number;
    leg_count: number;
    has_signed_form: boolean;
  };
  lines: EdiServiceLine[];
  total_charge: number;
  diagnosis_code: string | null;
  missing_rates: string[];
  provider: EdiProviderProfile;
  edi: EdiClaimState;
};

/** One row of the bulk Batch Review table. */
export type EdiWorkRow = {
  record_id: string;
  trip_id: string;
  status: string;
  member_name: string | null;
  medicaid_id: string | null;
  service_date: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  miles: number;
  units: number;
  procedure_codes: string[];
  modifiers: string[];
  diagnosis_code: string | null;
  total_charge: number;
  provider_name: string | null;
  edi_claim_id: number | null;
  edi_batch_id: number | null;
  edi_file_id: number | null;
  edi_status: string | null;
  edi_ready: boolean | null;
  edi_issues: string[];
  edi_last_error: string | null;
  edi_last_sync_at: string | null;
  edi_environment: string | null;
  /** Backend claim status string from GET /claims/{id}/status/, when fetched. */
  backend_status: string | null;
  /** Raw status payload (999 / 277 / 835), JSON-encoded. */
  status_detail_json: string | null;
  local_blockers: string[];
  long_distance: EdiLongDistance;
};
