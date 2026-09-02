/**
 * Offline TEST-environment smoke test of the whole Super EDI pipeline.
 *
 * The real EDI backend is not reachable from this project (no bridge URL, no
 * API token), so the transport is replaced by a fake backend that answers the
 * documented endpoints. Everything else is the real code path:
 *
 *   catalog -> provider profile -> trading partner
 *           -> patient -> NEMT trip -> /claims/from-trip/
 *           -> validate -> submission batch -> add-claim -> generate 837P
 *
 * Two hard rules are asserted:
 *   1. The run STOPS before `/edi-files/{id}/upload/` — nothing is ever sent to
 *      a payer by a smoke test.
 *   2. Re-running is idempotent: unchanged entities cause no second POST.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  let nextId = 100;

  /** What the backend advertises in /api/v1/integration/lovable/. */
  const CATALOG = {
    endpoints: {
      health: "/api/health/",
      provider_profiles: "/api/v1/provider-profiles/",
      trading_partners: "/api/v1/trading-partners/",
      patients: "/api/v1/patients/",
      nemt_trips: "/api/v1/nemt-trips/",
      claims: "/api/v1/claims/",
      claim_from_trip: "/api/v1/claims/from-trip/",
      submission_batches: "/api/v1/submission-batches/",
      edi_files: "/api/v1/edi-files/",
      generate_837p: "/api/v1/edi-files/generate-837p/",
    },
  };

  async function ediFetch(_sb: unknown, req: { path: string; method?: string; body?: unknown }) {
    const method = (req.method ?? "GET").toUpperCase();
    const path = req.path;
    calls.push({ path, method, body: req.body ?? null });

    if (path === "/api/health/") return { ok: true as const, data: { status: "ok" } };
    if (path === "/api/v1/integration/lovable/") return { ok: true as const, data: CATALOG };

    // A smoke test must never reach the payer.
    if (path.endsWith("/upload/"))
      return { ok: false as const, error: "upload must not be called", status: 500 };

    if (path === "/api/v1/edi-files/generate-837p/")
      return { ok: true as const, data: { id: 555, file_name: "RA-TEST.837" } };
    if (path.endsWith("/add-claim/")) return { ok: true as const, data: { detail: "claim added" } };
    if (path.endsWith("/validate/"))
      return { ok: true as const, data: { ready: true, errors: [], warnings: [] } };
    if (path === "/api/v1/claims/from-trip/") return { ok: true as const, data: { id: 900 } };
    if (method === "PATCH")
      return { ok: true as const, data: { id: Number(/\/(\d+)\/$/.exec(path)?.[1] ?? 0) } };
    if (method === "POST") return { ok: true as const, data: { id: (nextId += 1) } };
    return { ok: true as const, data: { id: 1 } };
  }

  return {
    calls,
    ediFetch,
    reset() {
      calls.length = 0;
      nextId = 100;
    },
    posts: (match: RegExp) => calls.filter((c) => c.method === "POST" && match.test(c.path)),
  };
});

vi.mock("@/lib/ediBridge.server", () => ({
  ediFetch: H.ediFetch,
  isAllowedEdiPath: () => true,
}));

import { buildBatchCreateBody, generateBatchNumber } from "@/lib/ediGuard";
import { EdiAccessError } from "@/lib/ediOwnership.server";
import type { EdiCompanySettings } from "@/lib/ediSetup";
import type { EdiTripDetail } from "@/lib/ediTypes";

const OURS = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const THEIRS = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/* ------------------------------------------------------------------ */
/* In-memory PostgREST                                                 */
/* ------------------------------------------------------------------ */

function makeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let seq = 0;

  return {
    tables,
    from(table: string) {
      tables[table] ??= [];
      const rows = tables[table]!;
      const filters: ((r: any) => boolean)[] = [];
      let mode: "select" | "insert" | "upsert" | "update" = "select";
      let payload: any = null;
      let conflict: string[] = [];

      const matched = () => rows.filter((r) => filters.every((f) => f(r)));

      const run = (): { data: any; error: null } => {
        if (mode === "select") return { data: matched(), error: null };
        if (mode === "update") {
          const hits = matched();
          for (const hit of hits) Object.assign(hit, payload);
          return { data: hits, error: null };
        }
        const list = Array.isArray(payload) ? payload : [payload];
        const out: any[] = [];
        for (const value of list) {
          const existing =
            mode === "upsert" && conflict.length
              ? rows.find((r) => conflict.every((c) => (r as any)[c] === value[c]))
              : undefined;
          if (existing) {
            Object.assign(existing, value);
            out.push(existing);
          } else {
            const row = { id: value.id ?? `row-${(seq += 1)}`, ...value };
            rows.push(row);
            out.push(row);
          }
        }
        return { data: out, error: null };
      };

      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return q;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (r[col] ?? null) === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        order: () => q,
        insert: (v: unknown) => {
          mode = "insert";
          payload = v;
          return q;
        },
        upsert: (v: unknown, opts?: { onConflict?: string }) => {
          mode = "upsert";
          payload = v;
          conflict = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          return q;
        },
        update: (v: unknown) => {
          mode = "update";
          payload = v;
          return q;
        },
        limit: (n: number) => Promise.resolve({ data: run().data.slice(0, n), error: null }),
        maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Synthetic company + trip (TEST data only)                           */
/* ------------------------------------------------------------------ */

const settings: EdiCompanySettings = {
  company_id: OURS,
  billing_name: "Smoke Test Transport LLC",
  provider_identifier_type: "npi",
  medicaid_provider_id: null,
  npi: "1234567893",
  taxonomy_code: "343900000X",
  tax_id: "84-7654321",
  address_line1: "1 Test Way",
  address_line2: null,
  city: "Lamar",
  state: "CO",
  postal_code: "81052",
  phone: "7195550000",
  contact_name: "Test Biller",
  contact_email: "test@example.com",
  sender_id: "TESTSENDER",
  receiver_id: "TESTRECV",
  environment: "test",
  transport_mode: "company",
  production_enabled: false,
  sftp_host: "sftp.test.example",
  sftp_port: 22,
  sftp_username: "tester",
  sftp_directory: "/in",
  sftp_secret_configured: false,
  notes: null,
} as EdiCompanySettings;

const detail: EdiTripDetail = {
  record_id: "rec-smoke-1",
  trip_id: "trip-smoke-1",
  rider_id: "rider-smoke-1",
  company_id: OURS,
  status: "approved",
  member: {
    name: "Test, Patient",
    medicaid_id: "T000000001",
    dob: "1975-01-02",
    address: "1 Test Way",
    phone: "7195550001",
  },
  trip: {
    service_date: "2026-02-10",
    trip_kind: "round_trip",
    vehicle_type: "ambulatory",
    pickup_address: "1 Test Way",
    dropoff_address: "Test Clinic",
    miles: 8,
    leg_count: 2,
    has_signed_form: true,
  },
  lines: [
    {
      label: "Base",
      procedure_code: "A0120",
      modifiers: ["U1"],
      units: 2,
      unit_word: "legs",
      rate: 15.5,
      amount: 31,
    },
    {
      label: "Mileage",
      procedure_code: "S0215",
      modifiers: [],
      units: 8,
      unit_word: "miles",
      rate: 1.25,
      amount: 10,
    },
  ],
  total_charge: 41,
  diagnosis_code: "Z0000",
  missing_rates: [],
  provider: {
    billing_name: settings.billing_name,
    npi: settings.npi,
    taxonomy_code: settings.taxonomy_code,
    tax_id: settings.tax_id,
    address_line1: settings.address_line1,
    address_line2: null,
    city: settings.city,
    state: settings.state,
    postal_code: settings.postal_code,
    phone: settings.phone,
    sender_id: settings.sender_id,
    receiver_id: settings.receiver_id,
    configured: true,
  },
  edi: {
    edi_claim_id: null,
    edi_batch_id: null,
    edi_file_id: null,
    edi_status: null,
    edi_validation_json: null,
    edi_status_detail_json: null,
    edi_environment: null,
    edi_last_sync_at: null,
    edi_last_error: null,
  },
};

function seedDb() {
  return makeSupabase({
    billing_records: [
      {
        id: "rec-smoke-1",
        company_id: OURS,
        resubmission_id: null,
        edi_claim_id: null,
        edi_batch_id: null,
        edi_file_id: null,
      },
    ],
    edi_company_mapping: [],
    edi_entity_links: [],
    edi_batches: [],
  });
}

beforeEach(() => {
  H.reset();
  delete process.env["EDI_SHARED_TRADING_PARTNER_ID"];
});

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

describe("TEST-environment smoke run (fake backend, synthetic data)", () => {
  it("creates provider + trading partner once, then is a no-op", async () => {
    const db = seedDb();
    const { syncCompanyEntities } = await import("@/lib/ediSync.server");

    const first = await syncCompanyEntities(db, OURS, settings);
    expect(first.ok).toBe(true);
    expect(first.provider_id).toBeTruthy();
    expect(first.trading_partner_id).toBeTruthy();
    expect(H.posts(/\/provider-profiles\/$/)).toHaveLength(1);
    expect(H.posts(/\/trading-partners\/$/)).toHaveLength(1);
    // Non-secret setup only.
    const body = JSON.stringify(H.posts(/\/provider-profiles\/$/)[0]!.body);
    expect(body).toContain("1234567893");
    expect(body.toLowerCase()).not.toContain("sftp");

    H.reset();
    const second = await syncCompanyEntities(db, OURS, settings);
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/Already in sync/);
    // Only the catalog read — no entity was touched again.
    expect(H.posts(/provider-profiles|trading-partners/)).toHaveLength(0);
  });

  it("links patient -> NEMT trip -> claim through the documented from-trip route", async () => {
    const db = seedDb();
    const { loadCatalogState, ensureClaimForRecord } = await import("@/lib/ediSync.server");
    const catalog = await loadCatalogState(db);
    expect(catalog.error).toBeNull();
    expect(catalog.paths.patient).toBe("/api/v1/patients/");
    expect(catalog.paths.trip).toBe("/api/v1/nemt-trips/");

    const link = await ensureClaimForRecord(db, OURS, detail, {
      environment: "test",
      providerId: "101",
      paths: catalog.paths,
    });
    expect(link.error).toBeNull();
    expect(link.via).toBe("from_trip");
    expect(link.claim_id).toBe(900);

    const fromTrip = H.posts(/\/claims\/from-trip\/$/);
    expect(fromTrip).toHaveLength(1);
    expect(fromTrip[0]!.body).toMatchObject({ external_id: "rec-smoke-1", environment: "test" });
    expect(H.posts(/\/patients\/$/)).toHaveLength(1);
    expect(H.posts(/\/nemt-trips\/$/)).toHaveLength(1);

    // Same member and trip again: the stored links are reused, nothing re-created.
    H.reset();
    const again = await ensureClaimForRecord(
      db,
      OURS,
      { ...detail, record_id: "rec-smoke-1" },
      { environment: "test", providerId: "101", paths: catalog.paths },
    );
    expect(again.claim_id).toBe(900);
    expect(H.posts(/\/patients\/$/)).toHaveLength(0);
    expect(H.posts(/\/nemt-trips\/$/)).toHaveLength(0);
  });

  it("validates, batches, adds the claim and generates one 837P — and stops there", async () => {
    const db = seedDb();
    const { bindClaimToRecord } = await import("@/lib/ediOwnership.server");
    const api = await import("@/lib/ediApi.server");
    const ledger = await import("@/lib/ediLedger.server");

    await bindClaimToRecord(db, OURS, "rec-smoke-1", 900);

    const validated = await api.claimValidateForRecord(db, OURS, "rec-smoke-1");
    expect(validated.ok).toBe(true);
    expect(validated.claim_id).toBe(900);

    const batchNumber = generateBatchNumber(OURS, new Date("2026-02-10T12:00:00Z"), "smk");
    const ledgerId = await ledger.openBatchLedger(db, OURS, {
      batch_number: batchNumber,
      environment: "test",
      trading_partner: "4",
      record_ids: ["rec-smoke-1"],
      created_by: null,
    });

    const created = await api.batchCreate(
      db,
      buildBatchCreateBody({ batchNumber, tradingPartner: 4, environment: "test" }),
    );
    expect(created.ok).toBe(true);
    const batchId = (created as { data: { id: number } }).data.id;
    await ledger.updateBatchLedger(db, OURS, ledgerId, { edi_batch_id: batchId, status: "created" });

    const added = await api.batchAddClaim(db, OURS, batchId, 900);
    expect(added.ok).toBe(true);
    expect(H.posts(/\/add-claim\/$/)[0]!.body).toEqual({ claim_id: 900 });

    const file = await api.generate837p(db, OURS, batchId);
    expect(file.ok).toBe(true);
    const fileId = (file as { data: { id: number } }).data.id;
    await ledger.updateBatchLedger(db, OURS, ledgerId, { edi_file_id: fileId, status: "generated" });

    // Exactly one batch, one add-claim, one 837P — and NO upload.
    expect(H.posts(/\/submission-batches\/$/)).toHaveLength(1);
    expect(H.posts(/\/add-claim\/$/)).toHaveLength(1);
    expect(H.posts(/generate-837p/)).toHaveLength(1);
    expect(H.calls.some((c) => c.path.endsWith("/upload/"))).toBe(false);

    const rows = await ledger.listBatchLedger(db, OURS, 10);
    expect(rows[0]).toMatchObject({ edi_batch_id: batchId, edi_file_id: fileId, status: "generated" });
  });

  it("refuses a cross-company batch or claim before any request leaves RedArt", async () => {
    const db = seedDb();
    const { bindClaimToRecord } = await import("@/lib/ediOwnership.server");
    const api = await import("@/lib/ediApi.server");
    await bindClaimToRecord(db, OURS, "rec-smoke-1", 900);

    const created = await api.batchCreate(db, buildBatchCreateBody({
      batchNumber: "RA-x", tradingPartner: 4, environment: "test",
    }));
    const batchId = (created as { data: { id: number } }).data.id;
    // Our own bill now owns the batch.
    await (db.from("billing_records") as any).update({ edi_batch_id: batchId }).eq("id", "rec-smoke-1");

    H.reset();
    await expect(api.batchAddClaim(db, THEIRS, batchId, 900)).rejects.toBeInstanceOf(EdiAccessError);
    await expect(api.generate837p(db, THEIRS, batchId)).rejects.toBeInstanceOf(EdiAccessError);
    await expect(api.claimValidateForRecord(db, THEIRS, "rec-smoke-1")).rejects.toBeInstanceOf(
      EdiAccessError,
    );
    await expect(api.fileUpload(db, THEIRS, 555)).rejects.toBeInstanceOf(EdiAccessError);
    // Nothing at all was sent for the foreign company.
    expect(H.calls).toHaveLength(0);
  });

  it("reports the backend's own words when an entity endpoint is missing", async () => {
    const db = seedDb();
    const { ensureClaimForRecord } = await import("@/lib/ediSync.server");
    const res = await ensureClaimForRecord(db, OURS, detail, {
      environment: "test",
      providerId: "101",
      paths: {
        provider: "/api/v1/provider-profiles/",
        trading_partner: "/api/v1/trading-partners/",
        patient: null,
        trip: null,
        claim_from_trip: null,
      },
    });
    // No patient/trip entity advertised: falls back to the documented /claims/.
    expect(res.via).toBe("claims_endpoint");
    expect(H.posts(/\/claims\/$/)).toHaveLength(1);
    expect(H.posts(/\/patients\/$/)).toHaveLength(0);
  });
});
