/**
 * Durable paper-bill inbox server functions.
 *
 * These functions ONLY create/track paper trip reports and the trips + billing
 * records they become. They never submit, enqueue, resubmit or change any
 * claim status, and they never touch the submission or status-sync queues.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reconcileUpload, sha256Hex, type PaperInboxRow } from "@/lib/paperInbox";

const SELECT =
  "id, company_id, uploaded_by, storage_path, file_name, mime, content_hash, status, error, attempts, ocr, draft, trip_id, billing_record_id, processed_at, created_at";

async function assertBilling(supabase: any) {
  const { data, error } = await supabase.rpc("current_user_can_bill");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: billing staff only");
}

/** Every outstanding + recently finished upload for the signed-in company. */
export const listPaperInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertBilling(context.supabase);
    const { data, error } = await context.supabase
      .from("paper_inbox_files")
      .select(SELECT)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as PaperInboxRow[];
  });

/**
 * Record a file that the browser has just stored in `state-pdfs`.
 * Idempotent: the same storage path (or the same file contents) never yields a
 * second row, so a retried/duplicated upload cannot produce a second trip.
 */
export const registerPaperInboxFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        storage_path: z.string().min(1),
        file_name: z.string().min(1).max(300),
        mime: z.string().min(1).max(120),
        content_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);

    const { data: byPath } = await supabase
      .from("paper_inbox_files")
      .select(SELECT)
      .eq("company_id", companyId)
      .eq("storage_path", data.storage_path)
      .maybeSingle();

    let byHash: PaperInboxRow | null = null;
    if (data.content_hash) {
      const { data: hit } = await supabase
        .from("paper_inbox_files")
        .select(SELECT)
        .eq("company_id", companyId)
        .eq("content_hash", data.content_hash)
        .maybeSingle();
      byHash = (hit as PaperInboxRow) ?? null;
    }

    const decision = reconcileUpload({
      existingByPath: byPath as PaperInboxRow | null,
      existingByHash: byHash,
    });

    if (decision.action !== "create") {
      const row = (byPath as PaperInboxRow) ?? byHash!;
      return { row, duplicate: decision.action === "duplicate" };
    }

    const { data: created, error } = await supabase
      .from("paper_inbox_files")
      .insert({
        company_id: companyId,
        uploaded_by: userId,
        storage_path: data.storage_path,
        file_name: data.file_name,
        mime: data.mime,
        content_hash: data.content_hash ?? null,
        status: "uploaded",
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return { row: created as PaperInboxRow, duplicate: false };
  });

/** Persist read progress, OCR output, biller edits or a visible failure. */
export const savePaperInboxState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["uploaded", "reading", "needs_review", "error"]).optional(),
        error: z.string().max(2000).nullable().optional(),
        ocr: z.any().optional(),
        draft: z.any().optional(),
        bump_attempt: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertBilling(supabase);

    const { data: current, error: readErr } = await supabase
      .from("paper_inbox_files")
      .select("id, status, trip_id, attempts")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("That upload is no longer in the inbox");
    // A finished import is immutable — never reopen a file that already made a
    // trip and a bill.
    if (current.status === "done" && current.trip_id) return { row: current, locked: true };

    const patch: Record<string, any> = {};
    if (data.status) patch["status"] = data.status;
    if (data.error !== undefined) patch["error"] = data.error;
    if (data.ocr !== undefined) patch["ocr"] = data.ocr;
    if (data.draft !== undefined) patch["draft"] = data.draft;
    if (data.bump_attempt) patch["attempts"] = (current.attempts ?? 0) + 1;

    const { data: row, error } = await supabase
      .from("paper_inbox_files")
      .update(patch)
      .eq("id", data.id)
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return { row: row as PaperInboxRow, locked: false };
  });

/** Remove an upload the biller does not want (only before it became a trip). */
export const discardPaperInboxFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertBilling(supabase);
    const { data: row } = await supabase
      .from("paper_inbox_files")
      .select("id, status, trip_id, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { removed: false };
    if (row.status === "done" && row.trip_id)
      throw new Error("This upload already created a trip and bill — it cannot be discarded");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("state-pdfs").remove([row.storage_path]);
    const { error } = await supabase.from("paper_inbox_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { removed: true };
  });

/**
 * Scan `state-pdfs/<user>/paper-inbox/` for files this company uploaded that
 * have NO inbox row (uploads lost by the old browser-only flow) and adopt them.
 * Purely additive and idempotent: adopting a file twice is impossible because
 * the storage path is unique per company, and no trip or bill is created here.
 */
export const adoptOrphanPaperInboxFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase);
    const { requireCompanyId } = await import("@/lib/company.server");
    const companyId = await requireCompanyId(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: members } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("company_id", companyId);
    const memberIds: string[] = (members ?? []).map((m: { id: string }) => m.id);
    if (!memberIds.includes(userId)) memberIds.push(userId);

    const { data: known } = await supabase
      .from("paper_inbox_files")
      .select("storage_path")
      .eq("company_id", companyId);
    const knownPaths = new Set((known ?? []).map((r: { storage_path: string }) => r.storage_path));

    let adopted = 0;
    let skipped = 0;
    const failures: { path: string; error: string }[] = [];

    for (const memberId of memberIds) {
      const prefix = `${memberId}/paper-inbox`;
      const { data: objects, error } = await supabaseAdmin.storage
        .from("state-pdfs")
        .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
      if (error || !objects?.length) continue;

      for (const obj of objects) {
        const path = `${prefix}/${obj.name}`;
        if (knownPaths.has(path)) {
          skipped++;
          continue;
        }
        try {
          const { data: file } = await supabaseAdmin.storage.from("state-pdfs").download(path);
          const hash = file ? await sha256Hex(await file.arrayBuffer()) : null;
          const { error: insErr } = await supabase.from("paper_inbox_files").insert({
            company_id: companyId,
            uploaded_by: memberId,
            storage_path: path,
            file_name: obj.name,
            mime: (obj.metadata as any)?.mimetype ?? "application/pdf",
            content_hash: hash,
            status: "uploaded",
          });
          // A unique-index conflict simply means another pass already adopted
          // it (or the identical scan exists) — that is a skip, not a failure.
          if (insErr) {
            if (/duplicate key/i.test(insErr.message)) skipped++;
            else failures.push({ path, error: insErr.message });
          } else {
            adopted++;
            knownPaths.add(path);
          }
        } catch (e: any) {
          failures.push({ path, error: e?.message ?? "Could not read the stored file" });
        }
      }
    }

    return { adopted, skipped, failures };
  });
