/**
 * Super EDI bulk pipeline — validate many, batch many, generate ONE 837P.
 *
 * Every step is company-scoped, authorised server-side and idempotent:
 *   - a bill keeps the claim id it already has (no duplicate claims);
 *   - a ready selection that is already batched reuses its batch and file;
 *   - one bad claim never blocks the ready ones;
 *   - PRODUCTION upload requires the company to be production-enabled AND an
 *     explicit typed confirmation. TEST is the default everywhere.
 *
 * Only the `edi_*` columns of `billing_records` are ever written, so the
 * legacy HCPF/robot workflow is untouched.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EDI_PATHS } from "@/lib/ediTransport";
import { partitionForBatch, planBatch, summarizeValidation } from "@/lib/ediBulk";
import { PRODUCTION_CONFIRM_PHRASE } from "@/lib/ediSetup";
import type { EdiValidationOutcome, EdiValidationSummary } from "@/lib/ediBulk";
import type { EdiWorkRow } from "@/lib/ediTypes";

export type { EdiValidationOutcome, EdiValidationSummary } from "@/lib/ediBulk";

const CompanyScope = { company_id: z.string().uuid().nullable().optional() };
const RecordIds = z.array(z.string().uuid()).min(1).max(300);

/** Small worker pool — the EDI backend gets steady, bounded traffic. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Pulls an entity id out of whatever shape the backend returned. */
function entityId(payload: unknown, keys: string[]): number | null {
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  for (const key of ["id", ...keys]) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  for (const nested of ["data", "claim", "batch", "file", "result"]) {
    const child = rec[nested];
    if (child && typeof child === "object") {
      const found = entityId(child, keys);
      if (found !== null) return found;
    }
  }
  return null;
}

type Env = "test" | "production";

/** Environment + production clearance come from the DB, never from the browser. */
async function loadEnvironment(
  supabase: any,
  companyId: string,
): Promise<{ environment: Env; productionEnabled: boolean }> {
  const { data } = await supabase
    .from("edi_company_settings")
    .select("environment, production_enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  const env = (data?.environment === "production" ? "production" : "test") as Env;
  return { environment: env, productionEnabled: data?.production_enabled === true };
}

/* ------------------------------------------------------------------ */
/* Validate many                                                       */
/* ------------------------------------------------------------------ */

export const ediValidateSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...CompanyScope, record_ids: RecordIds }).parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ results: EdiValidationOutcome[]; summary: EdiValidationSummary; rows: EdiWorkRow[] }> => {
      const { supabase, userId } = context;
      const { resolveEdiScope } = await import("@/lib/ediCompany.server");
      const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

      const { loadEdiDetails, toWorkRow } = await import("@/lib/ediRecords.server");
      const { ediFetch } = await import("@/lib/ediBridge.server");
      const { writeEdiState } = await import("@/lib/ediWrite.server");
      const { buildEdiClaimPayload, localClaimBlockers } = await import("@/lib/ediPayload");
      const { ediIsValid } = await import("@/lib/edi");

      const details = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
      const { environment } = await loadEnvironment(supabase, companyId);

      const results = await pool(details, 4, async (detail): Promise<EdiValidationOutcome> => {
        const blockers = localClaimBlockers(detail);
        if (blockers.length) {
          // A RedArt data problem: don't waste a backend round-trip, and don't
          // write an error the biller cannot act on from the EDI side.
          return { record_id: detail.record_id, ok: true, ready: false, message: blockers[0]! };
        }

        // 1. Reuse the existing claim; otherwise create exactly one.
        let claimId = detail.edi.edi_claim_id;
        if (!claimId) {
          const created = await ediFetch(supabase, {
            path: EDI_PATHS.claims(),
            method: "POST",
            body: buildEdiClaimPayload(detail, environment),
          });
          if (!created.ok) {
            await writeEdiState(supabase, companyId, detail.record_id, {
              edi_status: "create_failed",
              edi_last_error: created.error,
            });
            return { record_id: detail.record_id, ok: false, ready: null, message: created.error };
          }
          claimId = entityId(created.data, ["claim_id"]);
          if (!claimId) {
            const message = "EDI backend did not return a claim id";
            await writeEdiState(supabase, companyId, detail.record_id, {
              edi_status: "create_failed",
              edi_last_error: message,
            });
            return { record_id: detail.record_id, ok: false, ready: null, message };
          }
          // Persist immediately: a later failure must not orphan the claim.
          await writeEdiState(supabase, companyId, detail.record_id, {
            edi_claim_id: claimId,
            edi_status: "created",
            edi_last_error: null,
            edi_environment: environment,
          });
        }

        // 2. Ask the backend whether it is ready. `ready` is the source of truth.
        const validated = await ediFetch(supabase, {
          path: EDI_PATHS.claimValidate(claimId),
          method: "POST",
          body: {},
        });
        if (!validated.ok) {
          await writeEdiState(supabase, companyId, detail.record_id, {
            edi_claim_id: claimId,
            edi_status: "validation_failed",
            edi_last_error: validated.error,
          });
          return { record_id: detail.record_id, ok: false, ready: null, message: validated.error };
        }

        const ready = ediIsValid(validated.data);
        await writeEdiState(supabase, companyId, detail.record_id, {
          edi_claim_id: claimId,
          edi_status: ready ? "ready" : "not_ready",
          edi_validation: (validated.data ?? {}) as Record<string, unknown>,
          edi_last_error: null,
          edi_environment: environment,
        });
        return { record_id: detail.record_id, ok: true, ready };
      });

      const refreshed = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
      return {
        results,
        summary: summarizeValidation(results),
        rows: refreshed.map(toWorkRow),
      };
    },
  );

/* ------------------------------------------------------------------ */
/* Build ONE batch + ONE 837P                                          */
/* ------------------------------------------------------------------ */

export type EdiBatchBuildResult = {
  ok: boolean;
  message: string;
  batch_id: number | null;
  file_id: number | null;
  included: string[];
  excluded: { record_id: string; reason: string }[];
  failures: { record_id: string; reason: string }[];
  rows: EdiWorkRow[];
};

export const ediBuildBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...CompanyScope, record_ids: RecordIds }).parse(d))
  .handler(async ({ data, context }): Promise<EdiBatchBuildResult> => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { loadEdiDetails, toWorkRow } = await import("@/lib/ediRecords.server");
    const { ediFetch } = await import("@/lib/ediBridge.server");
    const { writeEdiState, writeEdiStateMany } = await import("@/lib/ediWrite.server");

    const details = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
    const rows = details.map(toWorkRow);
    const { environment } = await loadEnvironment(supabase, companyId);

    const { excluded } = partitionForBatch(rows);
    const plan = planBatch(rows);
    const finish = async (
      partial: Omit<EdiBatchBuildResult, "rows" | "excluded">,
    ): Promise<EdiBatchBuildResult> => {
      const after = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
      return { ...partial, excluded, rows: after.map(toWorkRow) };
    };

    if (plan.action === "none") {
      return finish({
        ok: false,
        message: plan.reason,
        batch_id: null,
        file_id: null,
        included: [],
        failures: [],
      });
    }

    const byRecord = new Map(rows.map((r) => [r.record_id, r]));
    const failures: { record_id: string; reason: string }[] = [];

    /** Generates the 837P for a batch once — reuses an existing file id. */
    const ensureFile = async (batchId: number, recordIds: string[], existing: number | null) => {
      if (existing) return { fileId: existing, error: null as string | null };
      const generated = await ediFetch(supabase, {
        path: EDI_PATHS.generate837p(),
        method: "POST",
        body: { batch_id: batchId },
      });
      if (!generated.ok) return { fileId: null, error: generated.error };
      const fileId = entityId(generated.data, ["file_id", "edi_file_id"]);
      if (!fileId) return { fileId: null, error: "EDI backend did not return a file id" };
      await writeEdiStateMany(supabase, companyId, recordIds, {
        edi_file_id: fileId,
        edi_status: "generated",
        edi_last_error: null,
      });
      return { fileId, error: null as string | null };
    };

    // Idempotent path: this exact selection already has a batch.
    if (plan.action === "reuse") {
      const { fileId, error } = await ensureFile(plan.batch_id, plan.record_ids, plan.file_id);
      return finish({
        ok: !error,
        message: error
          ? `Batch ${plan.batch_id} already exists; generating the 837P failed: ${error}`
          : `Reused batch ${plan.batch_id} — 837P file ${fileId}`,
        batch_id: plan.batch_id,
        file_id: fileId,
        included: plan.record_ids,
        failures: error ? [{ record_id: "", reason: error }] : [],
      });
    }

    // 1. Create the submission batch.
    const batchRes = await ediFetch(supabase, {
      path: EDI_PATHS.batches(),
      method: "POST",
      body: {},
    });
    if (!batchRes.ok) {
      return finish({
        ok: false,
        message: batchRes.error,
        batch_id: null,
        file_id: null,
        included: [],
        failures: [],
      });
    }
    const batchId = entityId(batchRes.data, ["batch_id", "submission_batch_id"]);
    if (!batchId) {
      return finish({
        ok: false,
        message: "EDI backend did not return a batch id",
        batch_id: null,
        file_id: null,
        included: [],
        failures: [],
      });
    }

    // 2. Add every ready claim. A rejected claim is reported, never fatal.
    const added: string[] = [];
    for (const recordId of plan.record_ids) {
      const row = byRecord.get(recordId);
      if (!row?.edi_claim_id) continue;
      const res = await ediFetch(supabase, {
        path: EDI_PATHS.batchAddClaim(batchId),
        method: "POST",
        body: { claim_id: row.edi_claim_id },
      });
      if (!res.ok) {
        failures.push({ record_id: recordId, reason: res.error });
        await writeEdiState(supabase, companyId, recordId, { edi_last_error: res.error });
        continue;
      }
      added.push(recordId);
    }

    if (!added.length) {
      return finish({
        ok: false,
        message: `Batch ${batchId} was created but no claim could be added`,
        batch_id: batchId,
        file_id: null,
        included: [],
        failures,
      });
    }

    await writeEdiStateMany(supabase, companyId, added, {
      edi_batch_id: batchId,
      edi_status: "batched",
      edi_last_error: null,
      edi_environment: environment,
    });

    // 3. ONE 837P file for the whole batch.
    const { fileId, error } = await ensureFile(batchId, added, null);
    return finish({
      ok: !error,
      message: error
        ? `Batch ${batchId} built with ${added.length} claim(s); 837P generation failed: ${error}`
        : `Batch ${batchId} built with ${added.length} claim(s) — 837P file ${fileId}`,
      batch_id: batchId,
      file_id: fileId,
      included: added,
      failures,
    });
  });

/* ------------------------------------------------------------------ */
/* Upload (transport) — TEST by default, PRODUCTION double-gated       */
/* ------------------------------------------------------------------ */

export { PRODUCTION_CONFIRM_PHRASE } from "@/lib/ediSetup";

export const ediUploadFileToTradingPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ...CompanyScope,
        file_id: z.number().int().positive(),
        record_ids: z.array(z.string().uuid()).max(300).optional(),
        environment: z.enum(["test", "production"]),
        confirmation: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveEdiScope } = await import("@/lib/ediCompany.server");
    const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

    const { environment: companyEnv, productionEnabled } = await loadEnvironment(supabase, companyId);

    if (data.environment === "production") {
      if (!productionEnabled || companyEnv !== "production") {
        throw new Error(
          "This company is not cleared for production submission. Enable production in Provider Setup first.",
        );
      }
      if ((data.confirmation ?? "").trim().toUpperCase() !== PRODUCTION_CONFIRM_PHRASE) {
        throw new Error(`Type "${PRODUCTION_CONFIRM_PHRASE}" to confirm a live submission.`);
      }
    }

    const { ediFetch } = await import("@/lib/ediBridge.server");
    const res = await ediFetch(supabase, {
      path: EDI_PATHS.ediFileUpload(data.file_id),
      method: "POST",
      body: {},
    });

    const { writeEdiStateMany } = await import("@/lib/ediWrite.server");
    const ids = data.record_ids ?? [];
    if (ids.length) {
      await writeEdiStateMany(supabase, companyId, ids, {
        edi_status: res.ok ? "uploaded" : "upload_failed",
        edi_last_error: res.ok ? null : res.error,
        edi_environment: data.environment,
      });
    }

    return res.ok
      ? { ok: true as const, message: `File ${data.file_id} handed to transport (${data.environment}).` }
      : { ok: false as const, message: res.error };
  });

/* ------------------------------------------------------------------ */
/* Claim status / remittance refresh                                   */
/* ------------------------------------------------------------------ */

export const ediRefreshStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...CompanyScope, record_ids: RecordIds }).parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ updated: number; failed: { record_id: string; reason: string }[]; rows: EdiWorkRow[] }> => {
      const { supabase, userId } = context;
      const { resolveEdiScope } = await import("@/lib/ediCompany.server");
      const { companyId } = await resolveEdiScope(supabase, userId, data.company_id ?? null);

      const { loadEdiDetails, toWorkRow } = await import("@/lib/ediRecords.server");
      const { ediFetch } = await import("@/lib/ediBridge.server");
      const { ediBackendStatus } = await import("@/lib/ediStatusFeed");

      const details = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
      const linked = details.filter((d) => !!d.edi.edi_claim_id);
      const failed: { record_id: string; reason: string }[] = [];
      let updated = 0;

      await pool(linked, 6, async (detail) => {
        const res = await ediFetch(supabase, {
          path: EDI_PATHS.claimStatus(detail.edi.edi_claim_id!),
          method: "GET",
        });
        if (!res.ok) {
          failed.push({ record_id: detail.record_id, reason: res.error });
          return;
        }
        const payload = (res.data ?? {}) as Record<string, unknown>;
        const status = ediBackendStatus(payload);
        const { error } = await supabase
          .from("billing_records")
          .update({
            edi_status_detail: payload as never,
            ...(status ? { edi_status: status } : {}),
            edi_last_sync_at: new Date().toISOString(),
            edi_last_error: null,
          } as never)
          .eq("id", detail.record_id)
          .eq("company_id", companyId)
          .is("resubmission_id", null);
        if (error) failed.push({ record_id: detail.record_id, reason: error.message });
        else updated += 1;
      });

      const refreshed = await loadEdiDetails(supabase, companyId, { recordIds: data.record_ids });
      return { updated, failed, rows: refreshed.map(toWorkRow) };
    },
  );
