/**
 * SERVER ONLY — the vetted EDI operations.
 *
 * This is the ONLY place in the app that may call an EDI endpoint naming a
 * resource id, and every function here proves ownership first (see
 * `ediOwnership.server`). Callers address resources the way RedArt knows them
 * — by billing record id — so a browser can never hand us a raw claim id and
 * have it forwarded.
 *
 * Ownership failures throw `EdiAccessError`; backend failures come back as a
 * normal `EdiResult` so the UI can show the backend's own message. Nothing
 * here logs request or response bodies: they contain PHI.
 */
import { EDI_PATHS, type EdiResult } from "@/lib/ediTransport";
import {
  assertBatchOwned,
  assertFileOwned,
  claimIdForRecord,
  recordIdForClaim,
} from "@/lib/ediOwnership.server";

type Sb = any;

async function fetchEdi<T = unknown>(
  supabase: Sb,
  req: { path: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown },
): Promise<EdiResult<T>> {
  const { ediFetch } = await import("@/lib/ediBridge.server");
  return ediFetch<T>(supabase, req);
}

/* ------------------------------------------------------------------ */
/* Claims — addressed by RedArt billing record                         */
/* ------------------------------------------------------------------ */

/** GET /claims/{id}/ for the claim linked to one of this company's bills. */
export async function claimGetForRecord<T = unknown>(
  supabase: Sb,
  companyId: string,
  recordId: string,
): Promise<EdiResult<T> & { claim_id: number }> {
  const claimId = await claimIdForRecord(supabase, companyId, recordId);
  const res = await fetchEdi<T>(supabase, { path: EDI_PATHS.claim(claimId), method: "GET" });
  return { ...res, claim_id: claimId };
}

/** POST /claims/{id}/validate/ */
export async function claimValidateForRecord<T = unknown>(
  supabase: Sb,
  companyId: string,
  recordId: string,
): Promise<EdiResult<T> & { claim_id: number }> {
  const claimId = await claimIdForRecord(supabase, companyId, recordId);
  const res = await fetchEdi<T>(supabase, {
    path: EDI_PATHS.claimValidate(claimId),
    method: "POST",
    body: {},
  });
  return { ...res, claim_id: claimId };
}

/** GET /claims/{id}/status/ */
export async function claimStatusForRecord<T = unknown>(
  supabase: Sb,
  companyId: string,
  recordId: string,
): Promise<EdiResult<T> & { claim_id: number }> {
  const claimId = await claimIdForRecord(supabase, companyId, recordId);
  const res = await fetchEdi<T>(supabase, { path: EDI_PATHS.claimStatus(claimId), method: "GET" });
  return { ...res, claim_id: claimId };
}

/**
 * Same three operations, addressed by a claim id that has ALREADY been proven
 * to belong to this company (used by the bulk pipeline, which loads the ids
 * from the company's own rows).
 */
export async function claimValidateById<T = unknown>(
  supabase: Sb,
  companyId: string,
  claimId: number,
): Promise<EdiResult<T>> {
  await recordIdForClaim(supabase, companyId, claimId);
  return fetchEdi<T>(supabase, { path: EDI_PATHS.claimValidate(claimId), method: "POST", body: {} });
}

export async function claimStatusById<T = unknown>(
  supabase: Sb,
  companyId: string,
  claimId: number,
): Promise<EdiResult<T>> {
  await recordIdForClaim(supabase, companyId, claimId);
  return fetchEdi<T>(supabase, { path: EDI_PATHS.claimStatus(claimId), method: "GET" });
}

/* ------------------------------------------------------------------ */
/* Claim creation                                                      */
/* ------------------------------------------------------------------ */

/** POST /claims/from-trip/ — the documented way to create a linked claim. */
export async function claimCreateFromTrip<T = unknown>(
  supabase: Sb,
  body: Record<string, unknown>,
): Promise<EdiResult<T>> {
  return fetchEdi<T>(supabase, { path: EDI_PATHS.claimFromTrip(), method: "POST", body });
}

/** POST /claims/ — only used when the backend advertises no trip entity. */
export async function claimCreateDirect<T = unknown>(
  supabase: Sb,
  body: Record<string, unknown>,
): Promise<EdiResult<T>> {
  return fetchEdi<T>(supabase, { path: EDI_PATHS.claims(), method: "POST", body });
}

/* ------------------------------------------------------------------ */
/* Submission batches and 837P files                                   */
/* ------------------------------------------------------------------ */

/** POST /submission-batches/ — `{ batch_number, trading_partner, environment }`. */
export async function batchCreate<T = unknown>(
  supabase: Sb,
  body: Record<string, unknown>,
): Promise<EdiResult<T>> {
  return fetchEdi<T>(supabase, { path: EDI_PATHS.batches(), method: "POST", body });
}

/** POST /submission-batches/{id}/add-claim/ — `{ claim_id }`. */
export async function batchAddClaim<T = unknown>(
  supabase: Sb,
  companyId: string,
  batchId: number,
  claimId: number,
): Promise<EdiResult<T>> {
  await assertBatchOwned(supabase, companyId, batchId);
  await recordIdForClaim(supabase, companyId, claimId);
  return fetchEdi<T>(supabase, {
    path: EDI_PATHS.batchAddClaim(batchId),
    method: "POST",
    body: { claim_id: claimId },
  });
}

/** GET /submission-batches/{id}/ */
export async function batchGet<T = unknown>(
  supabase: Sb,
  companyId: string,
  batchId: number,
): Promise<EdiResult<T>> {
  await assertBatchOwned(supabase, companyId, batchId);
  return fetchEdi<T>(supabase, { path: EDI_PATHS.batch(batchId), method: "GET" });
}

/** POST /edi-files/generate-837p/ — `{ batch_id }`. */
export async function generate837p<T = unknown>(
  supabase: Sb,
  companyId: string,
  batchId: number,
): Promise<EdiResult<T>> {
  await assertBatchOwned(supabase, companyId, batchId);
  return fetchEdi<T>(supabase, {
    path: EDI_PATHS.generate837p(),
    method: "POST",
    body: { batch_id: batchId },
  });
}

/** GET /edi-files/{id}/ */
export async function fileGet<T = unknown>(
  supabase: Sb,
  companyId: string,
  fileId: number,
): Promise<EdiResult<T>> {
  await assertFileOwned(supabase, companyId, fileId);
  return fetchEdi<T>(supabase, { path: EDI_PATHS.ediFile(fileId), method: "GET" });
}

/** POST /edi-files/{id}/upload/ — the only call that leaves RedArt for a payer. */
export async function fileUpload<T = unknown>(
  supabase: Sb,
  companyId: string,
  fileId: number,
): Promise<EdiResult<T>> {
  await assertFileOwned(supabase, companyId, fileId);
  return fetchEdi<T>(supabase, { path: EDI_PATHS.ediFileUpload(fileId), method: "POST", body: {} });
}

/* ------------------------------------------------------------------ */
/* Tenant-neutral reads                                                */
/* ------------------------------------------------------------------ */

export async function ediHealth<T = unknown>(supabase: Sb): Promise<EdiResult<T>> {
  return fetchEdi<T>(supabase, { path: EDI_PATHS.health(), method: "GET" });
}

export async function ediCatalog<T = unknown>(supabase: Sb): Promise<EdiResult<T>> {
  return fetchEdi<T>(supabase, { path: EDI_PATHS.integrationCatalog(), method: "GET" });
}
