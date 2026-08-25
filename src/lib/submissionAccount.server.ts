/**
 * HCPF PORTAL ACCOUNT KEYS (server-only).
 *
 * The real scarce resource is not a company row and not a biller — it is the
 * ONE HCPF portal login a company owns. Two browser sessions on the same login
 * fight each other (postbacks, lost payer selection, 480s timeouts) and can
 * produce duplicate claims, so every queue lock is scoped to the *account*:
 *
 *     acct:<portal id>:<login email>      when a portal credential exists
 *     company:<company id>                fallback (one implicit account)
 *
 * Consequences that must stay true:
 *   - Many billers in one company => one shared account queue, single flight.
 *   - Different companies => different account keys => fully parallel.
 *   - If a company ever configures a second portal login, its bills split into
 *     two independent queues with no code change.
 */

const cache = new Map<string, { key: string; at: number }>();
const TTL_MS = 60_000;

export function fallbackAccountKey(companyId: string | null | undefined): string {
  return `company:${companyId ?? "none"}`;
}

export function accountKeyFromCredential(portalId: string, loginEmail: string | null | undefined): string {
  const email = String(loginEmail ?? "").trim().toLowerCase();
  return `acct:${String(portalId).trim().toLowerCase()}:${email || "no-login"}`;
}

/**
 * Resolve the account key a company's submissions must serialize on. Never
 * throws and never returns null: an unconfigured company still gets a stable
 * key so its bills queue safely instead of running unserialized.
 */
export async function resolveAccountKey(
  supabase: any,
  companyId: string | null | undefined,
): Promise<string> {
  const fallback = fallbackAccountKey(companyId);
  if (!companyId) return fallback;

  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.key;

  let key = fallback;
  try {
    const { data: settings } = await supabase
      .from("billing_settings")
      .select("default_portal_id")
      .eq("company_id", companyId)
      .maybeSingle();

    let q = supabase
      .from("state_portal_credentials")
      .select("portal_id, login_email, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(5);
    if (settings?.default_portal_id) q = q.eq("portal_id", settings.default_portal_id);
    const { data: creds } = await q;
    const cred = (creds ?? [])[0];
    if (cred?.portal_id) key = accountKeyFromCredential(cred.portal_id, cred.login_email);
  } catch {
    /* credential lookup is an optimisation — the fallback key is still safe */
  }

  cache.set(companyId, { key, at: Date.now() });
  return key;
}

/** Test/ops helper: forget cached account keys. */
export function clearAccountKeyCache(): void {
  cache.clear();
}
