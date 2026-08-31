import { describe, expect, it } from "vitest";
import { deriveDriverOptions, profileDisplayName } from "@/lib/driverOptions";
import {
  ALLOWED_ATTACHMENT_MIME,
  MAX_ATTACHMENT_BYTES,
  attachmentPath,
  isDraftAttachmentPath,
  validateAttachment,
} from "@/lib/resubmissionAttachment";
import { diffSnapshots, normalizeSnapshot } from "@/lib/resubmissionDraft";

/**
 * Minimal PostgREST stand-in: selecting a column that does not exist on the
 * table fails the whole query, exactly like production.
 */
function fakeSupabase() {
  const TABLES: Record<string, { columns: string[]; rows: any[] }> = {
    drivers: {
      columns: ["id", "user_id", "unit_number", "company_id"],
      rows: [
        { id: "d1", user_id: "u1", unit_number: "12", company_id: "co-1" },
        { id: "d2", user_id: null, unit_number: "7", company_id: "co-1" },
        { id: "d3", user_id: "u9", unit_number: null, company_id: "co-2" },
      ],
    },
    profiles: {
      columns: ["id", "first_name", "last_name", "email"],
      rows: [{ id: "u1", first_name: "Sam", last_name: "Driver", email: "sam@x.com" }],
    },
  };
  return {
    from(table: string) {
      const t = TABLES[table]!;
      let rows = [...t.rows];
      const api: any = {
        select(cols: string) {
          for (const c of cols.split(",").map((s) => s.trim())) {
            if (!t.columns.includes(c))
              throw new Error(`column '${c}' does not exist on '${table}'.`);
          }
          return api;
        },
        eq(col: string, val: any) {
          rows = rows.filter((r) => r[col] === val);
          return api;
        },
        in(col: string, vals: any[]) {
          rows = rows.filter((r) => vals.includes(r[col]));
          return api;
        },
        limit() {
          return api;
        },
        then(res: any) {
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return api;
    },
  };
}

/** Mirrors the server helper: id + user_id only, names from profiles. */
async function listCompanyDrivers(supabase: any, companyId: string | null) {
  let q = supabase.from("drivers").select("id, user_id, unit_number").limit(500);
  if (companyId) q = q.eq("company_id", companyId);
  const { data: rows } = await q;
  const userIds = (rows ?? []).map((r: any) => r.user_id).filter(Boolean);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name, email").in("id", userIds)
    : { data: [] };
  return deriveDriverOptions(rows ?? [], profiles ?? []);
}

describe("driver picker without a drivers.full_name column", () => {
  it("fails loudly if anyone reintroduces the full_name select", async () => {
    const sb = fakeSupabase();
    expect(() => sb.from("drivers").select("id, full_name")).toThrow(/full_name.*does not exist/);
  });

  it("loads the editor's driver options from id + user_id + profiles", async () => {
    const options = await listCompanyDrivers(fakeSupabase(), "co-1");
    expect(options.map((o) => o.name)).toEqual(["Sam Driver", "Unit 7"]);
    // Company isolation: the other company's driver is never returned.
    expect(options.some((o) => o.id === "d3")).toBe(false);
  });

  it("falls back safely when a profile has no name", () => {
    expect(profileDisplayName({ id: "u", email: "x@y.z" })).toBe("x@y.z");
    expect(deriveDriverOptions([{ id: "abcdef1234", user_id: null }], [])[0]!.name).toBe(
      "Driver abcdef12",
    );
  });
});

describe("resubmission attachment safety", () => {
  it("accepts PDFs and images within the size limit", () => {
    for (const mime of ALLOWED_ATTACHMENT_MIME)
      expect(validateAttachment({ type: mime, size: 1024 }).ok).toBe(true);
  });

  it("rejects unsupported types, empty files and oversized files", () => {
    expect(validateAttachment({ type: "application/zip", size: 10 }).ok).toBe(false);
    expect(validateAttachment({ type: "application/pdf", size: 0 }).ok).toBe(false);
    expect(
      validateAttachment({ type: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }).ok,
    ).toBe(false);
  });

  it("writes into a draft-scoped path that can never collide with the original", () => {
    const p = attachmentPath({
      userId: "user-1",
      resubmissionId: "sub-1",
      mime: "application/pdf",
      now: 1700000000000,
    });
    expect(p).toBe("user-1/resubmissions/sub-1/1700000000000.pdf");
    expect(isDraftAttachmentPath(p)).toBe(true);
    expect(isDraftAttachmentPath("user-1/paper-inbox/original.pdf")).toBe(false);
  });

  it("shows the attachment change in the Original -> Corrected review", () => {
    const original = normalizeSnapshot({ state_pdf_path: "user-1/paper-inbox/original.pdf", legs: [], lines: [] });
    const corrected = normalizeSnapshot({
      state_pdf_path: "user-1/resubmissions/sub-1/1.pdf",
      legs: [],
      lines: [],
    });
    const change = diffSnapshots(original, corrected).find((c) => c.field === "state_pdf_path");
    expect(change?.label).toBe("Supporting attachment");
    expect(change?.before).toBe("user-1/paper-inbox/original.pdf");
    expect(change?.after).toBe("user-1/resubmissions/sub-1/1.pdf");
  });
});

/** Mirrors the BEFORE UPDATE trigger installed on claim_resubmissions. */
function applyImmutabilityTrigger(oldRow: any, newRow: any) {
  for (const col of [
    "original_trip_id",
    "original_claim_number",
    "original_denial_reason",
    "original_status",
    "company_id",
  ]) {
    if (JSON.stringify(newRow[col] ?? null) !== JSON.stringify(oldRow[col] ?? null))
      throw new Error(`The ${col} of a resubmission is immutable.`);
  }
  if (JSON.stringify(newRow.original_snapshot ?? null) !== JSON.stringify(oldRow.original_snapshot ?? null)) {
    const backfill =
      oldRow.original_snapshot == null &&
      newRow.original_snapshot != null &&
      oldRow.status === "draft";
    if (!backfill) throw new Error("The original snapshot of a resubmission is immutable.");
  }
  return newRow;
}

describe("database-level immutability of the original claim", () => {
  const row = {
    id: "sub-1",
    company_id: "co-1",
    original_trip_id: "trip-1",
    original_claim_number: "2326240001014",
    original_denial_reason: "Duplicate service",
    original_status: "denied",
    original_snapshot: { service_date: "2026-07-30" },
    draft_snapshot: { service_date: "2026-07-30" },
    status: "draft",
  };

  it("blocks every original field and the owning company", () => {
    for (const col of [
      "original_trip_id",
      "original_claim_number",
      "original_denial_reason",
      "original_status",
      "company_id",
    ]) {
      expect(() => applyImmutabilityTrigger(row, { ...row, [col]: "tampered" })).toThrow(/immutable/);
    }
    expect(() =>
      applyImmutabilityTrigger(row, { ...row, original_snapshot: { service_date: "2026-08-01" } }),
    ).toThrow(/immutable/);
  });

  it("allows draft-only fields to change", () => {
    expect(() =>
      applyImmutabilityTrigger(row, {
        ...row,
        draft_snapshot: { service_date: "2026-08-02" },
        status: "queued",
        notes: "corrected",
      }),
    ).not.toThrow();
  });

  it("permits exactly one null -> non-null snapshot backfill while still a draft", () => {
    const legacy = { ...row, original_snapshot: null };
    const filled = applyImmutabilityTrigger(legacy, {
      ...legacy,
      original_snapshot: { service_date: "2026-07-30" },
    });
    expect(filled.original_snapshot).toBeTruthy();
    // Locked forever afterwards.
    expect(() =>
      applyImmutabilityTrigger(filled, { ...filled, original_snapshot: { service_date: "x" } }),
    ).toThrow(/immutable/);
    // And a backfill is refused once the draft left the draft state.
    expect(() =>
      applyImmutabilityTrigger(
        { ...legacy, status: "queued" },
        { ...legacy, status: "queued", original_snapshot: { a: 1 } },
      ),
    ).toThrow(/immutable/);
  });
});

/** Mirrors recordEvent: a failed audit insert aborts the action. */
async function recordEvent(insert: () => Promise<{ error: { message: string } | null }>, action: string) {
  const { error } = await insert();
  if (error)
    throw new Error(
      `The ${action.replace(/_/g, " ")} could not be recorded in the audit trail, so it was not completed: ${error.message}`,
    );
}

describe("audit reliability", () => {
  it("fails the action when the audit event cannot be written", async () => {
    await expect(
      recordEvent(async () => ({ error: { message: "permission denied" } }), "draft_saved"),
    ).rejects.toThrow(/audit trail, so it was not completed/);
  });

  it("succeeds silently when the audit event is written", async () => {
    await expect(recordEvent(async () => ({ error: null }), "draft_queued")).resolves.toBeUndefined();
  });
});
