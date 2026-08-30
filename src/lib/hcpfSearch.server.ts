/**
 * READ-ONLY HCPF claim search used by the Verify HCPF claim panel.
 *
 * Contract: this module NEVER submits, enqueues, retries or mutates a claim.
 * It calls the automation worker's read-only search route, lists every claim
 * the portal returned for the member + service date, and annotates each one
 * with the RedArt bill it is already linked to (if any).
 */
import { ROBOT_BASE_URL, denverDateISO, logAudit } from "@/lib/billingHelpers";
import type { HcpfSearchResult, LinkedBill, PortalClaim } from "@/lib/hcpfSearch";

/** The read-only routes we know about, in order of preference. */
const SEARCH_PATHS = ["/search-claims", "/discover-search-claims"] as const;

export function portalDateMDY(iso: string | null | undefined): string {
  const d = denverDateISO(iso ?? undefined);
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};

/** Normalizes whatever shape the worker returns into PortalClaim rows. */
export function normalizeClaims(body: any): PortalClaim[] {
  const rows: any[] = Array.isArray(body?.claims)
    ? body.claims
    : Array.isArray(body?.results)
      ? body.results
      : Array.isArray(body?.data)
        ? body.data
        : [];
  const out: PortalClaim[] = [];
  for (const r of rows) {
    const id =
      str(r?.claim_id) ??
      str(r?.claim_number) ??
      str(r?.icn) ??
      str(r?.confirmation_number) ??
      str(r?.id);
    if (!id) continue;
    out.push({
      claim_id: id,
      status: str(r?.status) ?? str(r?.claim_status),
      service_date: str(r?.service_date) ?? str(r?.from_date) ?? str(r?.dos),
      paid_amount: num(r?.paid_amount ?? r?.paid),
      charge_amount: num(r?.charge_amount ?? r?.billed_amount ?? r?.charged),
      units: num(r?.units),
      member_id: str(r?.member_id) ?? str(r?.medicaid_id),
    });
  }
  // de-dupe by claim id, keep first
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.claim_id) ? false : (seen.add(c.claim_id), true)));
}

async function callWorker(payload: Record<string, unknown>): Promise<{
  ok: boolean;
  unavailable: boolean;
  body: any;
  detail: string;
}> {
  let lastDetail = "";
  for (const path of SEARCH_PATHS) {
    let res: Response;
    try {
      res = await fetch(`${ROBOT_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      lastDetail = `unreachable: ${e?.message ?? e}`;
      continue;
    }
    const text = await res.text().catch(() => "");
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      lastDetail = `no read-only search at ${path}`;
      continue; // try the next known route
    }
    if (!res.ok) {
      lastDetail = `search failed (HTTP ${res.status})`;
      continue;
    }
    try {
      return { ok: true, unavailable: false, body: JSON.parse(text), detail: path };
    } catch {
      lastDetail = "the automation service returned an unreadable response";
    }
  }
  return { ok: false, unavailable: true, body: null, detail: lastDetail };
}

/** Bills that already carry these confirmation numbers, scoped to the company. */
export async function findLinkedBills(
  supabase: any,
  companyId: string | null,
  claimIds: string[],
): Promise<Map<string, LinkedBill>> {
  const map = new Map<string, LinkedBill>();
  const ids = claimIds.filter(Boolean);
  if (!ids.length) return map;
  let q = supabase
    .from("billing_records")
    .select(
      `id, trip_id, status, state_confirmation_number,
       medicaid_trips(pickup_at, odometer_start, odometer_end, computed_miles,
         riders(full_name, medicaid_id))`,
    )
    .in("state_confirmation_number", ids);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  for (const r of (data ?? []) as any[]) {
    const t = r.medicaid_trips ?? {};
    map.set(String(r.state_confirmation_number), {
      billing_record_id: r.id,
      trip_id: r.trip_id ?? null,
      status: r.status ?? null,
      passenger_name: t?.riders?.full_name ?? null,
      medicaid_id: t?.riders?.medicaid_id ?? null,
      service_date: t?.pickup_at ?? null,
      odometer_start: t?.odometer_start ?? null,
      odometer_end: t?.odometer_end ?? null,
      miles: t?.computed_miles ?? null,
    });
  }
  return map;
}

/** Read-only search for one billing record. Records an audit entry either way. */
export async function searchHcpfForRecord(
  supabase: any,
  args: {
    recordId: string;
    actorId: string | null;
    companyId: string | null;
    portalId: string | null;
    providerUserId: string;
    memberId: string;
    serviceDateISO: string | null;
  },
): Promise<HcpfSearchResult> {
  const serviceDate = portalDateMDY(args.serviceDateISO);
  const base = {
    memberId: args.memberId,
    serviceDate,
  };

  if (!args.memberId) {
    return {
      ok: false,
      unavailable: false,
      message: "This trip has no Medicaid member ID on file, so the portal cannot be searched.",
      claims: [],
      member_id: "",
      service_date: serviceDate,
    };
  }

  const worker = await callWorker({
    mode: "search_claims",
    read_only: true,
    provider_id: args.providerUserId,
    company_id: args.companyId,
    portal_id: args.portalId,
    member_id: args.memberId,
    medicaid_member_id: args.memberId,
    patient_number: args.memberId,
    patient_account_number: args.memberId,
    service_date: serviceDate,
    from_date: serviceDate,
    to_date: serviceDate,
    close_session: true,
  });

  if (!worker.ok) {
    await logAudit(
      supabase,
      args.recordId,
      args.actorId,
      "hcpf_auto_search_unavailable",
      `Read-only HCPF search for member ${base.memberId} on ${serviceDate} could not run (${worker.detail}). Nothing was submitted.`,
    );
    return {
      ok: false,
      unavailable: true,
      message:
        "Automatic HCPF search is unavailable right now. Search the portal manually and record the result below.",
      claims: [],
      member_id: args.memberId,
      service_date: serviceDate,
    };
  }

  const claims = normalizeClaims(worker.body);
  const linked = await findLinkedBills(
    supabase,
    args.companyId,
    claims.map((c) => c.claim_id),
  );
  for (const c of claims) c.linked = linked.get(c.claim_id) ?? null;

  await logAudit(
    supabase,
    args.recordId,
    args.actorId,
    "hcpf_auto_search",
    `Read-only HCPF search for member ${args.memberId} on ${serviceDate} returned ${claims.length} claim(s)${
      claims.length ? `: ${claims.map((c) => c.claim_id).join(", ")}` : ""
    }. Nothing was submitted or queued.`,
  );

  return {
    ok: true,
    unavailable: false,
    message: claims.length
      ? `${claims.length} claim(s) found at HCPF for this member and service date.`
      : "No claim was found at HCPF for this member and service date.",
    claims,
    member_id: args.memberId,
    service_date: serviceDate,
  };
}

/** How many RedArt trips exist for this member on this service date. */
export async function sameDayTripCount(
  supabase: any,
  args: { companyId: string | null; riderId: string | null; serviceDateISO: string | null },
): Promise<number> {
  if (!args.riderId || !args.serviceDateISO) return 1;
  const day = denverDateISO(args.serviceDateISO);
  let q = supabase
    .from("medicaid_trips")
    .select("id, pickup_at")
    .eq("rider_id", args.riderId);
  if (args.companyId) q = q.eq("company_id", args.companyId);
  const { data } = await q;
  return ((data ?? []) as any[]).filter((t) => denverDateISO(t.pickup_at) === day).length || 1;
}
