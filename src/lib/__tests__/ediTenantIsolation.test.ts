/**
 * Multi-tenant safety for the EDI integration.
 *
 * The EDI backend numbers claims, batches and files sequentially, so an id on
 * its own proves nothing. These tests pin the two rules that keep one company
 * out of another's data:
 *
 *   1. The browser-reachable proxy forwards ONLY tenant-neutral read-only
 *      paths. Anything naming a resource id is refused there.
 *   2. Every vetted server path proves the id maps to a row this company owns
 *      before it is used, and answers "not found for this company" identically
 *      whether the resource is foreign or does not exist.
 *
 * Also pins the documented backend contract we depend on (batch create body,
 * claim-from-trip linkage) and that no secret ever reaches a sync payload.
 */
import { describe, expect, it } from "vitest";
import {
  EDI_PATH_BLOCKED,
  batchCreateBlockers,
  buildBatchCreateBody,
  ediOwnershipMessage,
  ediUnlinkedMessage,
  entityIdFrom,
  generateBatchNumber,
  isEdiApiPath,
  isSafeEdiReadPath,
  normalizeEdiPath,
  parseEdiId,
  SAFE_EDI_READS,
} from "@/lib/ediGuard";
import {
  assertBatchOwned,
  assertFileOwned,
  assertRecordsOwned,
  claimIdForRecord,
  EdiAccessError,
  ownedRecordIds,
  recordIdForClaim,
} from "@/lib/ediOwnership.server";
import { EDI_PATHS } from "@/lib/ediTransport";
import {
  buildClaimFromTripPayload,
  buildNemtTripPayload,
  buildPatientPayload,
  buildProviderProfilePayload,
  buildTradingPartnerPayload,
  companySyncBlockers,
  ediDate,
  fingerprint,
  splitName,
  stableJson,
  summarizeCompanySync,
} from "@/lib/ediSync";
import type { EdiTripDetail } from "@/lib/ediTypes";

const OURS = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";

/* ------------------------------------------------------------------ */
/* Fake PostgREST                                                      */
/* ------------------------------------------------------------------ */

type BillRow = {
  id: string;
  company_id: string;
  resubmission_id: string | null;
  edi_claim_id: number | null;
  edi_batch_id: number | null;
  edi_file_id: number | null;
};

type LedgerRow = { id: string; company_id: string; edi_batch_id: number | null; edi_file_id: number | null };

function makeDb(bills: BillRow[], ledger: LedgerRow[] = []) {
  const tables: Record<string, any[]> = { billing_records: bills, edi_batches: ledger };
  return {
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const filters: ((r: any) => boolean)[] = [];
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
        limit: (n: number) =>
          Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, n), error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return q;
    },
  };
}

const bill = (over: Partial<BillRow> & { id: string; company_id: string }): BillRow => ({
  resubmission_id: null,
  edi_claim_id: null,
  edi_batch_id: null,
  edi_file_id: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* 1. Proxy allow-list                                                 */
/* ------------------------------------------------------------------ */

describe("only tenant-neutral EDI reads are reachable from the browser", () => {
  it("allows exactly health and the integration catalog, by GET", () => {
    expect(SAFE_EDI_READS).toContain(EDI_PATHS.health());
    expect(SAFE_EDI_READS).toContain(EDI_PATHS.integrationCatalog());
    expect(isSafeEdiReadPath(EDI_PATHS.health())).toBe(true);
    expect(isSafeEdiReadPath(EDI_PATHS.integrationCatalog(), "GET")).toBe(true);
    // Same path, wrong verb: a read allow-list never authorises a write.
    expect(isSafeEdiReadPath(EDI_PATHS.health(), "POST")).toBe(false);
  });

  it("refuses every path that names a claim, batch or file id", () => {
    const blocked = [
      EDI_PATHS.claims(),
      EDI_PATHS.claim(412),
      EDI_PATHS.claimValidate(412),
      EDI_PATHS.claimStatus(412),
      EDI_PATHS.batches(),
      EDI_PATHS.batch(9),
      EDI_PATHS.batchAddClaim(9),
      EDI_PATHS.generate837p(),
      EDI_PATHS.ediFileUpload(3),
    ];
    for (const path of blocked) expect(isSafeEdiReadPath(path)).toBe(false);
  });

  it("cannot be tricked by query strings, doubled slashes or casing", () => {
    expect(isSafeEdiReadPath(`${EDI_PATHS.health()}?x=1`)).toBe(true);
    expect(normalizeEdiPath("//api//health//")).toBe("/api/health/");
    expect(isSafeEdiReadPath("/api/health")).toBe(true);
    // A claim path dressed up as a health query is still a claim path.
    expect(isSafeEdiReadPath("/api/v1/claims/412/?next=/api/health/")).toBe(false);
  });

  it("never leaves the EDI API: absolute URLs and traversal are not paths", () => {
    expect(isEdiApiPath("https://evil.example.com/api/health/")).toBe(false);
    expect(isEdiApiPath("/api/../../etc/passwd")).toBe(false);
    expect(isEdiApiPath("/api\\v1\\claims\\1")).toBe(false);
    expect(isEdiApiPath("/health/")).toBe(false);
    expect(isEdiApiPath(EDI_PATHS.health())).toBe(true);
  });

  it("has one blocked-path message, and it points at the vetted route", () => {
    expect(EDI_PATH_BLOCKED).toMatch(/company-scoped/i);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Ownership assertions                                             */
/* ------------------------------------------------------------------ */

describe("a company can only reach EDI resources mapped to its own bills", () => {
  const db = makeDb(
    [
      bill({ id: "ours-1", company_id: OURS, edi_claim_id: 100, edi_batch_id: 10, edi_file_id: 55 }),
      bill({ id: "ours-2", company_id: OURS }),
      bill({ id: "theirs-1", company_id: THEIRS, edi_claim_id: 200, edi_batch_id: 20, edi_file_id: 77 }),
    ],
    [{ id: "led-1", company_id: OURS, edi_batch_id: 30, edi_file_id: 88 }],
  );

  it("resolves our own claim id from our own bill", async () => {
    await expect(claimIdForRecord(db, OURS, "ours-1")).resolves.toBe(100);
    await expect(recordIdForClaim(db, OURS, 100)).resolves.toBe("ours-1");
  });

  it("refuses another company's bill and its claim id", async () => {
    await expect(claimIdForRecord(db, OURS, "theirs-1")).rejects.toBeInstanceOf(EdiAccessError);
    await expect(recordIdForClaim(db, OURS, 200)).rejects.toBeInstanceOf(EdiAccessError);
  });

  it("says the same thing for 'not yours' and 'does not exist'", async () => {
    const foreign = await recordIdForClaim(db, OURS, 200).catch((e: Error) => e.message);
    const missing = await recordIdForClaim(db, OURS, 999999).catch((e: Error) => e.message);
    expect(foreign).toBe(ediOwnershipMessage("claim", 200));
    expect(missing).toBe(ediOwnershipMessage("claim", 999999));
    // Identical shape: an attacker learns nothing from the wording.
    expect(foreign.replace(/#\d+/, "#N")).toBe(missing.replace(/#\d+/, "#N"));
  });

  it("distinguishes 'not linked yet' from 'not yours' for our own bill", async () => {
    await expect(claimIdForRecord(db, OURS, "ours-2")).rejects.toThrow(ediUnlinkedMessage());
  });

  it("accepts a batch/file owned through a bill or through the batch ledger", async () => {
    await expect(assertBatchOwned(db, OURS, 10)).resolves.toBeUndefined();
    await expect(assertFileOwned(db, OURS, 55)).resolves.toBeUndefined();
    await expect(assertBatchOwned(db, OURS, 30)).resolves.toBeUndefined();
    await expect(assertFileOwned(db, OURS, 88)).resolves.toBeUndefined();
  });

  it("refuses a batch/file id belonging to another company", async () => {
    await expect(assertBatchOwned(db, OURS, 20)).rejects.toThrow(ediOwnershipMessage("batch", 20));
    await expect(assertFileOwned(db, OURS, 77)).rejects.toThrow(ediOwnershipMessage("file", 77));
    await expect(assertBatchOwned(THEIRS, OURS as never, 10 as never)).rejects.toBeTruthy();
  });

  it("filters a bulk selection down to our own bills, and refuses a mixed one", async () => {
    await expect(ownedRecordIds(db, OURS, ["ours-1", "ours-2", "theirs-1"])).resolves.toEqual([
      "ours-1",
      "ours-2",
    ]);
    await expect(assertRecordsOwned(db, OURS, ["ours-1", "ours-2"])).resolves.toBeUndefined();
    await expect(assertRecordsOwned(db, OURS, ["ours-1", "theirs-1"])).rejects.toBeInstanceOf(
      EdiAccessError,
    );
  });

  it("never treats a resubmission row as an original EDI-linked bill", async () => {
    const withResub = makeDb([
      bill({ id: "resub-1", company_id: OURS, resubmission_id: "r-1", edi_claim_id: 300 }),
    ]);
    await expect(recordIdForClaim(withResub, OURS, 300)).rejects.toBeInstanceOf(EdiAccessError);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Backend id parsing                                               */
/* ------------------------------------------------------------------ */

describe("backend ids are parsed strictly", () => {
  it("accepts positive integers only", () => {
    expect(parseEdiId(12)).toBe(12);
    expect(parseEdiId("12")).toBe(12);
    expect(parseEdiId(0)).toBeNull();
    expect(parseEdiId(-3)).toBeNull();
    expect(parseEdiId(1.5)).toBeNull();
    expect(parseEdiId("12abc")).toBeNull();
    expect(parseEdiId(null)).toBeNull();
  });

  it("finds the id in the shapes the backend actually returns", () => {
    expect(entityIdFrom({ id: 7 })).toBe(7);
    expect(entityIdFrom({ data: { id: 8 } })).toBe(8);
    expect(entityIdFrom({ results: [{ id: 9 }] })).toBe(9);
    expect(entityIdFrom({ claim_id: 11 }, ["claim_id"])).toBe(11);
    expect(entityIdFrom({ detail: "created" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Documented batch contract                                        */
/* ------------------------------------------------------------------ */

describe("submission batch follows the documented contract", () => {
  it("creates with batch_number + trading_partner + environment and no claim_ids", () => {
    const body = buildBatchCreateBody({
      batchNumber: "RA-abc123-20260101120000-xyz",
      tradingPartner: 4,
      environment: "test",
    });
    expect(body).toEqual({
      batch_number: "RA-abc123-20260101120000-xyz",
      trading_partner: 4,
      environment: "test",
    });
    expect(Object.keys(body)).not.toContain("claim_ids");
    expect(Object.keys(body)).not.toContain("claims");
  });

  it("refuses to build a batch without a linked trading partner", () => {
    const blockers = batchCreateBlockers({ batchNumber: "RA-1", environment: "test" });
    expect(blockers.join(" ")).toMatch(/Sync to EDI backend/);
    expect(
      batchCreateBlockers({ batchNumber: "RA-1", tradingPartner: 2, environment: "test" }),
    ).toEqual([]);
  });

  it("generates a company-scoped, collision-resistant batch number", () => {
    const when = new Date("2026-01-02T03:04:05Z");
    expect(generateBatchNumber(OURS, when, "aaa")).toBe("RA-111111-20260102030405-aaa");
    expect(generateBatchNumber(OURS, when, "aaa")).not.toBe(
      generateBatchNumber(THEIRS, when, "aaa"),
    );
    expect(generateBatchNumber(OURS, when)).not.toBe(generateBatchNumber(OURS, when));
  });
});

/* ------------------------------------------------------------------ */
/* 5. Sync payloads carry setup, never secrets                         */
/* ------------------------------------------------------------------ */

const settings = {
  company_id: OURS,
  billing_name: "Universal MNGHT LLC",
  provider_identifier_type: "npi" as const,
  medicaid_provider_id: null,
  npi: "1234567893",
  taxonomy_code: "343900000X",
  tax_id: "84-1234567",
  address_line1: "100 Main St",
  address_line2: null,
  city: "Lamar",
  state: "CO",
  postal_code: "81052",
  phone: "7195551234",
  contact_name: "Lamar LA",
  contact_email: "billing@example.com",
  sender_id: "SENDER01",
  receiver_id: "RECEIVER1",
  environment: "test" as const,
  transport_mode: "shared" as const,
  production_enabled: false,
  sftp_host: "sftp.example.com",
  sftp_port: 22,
  sftp_username: "redart",
  sftp_directory: "/in",
  sftp_secret_configured: true,
  notes: null,
};

const detail: EdiTripDetail = {
  record_id: "rec-1",
  trip_id: "trip-1",
  rider_id: "rider-1",
  member: {
    name: "Doe, Jane",
    medicaid_id: "A123456789",
    dob: "1980-04-05T00:00:00.000Z",
    address: "9 Elm St",
    phone: "7195559876",
  },
  trip: {
    service_date: "2026-07-30",
    pickup_address: "9 Elm St",
    dropoff_address: "Clinic",
    miles: 12.4,
    trip_kind: "round_trip",
    vehicle_type: "ambulatory",
  },
  lines: [
    { procedure_code: "A0120", modifiers: ["U1"], units: 2, rate: 15.5, amount: 31 },
    { procedure_code: "S0215", modifiers: [], units: 12.4, rate: 1.25, amount: 15.5 },
  ],
  total_charge: 46.5,
  diagnosis_code: "Z0000",
  blockers: [],
} as unknown as EdiTripDetail;

describe("sync payloads", () => {
  it("send provider setup but never any credential", () => {
    const provider = buildProviderProfilePayload(settings);
    const partner = buildTradingPartnerPayload(settings, "test");
    const text = JSON.stringify({ provider, partner });
    for (const secretish of ["sftp_password", "password", "private_key", "secret", "redart"]) {
      expect(text.toLowerCase()).not.toContain(secretish);
    }
    expect(provider["npi"]).toBe("1234567893");
    expect(provider["legal_name"]).toBe(settings.billing_name);
    expect(provider["address_line_1"]).toBe("100 Main St");
    expect(provider["zip"]).toBe("81052");
    expect(partner["sender_id"]).toBe("SENDER01");
    expect(partner["environment"]).toBe("TEST");
  });

  it("report the setup that is still missing instead of sending a half-built provider", () => {
    expect(companySyncBlockers(null)).toHaveLength(1);
    expect(companySyncBlockers(settings)).toEqual([]);
    expect(companySyncBlockers({ ...settings, npi: null }).join(" ")).toMatch(/NPI/);
    expect(
      companySyncBlockers({
        ...settings,
        provider_identifier_type: "health_first_colorado_id",
        medicaid_provider_id: "9000211959",
        npi: null,
      }),
    ).toEqual([]);
    expect(companySyncBlockers({ ...settings, receiver_id: "" }).join(" ")).toMatch(/Receiver/);
  });

  it("map member and trip to backend fields, money as exact 2-decimal strings", () => {
    const patient = buildPatientPayload(detail.member, 5);
    expect(patient).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
      medicaid_id: "A123456789",
      date_of_birth: "1980-04-05",
      provider: 5,
    });

    const trip = buildNemtTripPayload(detail, { patientId: 12, providerId: 5 });
    expect(trip["patient"]).toBe(12);
    expect(trip["external_id"]).toBe("rec-1");
    expect(trip["service_date"]).toBe("2026-07-30");
    expect(trip["total_charge"]).toBe("46.50");
    const lines = trip["service_lines"] as Record<string, unknown>[];
    expect(lines[0]!["charge_amount"]).toBe("31.00");
    expect(lines[1]!["unit_rate"]).toBe("1.25");
  });

  it("link a claim to its trip through the documented from-trip body", () => {
    expect(buildClaimFromTripPayload(12, "rec-1", "test")).toEqual({
      trip_id: 12,
      external_id: "rec-1",
      environment: "test",
    });
  });

  it("re-sync is a no-op when nothing changed (fingerprints are stable)", () => {
    const a = fingerprint(buildProviderProfilePayload(settings));
    const b = fingerprint(buildProviderProfilePayload({ ...settings }));
    expect(a).toBe(b);
    expect(fingerprint(buildProviderProfilePayload({ ...settings, npi: "9999999999" }))).not.toBe(a);
    // Key order must not change the hash.
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
  });

  it("handles names and dates the way the backend expects", () => {
    expect(splitName("Mary Jane Watson")).toEqual({ first_name: "Mary Jane", last_name: "Watson" });
    expect(splitName("Watson, Mary")).toEqual({ first_name: "Mary", last_name: "Watson" });
    expect(splitName("  ")).toEqual({ first_name: "", last_name: "" });
    expect(ediDate("2026-07-30")).toBe("2026-07-30");
    expect(ediDate("not a date")).toBeNull();
    expect(ediDate(null)).toBeNull();
  });

  it("summarises a sync in plain language", () => {
    expect(summarizeCompanySync([], ["Billing NPI is required"])).toBe("Billing NPI is required");
    expect(
      summarizeCompanySync(
        [{ kind: "provider", action: "unchanged", id: "3", message: null }],
        [],
      ),
    ).toMatch(/Already in sync/);
    expect(
      summarizeCompanySync(
        [
          { kind: "provider", action: "created", id: "3", message: null },
          { kind: "trading_partner", action: "updated", id: "4", message: null },
        ],
        [],
      ),
    ).toBe("EDI backend updated: 1 created, 1 updated.");
    expect(
      summarizeCompanySync(
        [{ kind: "provider", action: "failed", id: null, message: "NPI already in use" }],
        [],
      ),
    ).toBe("NPI already in use");
  });
});
