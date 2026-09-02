/**
 * Super EDI bulk rules.
 *
 * The two production invariants under test:
 *   1. One bad claim never blocks the ready claims from being batched.
 *   2. Readiness is the BACKEND's answer (`ready === true`) — never a local
 *      guess, and never a local mileage threshold.
 */
import { describe, expect, it } from "vitest";
import {
  attentionRows,
  batchCounts,
  ediRowState,
  exclusionReason,
  isBatchReady,
  partitionForBatch,
  planBatch,
  summarizeValidation,
  type EdiRowLike,
} from "@/lib/ediBulk";
import { EDI_PATHS, normalizeEdiEnvelope } from "@/lib/ediTransport";
import { readEdiLongDistance } from "@/lib/ediLongDistance";
import { ediBackendStatus, ediFeedSections, NOT_AVAILABLE } from "@/lib/ediStatusFeed";
import {
  canSubmitProduction,
  evaluateEdiSetup,
  isProductionConfirmed,
  PRODUCTION_CONFIRM_PHRASE,
  SECRET_SETUP_REQUIRED,
  type EdiCompanySettings,
} from "@/lib/ediSetup";

function row(over: Partial<EdiRowLike> & { record_id: string }): EdiRowLike {
  return {
    edi_claim_id: null,
    edi_batch_id: null,
    edi_file_id: null,
    edi_status: null,
    edi_ready: null,
    edi_issues: [],
    edi_last_error: null,
    local_blockers: [],
    ...over,
  };
}

const readyRow = (id: string, claimId: number) =>
  row({ record_id: id, edi_claim_id: claimId, edi_ready: true });

describe("bulk readiness comes from the backend", () => {
  it("only a backend `ready === true` claim is batch-ready", () => {
    expect(isBatchReady(readyRow("a", 1))).toBe(true);
    // Validated but the backend said no.
    expect(isBatchReady(row({ record_id: "b", edi_claim_id: 2, edi_ready: false }))).toBe(false);
    // Never validated: no local optimism.
    expect(isBatchReady(row({ record_id: "c", edi_claim_id: 3 }))).toBe(false);
    // Backend said ready but RedArt data is incomplete.
    expect(
      isBatchReady(
        row({ record_id: "d", edi_claim_id: 4, edi_ready: true, local_blockers: ["No Medicaid ID"] }),
      ),
    ).toBe(false);
    // Ready with no claim yet cannot be added to a batch.
    expect(isBatchReady(row({ record_id: "e", edi_ready: true }))).toBe(false);
  });

  it("maps rows to workspace states", () => {
    expect(ediRowState(row({ record_id: "a" }))).toBe("not_validated");
    expect(ediRowState(readyRow("b", 1))).toBe("ready");
    expect(ediRowState(row({ record_id: "c", edi_claim_id: 1, edi_ready: false }))).toBe(
      "needs_attention",
    );
    expect(ediRowState(row({ record_id: "d", edi_last_error: "backend 500" }))).toBe("error");
    expect(ediRowState(row({ record_id: "e", edi_batch_id: 9, edi_ready: true }))).toBe("batched");
    expect(ediRowState(row({ record_id: "f", edi_file_id: 3, edi_batch_id: 9 }))).toBe("generated");
    expect(ediRowState(row({ record_id: "g", edi_status: "uploaded" }))).toBe("uploaded");
  });
});

describe("one bad claim never blocks the ready ones", () => {
  const selection = [
    readyRow("r1", 101),
    row({ record_id: "bad", edi_claim_id: 102, edi_ready: false, edi_issues: ["Missing NPI"] }),
    readyRow("r2", 103),
    row({ record_id: "unvalidated" }),
    readyRow("r3", 104),
  ];

  it("partitions the selection and keeps every ready claim", () => {
    const { ready, excluded } = partitionForBatch(selection);
    expect(ready.map((r) => r.record_id)).toEqual(["r1", "r2", "r3"]);
    expect(excluded.map((e) => e.record_id)).toEqual(["bad", "unvalidated"]);
  });

  it("explains each exclusion with the backend's own words", () => {
    const { excluded } = partitionForBatch(selection);
    expect(excluded[0]!.reason).toBe("Missing NPI");
    expect(excluded[1]!.reason).toContain("Validate first");
    expect(exclusionReason(row({ record_id: "x", local_blockers: ["No rate configured"] }))).toBe(
      "No rate configured",
    );
  });

  it("reports honest counts for the submission screen", () => {
    expect(batchCounts(selection)).toEqual({
      selected: 5,
      ready: 3,
      excluded: 2,
      alreadyBatched: 0,
    });
  });

  it("surfaces the rows worth fixing, worst first", () => {
    const list = attentionRows([
      readyRow("ok", 1),
      row({ record_id: "attn", edi_claim_id: 2, edi_ready: false }),
      row({ record_id: "err", edi_last_error: "bridge timeout" }),
    ]);
    expect(list.map((r) => r.record_id)).toEqual(["err", "attn"]);
  });

  it("summarises a validate-all pass", () => {
    expect(
      summarizeValidation([
        { record_id: "a", ok: true, ready: true },
        { record_id: "b", ok: true, ready: false },
        { record_id: "c", ok: false, ready: null, message: "backend 502" },
      ]),
    ).toEqual({ total: 3, ready: 1, needsAttention: 1, error: 1 });
  });
});

describe("batch idempotency", () => {
  it("creates one batch for the ready rows", () => {
    const plan = planBatch([readyRow("a", 1), readyRow("b", 2), row({ record_id: "c" })]);
    expect(plan).toEqual({ action: "create", record_ids: ["a", "b"] });
  });

  it("reuses an existing batch and file instead of creating a second one", () => {
    const plan = planBatch([
      row({ record_id: "a", edi_claim_id: 1, edi_ready: true, edi_batch_id: 7, edi_file_id: 12 }),
      row({ record_id: "b", edi_claim_id: 2, edi_ready: true, edi_batch_id: 7, edi_file_id: 12 }),
    ]);
    expect(plan).toEqual({ action: "reuse", batch_id: 7, file_id: 12, record_ids: ["a", "b"] });
  });

  it("refuses to build when nothing is ready", () => {
    const plan = planBatch([row({ record_id: "a", edi_claim_id: 1, edi_ready: false })]);
    expect(plan).toEqual({ action: "none", reason: "No claim in this selection is ready" });
  });
});

describe("documented endpoint contract", () => {
  it("uses the guide's 837P paths, not invented batch endpoints", () => {
    expect(EDI_PATHS.generate837p()).toBe("/api/v1/edi-files/generate-837p/");
    expect(EDI_PATHS.ediFileUpload(9)).toBe("/api/v1/edi-files/9/upload/");
    expect(EDI_PATHS.batches()).toBe("/api/v1/submission-batches/");
    expect(EDI_PATHS.batchAddClaim(4)).toBe("/api/v1/submission-batches/4/add-claim/");
    expect(EDI_PATHS.claimValidate(3)).toBe("/api/v1/claims/3/validate/");
    expect(EDI_PATHS.claimStatus(3)).toBe("/api/v1/claims/3/status/");
    expect(EDI_PATHS.claimFromTrip()).toBe("/api/v1/claims/from-trip/");

    const all = Object.values(EDI_PATHS).map((fn) => (fn as (id: number) => string)(1));
    expect(all.some((p) => p.includes("/generate/"))).toBe(false);
    expect(all.some((p) => p.endsWith("/submit/"))).toBe(false);
  });

  it("unwraps the deployed bridge envelope", () => {
    expect(normalizeEdiEnvelope({ success: true, status: 200, data: { id: 5 } })).toEqual({
      ok: true,
      data: { id: 5 },
    });
    const failed = normalizeEdiEnvelope({ success: false, status: 400, data: { detail: "bad NPI" } });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain("bad NPI");
  });
});

describe("long distance is the backend's decision", () => {
  it("says pending when the backend has not evaluated the claim", () => {
    const ld = readEdiLongDistance({ id: 1 }, null);
    expect(ld.state).toBe("pending");
    expect(ld.label).toBe("Pending backend evaluation");
    expect(ld.isLongDistance).toBe(null);
  });

  it("never derives long distance from local mileage", () => {
    // 120 miles, but the backend said nothing → still pending, no guess.
    const ld = readEdiLongDistance({ miles: 120, total_miles: 120 });
    expect(ld.state).toBe("pending");
    expect(ld.isLongDistance).toBe(null);
  });

  it("reports the backend's rule and missing documents", () => {
    const ld = readEdiLongDistance({
      long_distance: {
        is_long_distance: true,
        attachment_required: true,
        rule: "Rural threshold (backend)",
        missing_documents: ["Prior authorization"],
        required_documents: ["Prior authorization", "Trip log"],
      },
    });
    expect(ld.state).toBe("required");
    expect(ld.rule).toBe("Rural threshold (backend)");
    expect(ld.missingDocuments).toEqual(["Prior authorization"]);
    expect(ld.requiredDocuments).toContain("Trip log");
  });

  it("has no local mileage threshold anywhere in the module", async () => {
    const source = await import("@/lib/ediLongDistance?raw").then(
      (m) => (m as { default: string }).default,
    );
    expect(source).not.toMatch(/LONG_DISTANCE_MILES/);
    expect(source).not.toMatch(/>\s*50\s*miles/i);
  });
});

describe("acknowledgement feed", () => {
  it("shows the backend's own 999 / 277 / 835 detail", () => {
    const sections = ediFeedSections({
      status: "ACCEPTED",
      acknowledgement_999: { status: "ACCEPTED", received_at: "2026-02-01T10:00:00Z" },
      claim_status_277: { status: "PENDING", reasons: ["In adjudication"] },
      remittance_835: { paid_amount: 42.5, denial_reason: null },
    });
    const titles = sections.map((s) => s.title);
    expect(titles.join(" ")).toMatch(/999/);
    expect(titles.join(" ")).toMatch(/277/);
    expect(titles.join(" ")).toMatch(/835/);
    expect(ediBackendStatus({ status: "ACCEPTED" })).toBe("ACCEPTED");
  });

  it("says so plainly when the backend exposes nothing yet", () => {
    const sections = ediFeedSections(null);
    expect(sections).toHaveLength(3);
    expect(sections.every((s) => s.available === false)).toBe(true);
    expect(sections.every((s) => s.summary === NOT_AVAILABLE)).toBe(true);
    expect(ediBackendStatus(null)).toBe(null);
  });
});

describe("company setup gates", () => {
  const complete: EdiCompanySettings = {
    company_id: "c1",
    billing_name: "RedArt Transport LLC",
    provider_identifier_type: "npi",
    medicaid_provider_id: null,
    npi: "1234567893",
    taxonomy_code: "347B00000X",
    tax_id: "84-1234567",
    address_line1: "100 Main St",
    address_line2: null,
    city: "Denver",
    state: "CO",
    postal_code: "80202",
    phone: "3035551234",
    contact_name: "Ops",
    contact_email: "ops@example.com",
    sender_id: "REDART",
    receiver_id: "CO_HCPF",
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

  it("shared transport needs no company secret", () => {
    const status = evaluateEdiSetup(complete);
    expect(status.providerReady).toBe(true);
    expect(status.transportReady).toBe(true);
    expect(status.ready).toBe(true);
  });

  it("company-specific transport asks for a secure credential, never a typed one", () => {
    const status = evaluateEdiSetup({
      ...complete,
      transport_mode: "company",
      sftp_host: "sftp.example.com",
      sftp_username: "redart",
    });
    expect(status.transportReady).toBe(false);
    expect(status.issues.map((i) => i.message)).toContain(SECRET_SETUP_REQUIRED);
  });

  it("accepts an atypical Colorado provider ID without an NPI", () => {
    const status = evaluateEdiSetup({
      ...complete,
      provider_identifier_type: "health_first_colorado_id",
      medicaid_provider_id: "9000211959",
      npi: null,
    });
    expect(status.providerReady).toBe(true);
  });

  it("keeps production behind setup, an explicit switch and a typed phrase", () => {
    expect(canSubmitProduction(complete)).toBe(false);
    expect(canSubmitProduction({ ...complete, environment: "production" })).toBe(false);
    expect(
      canSubmitProduction({ ...complete, environment: "production", production_enabled: true }),
    ).toBe(true);
    expect(
      canSubmitProduction({
        ...complete,
        environment: "production",
        production_enabled: true,
        npi: null,
      }),
    ).toBe(false);
    expect(isProductionConfirmed("submit production")).toBe(true);
    expect(isProductionConfirmed("yes")).toBe(false);
    expect(PRODUCTION_CONFIRM_PHRASE).toBe("SUBMIT PRODUCTION");
  });

  it("claims can be validated before transport is configured", () => {
    const status = evaluateEdiSetup({ ...complete, sender_id: null, receiver_id: null });
    expect(status.claimReady).toBe(true);
    expect(status.ready).toBe(false);
  });
});
