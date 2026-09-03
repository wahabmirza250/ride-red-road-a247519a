/**
 * SERVER ONLY — keeps the EDI backend's entities in step with RedArt.
 *
 * A claim cannot exist in the EDI backend on its own: it belongs to a provider,
 * a patient and an NEMT trip that must exist there first. This module creates
 * (or re-uses) those entities and remembers their ids, so:
 *
 *   - saving company setup twice never creates a second provider profile;
 *   - the same member is one patient, not one per bill;
 *   - the same trip is one NEMT trip, and its claim is created with the
 *     documented `/claims/from-trip/` linkage.
 *
 * Endpoint discovery is honest: paths for provider / trading partner / patient
 * / trip come from the backend's own integration catalog. If the backend does
 * not advertise an entity, RedArt reports that instead of inventing a URL.
 */
import {
  entityDetailPath,
  indexEdiCatalog,
  resolveEdiEntityPaths,
  type EdiCatalogIndex,
} from "@/lib/ediCatalog";
import { entityIdFrom } from "@/lib/ediGuard";
import {
  buildClaimFromTripPayload,
  buildNemtTripPayload,
  buildPatientPayload,
  buildProviderProfilePayload,
  buildTradingPartnerPayload,
  companySyncBlockers,
  fingerprint,
  patientFingerprint,
  summarizeCompanySync,
  tripFingerprint,
  type EdiCompanySyncReport,
  type EdiSyncEntityResult,
} from "@/lib/ediSync";
import type { EdiCompanySettings, EdiEnvironment } from "@/lib/ediSetup";
import type { EdiTripDetail } from "@/lib/ediTypes";

type Sb = any;

async function fetchEdi<T = unknown>(
  supabase: Sb,
  req: { path: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown },
) {
  const { ediFetch } = await import("@/lib/ediBridge.server");
  return ediFetch<T>(supabase, req);
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export type EdiCatalogState = {
  index: EdiCatalogIndex;
  paths: ReturnType<typeof resolveEdiEntityPaths>;
  error: string | null;
};

export async function loadCatalogState(supabase: Sb): Promise<EdiCatalogState> {
  const { ediCatalog } = await import("@/lib/ediApi.server");
  const res = await ediCatalog(supabase);
  if (!res.ok) {
    const empty = indexEdiCatalog(null);
    return { index: empty, paths: resolveEdiEntityPaths(empty), error: res.error };
  }
  const index = indexEdiCatalog(res.data);
  return { index, paths: resolveEdiEntityPaths(index), error: null };
}

/* ------------------------------------------------------------------ */
/* Company entities: provider profile + trading partner                */
/* ------------------------------------------------------------------ */

/**
 * A RedArt-wide shared trading partner may be configured as a server secret.
 * Companies in `shared` transport mode then point at that one approved
 * partner instead of getting one of their own.
 */
function sharedTradingPartnerId(): string | null {
  const v = process.env["EDI_SHARED_TRADING_PARTNER_ID"];
  return v && String(v).trim() ? String(v).trim() : null;
}

type UpsertOutcome = { id: string | null; result: EdiSyncEntityResult };

async function upsertEntity(
  supabase: Sb,
  args: {
    kind: "provider" | "trading_partner";
    collection: string | null;
    existingId: string | null;
    existingFingerprint: string | null;
    payload: Record<string, unknown>;
    idKeys: string[];
  },
): Promise<UpsertOutcome & { fingerprint: string }> {
  const print = fingerprint(args.payload);
  const label = args.kind === "provider" ? "provider profile" : "trading partner";

  if (!args.collection) {
    return {
      id: args.existingId,
      fingerprint: args.existingFingerprint ?? print,
      result: {
        kind: args.kind,
        action: "skipped",
        id: args.existingId,
        message: `The EDI backend does not advertise a ${label} endpoint, so nothing was created.`,
      },
    };
  }

  // Unchanged: an idempotent re-save must not touch the backend at all.
  if (args.existingId && args.existingFingerprint === print) {
    return {
      id: args.existingId,
      fingerprint: print,
      result: { kind: args.kind, action: "unchanged", id: args.existingId, message: null },
    };
  }

  if (args.existingId) {
    const patched = await fetchEdi(supabase, {
      path: entityDetailPath(args.collection, args.existingId),
      method: "PATCH",
      body: args.payload,
    });
    if (patched.ok) {
      return {
        id: args.existingId,
        fingerprint: print,
        result: { kind: args.kind, action: "updated", id: args.existingId, message: null },
      };
    }
    // A 404 means the linked entity is gone from the backend — recreate it
    // rather than leaving the company permanently broken.
    if (patched.status !== 404) {
      return {
        id: args.existingId,
        fingerprint: args.existingFingerprint ?? print,
        result: { kind: args.kind, action: "failed", id: args.existingId, message: patched.error },
      };
    }
  }

  const created = await fetchEdi(supabase, {
    path: args.collection,
    method: "POST",
    body: args.payload,
  });
  if (!created.ok) {
    return {
      id: args.existingId,
      fingerprint: args.existingFingerprint ?? print,
      result: { kind: args.kind, action: "failed", id: args.existingId, message: created.error },
    };
  }
  const newId = entityIdFrom(created.data, args.idKeys);
  if (newId === null) {
    return {
      id: args.existingId,
      fingerprint: args.existingFingerprint ?? print,
      result: {
        kind: args.kind,
        action: "failed",
        id: args.existingId,
        message: `The EDI backend did not return an id for the new ${label}.`,
      },
    };
  }
  return {
    id: String(newId),
    fingerprint: print,
    result: { kind: args.kind, action: "created", id: String(newId), message: null },
  };
}

/**
 * Syncs one company's non-secret setup into the EDI backend and stores the
 * returned ids in `edi_company_mapping`. Never sends SFTP secrets; a
 * company-specific credential id is only ever recorded, never created here.
 */
export async function syncCompanyEntities(
  supabase: Sb,
  companyId: string,
  settings: EdiCompanySettings | null,
): Promise<EdiCompanySyncReport> {
  const { loadCompanyMapping, saveCompanyMapping } = await import("@/lib/ediLedger.server");
  const mapping = await loadCompanyMapping(supabase, companyId);
  const environment: EdiEnvironment = settings?.environment === "production" ? "production" : "test";

  const blockers = companySyncBlockers(settings);
  if (blockers.length) {
    await saveCompanyMapping(supabase, companyId, {
      environment,
      last_sync_error: blockers[0]!,
    });
    return {
      ok: false,
      environment,
      entities: [],
      provider_id: mapping.edi_provider_profile_id,
      trading_partner_id: mapping.edi_trading_partner_id,
      blockers,
      last_synced_at: mapping.last_synced_at,
      message: blockers[0]!,
    };
  }

  const catalog = await loadCatalogState(supabase);
  if (catalog.error) {
    await saveCompanyMapping(supabase, companyId, { environment, last_sync_error: catalog.error });
    return {
      ok: false,
      environment,
      entities: [],
      provider_id: mapping.edi_provider_profile_id,
      trading_partner_id: mapping.edi_trading_partner_id,
      blockers: [catalog.error],
      last_synced_at: mapping.last_synced_at,
      message: catalog.error,
    };
  }

  const provider = await upsertEntity(supabase, {
    kind: "provider",
    collection: catalog.paths.provider,
    existingId: mapping.edi_provider_profile_id,
    existingFingerprint: mapping.provider_fingerprint,
    payload: buildProviderProfilePayload(settings!),
    idKeys: ["provider_id", "provider_profile_id"],
  });

  const mode = settings!.transport_mode === "company" ? "company" : "shared";
  const shared = mode === "shared" ? sharedTradingPartnerId() : null;

  const partner: UpsertOutcome & { fingerprint: string } = shared
    ? {
        id: shared,
        fingerprint: mapping.trading_partner_fingerprint ?? "shared",
        result: {
          kind: "trading_partner",
          action: mapping.edi_trading_partner_id === shared ? "unchanged" : "updated",
          id: shared,
          message: "Linked to RedArt's shared trading partner.",
        },
      }
    : await upsertEntity(supabase, {
        kind: "trading_partner",
        collection: catalog.paths.trading_partner,
        existingId: mapping.edi_trading_partner_id,
        existingFingerprint: mapping.trading_partner_fingerprint,
        payload: buildTradingPartnerPayload(settings!, environment),
        idKeys: ["trading_partner_id", "partner_id"],
      });

  const entities = [provider.result, partner.result];
  const failed = entities.some((e) => e.action === "failed");
  const message = summarizeCompanySync(entities, []);

  const saved = await saveCompanyMapping(supabase, companyId, {
    environment,
    trading_partner_mode: mode,
    edi_provider_profile_id: provider.id,
    edi_trading_partner_id: partner.id,
    provider_fingerprint: provider.fingerprint,
    trading_partner_fingerprint: partner.fingerprint,
    ...(failed ? { last_sync_error: message } : { last_sync_error: null, last_synced_at: new Date().toISOString() }),
  });

  return {
    ok: !failed,
    environment,
    entities,
    provider_id: saved.edi_provider_profile_id,
    trading_partner_id: saved.edi_trading_partner_id,
    blockers: [],
    last_synced_at: saved.last_synced_at,
    message,
  };
}

/* ------------------------------------------------------------------ */
/* Patient + trip + claim for ONE bill                                 */
/* ------------------------------------------------------------------ */

export type EdiClaimLinkResult = {
  claim_id: number | null;
  /** How the claim came to exist, for the audit trail shown to the biller. */
  via: "existing" | "from_trip" | "claims_endpoint" | null;
  error: string | null;
};

type EnsureContext = {
  environment: EdiEnvironment;
  providerId: string | null;
  paths: ReturnType<typeof resolveEdiEntityPaths>;
};

async function ensureLinkedEntity(
  supabase: Sb,
  companyId: string,
  args: {
    entity: "patient" | "trip";
    localId: string;
    collection: string | null;
    payload: Record<string, unknown>;
    print: string;
    environment: EdiEnvironment;
    idKeys: string[];
  },
): Promise<{ id: number | null; error: string | null }> {
  const { loadEntityLinks, saveEntityLink } = await import("@/lib/ediLedger.server");
  const links = await loadEntityLinks(
    supabase,
    companyId,
    args.entity,
    [args.localId],
    args.environment,
  );
  const existing = links.get(args.localId);

  if (!args.collection) {
    return {
      id: existing ? Number(existing.edi_entity_id) : null,
      error: `The EDI backend does not advertise a ${args.entity} endpoint.`,
    };
  }

  if (existing) {
    const id = Number(existing.edi_entity_id);
    if (existing.fingerprint === args.print) return { id, error: null };
    const patched = await fetchEdi(supabase, {
      path: entityDetailPath(args.collection, id),
      method: "PATCH",
      body: args.payload,
    });
    if (patched.ok) {
      await saveEntityLink(supabase, companyId, {
        entity_type: args.entity,
        local_id: args.localId,
        edi_entity_id: id,
        environment: args.environment,
        fingerprint: args.print,
      });
      return { id, error: null };
    }
    if (patched.status !== 404) return { id, error: patched.error };
  }

  const created = await fetchEdi(supabase, {
    path: args.collection,
    method: "POST",
    body: args.payload,
  });
  if (!created.ok) return { id: null, error: created.error };
  const id = entityIdFrom(created.data, args.idKeys);
  if (id === null)
    return { id: null, error: `The EDI backend did not return an id for the new ${args.entity}.` };

  await saveEntityLink(supabase, companyId, {
    entity_type: args.entity,
    local_id: args.localId,
    edi_entity_id: id,
    environment: args.environment,
    fingerprint: args.print,
  });
  return { id, error: null };
}

/**
 * Guarantees exactly one EDI claim for one RedArt bill.
 *
 * Preferred route (what the backend documents): patient -> NEMT trip ->
 * `/claims/from-trip/`. When the backend advertises no patient/trip entity the
 * flat `/claims/` endpoint is used instead and the reason is reported, so a
 * serializer mismatch surfaces as the backend's own message rather than a
 * silent guess.
 */
export async function ensureClaimForRecord(
  supabase: Sb,
  companyId: string,
  detail: EdiTripDetail,
  ctx: EnsureContext,
): Promise<EdiClaimLinkResult> {
  if (detail.edi.edi_claim_id) {
    return { claim_id: detail.edi.edi_claim_id, via: "existing", error: null };
  }

  const canUseTripRoute = Boolean(ctx.paths.patient && ctx.paths.trip);

  if (canUseTripRoute) {
    const patientLocalId = detail.rider_id ?? detail.trip_id;
    const patient = await ensureLinkedEntity(supabase, companyId, {
      entity: "patient",
      localId: patientLocalId,
      collection: ctx.paths.patient,
      payload: buildPatientPayload(detail.member, ctx.providerId),
      print: patientFingerprint(detail.member),
      environment: ctx.environment,
      idKeys: ["patient_id", "member_id"],
    });
    if (patient.error || patient.id === null)
      return { claim_id: null, via: null, error: patient.error ?? "Patient could not be created" };

    const trip = await ensureLinkedEntity(supabase, companyId, {
      entity: "trip",
      localId: detail.trip_id,
      collection: ctx.paths.trip,
      payload: buildNemtTripPayload(detail, {
        patientId: patient.id,
        providerId: ctx.providerId,
      }),
      print: tripFingerprint(detail),
      environment: ctx.environment,
      idKeys: ["trip_id", "nemt_trip_id"],
    });
    if (trip.error || trip.id === null)
      return { claim_id: null, via: null, error: trip.error ?? "NEMT trip could not be created" };

    const { claimCreateFromTrip } = await import("@/lib/ediApi.server");
    const created = await claimCreateFromTrip(
      supabase,
      buildClaimFromTripPayload(trip.id, detail.record_id, ctx.environment, detail),
    );
    if (!created.ok) return { claim_id: null, via: null, error: created.error };
    const claimId = entityIdFrom(created.data, ["claim_id"]);
    return claimId === null
      ? { claim_id: null, via: null, error: "The EDI backend did not return a claim id." }
      : { claim_id: claimId, via: "from_trip", error: null };
  }

  const { claimCreateDirect } = await import("@/lib/ediApi.server");
  const { buildEdiClaimPayload } = await import("@/lib/ediPayload");
  const created = await claimCreateDirect(
    supabase,
    buildEdiClaimPayload(detail, ctx.environment) as unknown as Record<string, unknown>,
  );
  if (!created.ok) return { claim_id: null, via: null, error: created.error };
  const claimId = entityIdFrom(created.data, ["claim_id"]);
  return claimId === null
    ? { claim_id: null, via: null, error: "The EDI backend did not return a claim id." }
    : { claim_id: claimId, via: "claims_endpoint", error: null };
}

