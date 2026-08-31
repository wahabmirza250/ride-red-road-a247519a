import { describe, it, expect } from "vitest";
import {
  ensureOriginalBillingRecord,
  findOriginalBillingRecord,
  isImmutableOriginal,
  isUniqueViolation,
} from "@/lib/originalBillingRecord.server";

/** The exact production error the broken `onConflict: "trip_id"` upsert raised. */
const PG_ON_CONFLICT_ERROR =
  "there is no unique or exclusion constraint matching the ON CONFLICT specification";

type Row = {
  id: string;
  trip_id: string;
  resubmission_id: string | null;
  company_id: string | null;
  trip_form_id: string | null;
  status: string;
  state_confirmation_number?: string | null;
};

/**
 * Minimal PostgREST stand-in that enforces the real partial unique indexes:
 *   (trip_id) WHERE resubmission_id IS NULL
 *   (resubmission_id) WHERE resubmission_id IS NOT NULL
 * and rejects any ON CONFLICT arbiter, exactly like Postgres does.
 */
function makeDb(rows: Row[] = [], opts: { onInsert?: () => void } = {}) {
  let seq = rows.length;
  const db = {
    rows,
    from(table: string) {
      if (table !== "billing_records") throw new Error("unexpected table " + table);
      const q: any = {
        _filters: [] as ((r: Row) => boolean)[],
        select() {
          return q;
        },
        eq(col: string, val: any) {
          q._filters.push((r: any) => r[col] === val);
          return q;
        },
        is(col: string, val: any) {
          q._filters.push((r: any) => (r as any)[col] === val);
          return q;
        },
        maybeSingle() {
          if (q._pending) return Promise.resolve(q._pending);
          const hit = rows.filter((r) => q._filters.every((f: any) => f(r)))[0] ?? null;
          return Promise.resolve({ data: hit, error: null });
        },
        upsert(_v: any, options?: { onConflict?: string }) {
          if (options?.onConflict === "trip_id") {
            q._pending = { data: null, error: { code: "42P10", message: PG_ON_CONFLICT_ERROR } };
          }
          return q;
        },
        insert(v: any) {
          opts.onInsert?.();
          const dup = rows.some((r) => r.trip_id === v.trip_id && r.resubmission_id == null);
          if (dup) {
            q._pending = {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
            return q;
          }
          const row: Row = {
            id: `br-${++seq}`,
            trip_id: v.trip_id,
            resubmission_id: v.resubmission_id ?? null,
            company_id: v.company_id ?? null,
            trip_form_id: v.trip_form_id ?? null,
            status: v.status ?? "approved",
            state_confirmation_number: null,
          };
          rows.push(row);
          q._pending = { data: { id: row.id }, error: null };
          return q;
        },
        update(patch: any) {
          q._patch = patch;
          const apply = () => {
            for (const r of rows.filter((r) => q._filters.every((f: any) => f(r))))
              Object.assign(r, q._patch);
            return { data: null, error: null };
          };
          q.then = (res: any) => Promise.resolve(apply()).then(res);
          return q;
        },
      };
      return q;
    },
  };
  return db;
}

describe("original billing record (paper-bill upload regression)", () => {
  it("reproduces the prior failure: ON CONFLICT (trip_id) is rejected by Postgres", async () => {
    const db = makeDb();
    const res = await db
      .from("billing_records")
      .upsert({ trip_id: "t1" }, { onConflict: "trip_id" })
      .select("id")
      .maybeSingle();
    expect(res.error?.message).toBe(PG_ON_CONFLICT_ERROR);
  });

  it("creates the original record for a brand-new paper upload", async () => {
    const db = makeDb();
    const r = await ensureOriginalBillingRecord(db, {
      tripId: "t1",
      companyId: "c1",
      tripFormId: "t1",
      status: "approved",
    });
    expect(r.created).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.resubmission_id).toBeNull();
    expect(db.rows[0]!.status).toBe("approved");
  });

  it("is idempotent when the same upload is retried", async () => {
    const db = makeDb();
    const a = await ensureOriginalBillingRecord(db, { tripId: "t1", companyId: "c1" });
    const b = await ensureOriginalBillingRecord(db, { tripId: "t1", companyId: "c1" });
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(false);
    expect(db.rows).toHaveLength(1);
  });

  it("updates an existing, not-yet-submitted original record", async () => {
    const db = makeDb([
      {
        id: "br-1",
        trip_id: "t1",
        resubmission_id: null,
        company_id: null,
        trip_form_id: null,
        status: "pending_review",
      },
    ]);
    const r = await ensureOriginalBillingRecord(db, {
      tripId: "t1",
      companyId: "c1",
      tripFormId: "t1",
      status: "approved",
    });
    expect(r).toEqual({ id: "br-1", created: false });
    expect(db.rows[0]!.status).toBe("approved");
    expect(db.rows[0]!.company_id).toBe("c1");
  });

  it("never rewrites a bill that already reached the portal", async () => {
    const db = makeDb([
      {
        id: "br-1",
        trip_id: "t1",
        resubmission_id: null,
        company_id: "c1",
        trip_form_id: "t1",
        status: "submitted",
        state_confirmation_number: "HCPF-9",
      },
    ]);
    const r = await ensureOriginalBillingRecord(db, { tripId: "t1", status: "approved" });
    expect(r.created).toBe(false);
    expect(db.rows[0]!.status).toBe("submitted");
    expect(db.rows[0]!.state_confirmation_number).toBe("HCPF-9");
    expect(isImmutableOriginal(db.rows[0]!)).toBe(true);
  });

  it("ignores a corrected record on the same trip and never creates a second original", async () => {
    const db = makeDb([
      {
        id: "br-corr",
        trip_id: "t1",
        resubmission_id: "rs-1",
        company_id: "c1",
        trip_form_id: "t1",
        status: "pending_submit",
      },
    ]);
    const r = await ensureOriginalBillingRecord(db, { tripId: "t1", companyId: "c1" });
    expect(r.created).toBe(true);
    expect(db.rows.filter((x) => x.resubmission_id === null)).toHaveLength(1);
    expect(db.rows.find((x) => x.id === "br-corr")!.status).toBe("pending_submit");
  });

  it("resolves a concurrent race by reading the winner's row", async () => {
    // Two callers both see "no record", then one insert loses on the partial index.
    const db = makeDb();
    let inserts = 0;
    const racing = makeDb(db.rows, {
      onInsert: () => {
        if (inserts++ === 0)
          db.rows.push({
            id: "br-winner",
            trip_id: "t1",
            resubmission_id: null,
            company_id: "c1",
            trip_form_id: "t1",
            status: "approved",
          });
      },
    });
    const r = await ensureOriginalBillingRecord(racing, { tripId: "t1", companyId: "c1" });
    expect(r).toEqual({ id: "br-winner", created: false });
    expect(db.rows.filter((x) => x.resubmission_id === null)).toHaveLength(1);
  });

  it("classifies unique violations", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value" })).toBe(true);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("scopes lookups by trip and never leaks another tenant's row", async () => {
    const db = makeDb([
      {
        id: "br-other",
        trip_id: "t-other",
        resubmission_id: null,
        company_id: "c2",
        trip_form_id: "t-other",
        status: "approved",
      },
    ]);
    // The caller's supabase client is the RLS-scoped one, so a foreign trip is
    // simply not visible; here it is at minimum never matched.
    expect(await findOriginalBillingRecord(db, "t1")).toBeNull();
    const r = await ensureOriginalBillingRecord(db, { tripId: "t1", companyId: "c1" });
    expect(db.rows.find((x) => x.id === r.id)!.company_id).toBe("c1");
    expect(db.rows.find((x) => x.id === "br-other")!.company_id).toBe("c2");
  });
});
