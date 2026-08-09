import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Platform-owner (super-admin) server functions.
 *
 * EVERY handler starts with `requirePlatformOwner(userId)` — the caller's
 * identity comes from the validated bearer token, never from the client.
 * A company admin calling these directly gets "Forbidden".
 */

const ROBOT_BASE_URL = "https://redart-hcpf-automation-production.up.railway.app";

/** Slugs that collide with app routes and can never become a company slug. */
const RESERVED_SLUGS = new Set([
  "driver", "dispatch", "passenger", "dashboard", "live-ops", "planner", "trips",
  "medicaid-billing", "medicaid-trips", "schedules", "drivers", "payroll",
  "passengers", "reports", "incidents", "team", "events", "messages",
  "news-feed", "news", "games", "rewards-settings",
  "owner", "auth", "api", "track", "ride", "admin", "assets", "public",
]);

async function gate(userId: string) {
  const { requirePlatformOwner } = await import("@/lib/company.server");
  await requirePlatformOwner(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type OwnerCompany = {
  id: string;
  name: string;
  url_slug: string;
  status: string;
  logo_signed_url: string | null;
  created_at: string;
  drivers: number;
  passengers: number;
  dispatchers: number;
  admins: number;
  trips: number;
  claims: number;
  /** Billed total from this company's submitted claims. Never blended across tenants. */
  earnings: number;

  last_activity: string | null;
  has_portal_credentials: boolean;
  portal_last_verified: string | null;
  has_billing_rates: boolean;
};

export const isPlatformOwnerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isPlatformOwner } = await import("@/lib/company.server");
    return { owner: await isPlatformOwner((context as { userId: string }).userId) };
  });

export const getOwnerOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await gate((context as { userId: string }).userId);

    const [companiesRes, rolesRes, tripsRes, medRes, credRes, ratesRes] = await Promise.all([
      db.from("companies").select("id, name, url_slug, status, logo_url, created_at").order("created_at"),
      db.from("user_roles").select("user_id, role, company_id"),
      db.from("trips").select("company_id, updated_at, created_at"),
      db
        .from("medicaid_trips")
        .select(
          "company_id, updated_at, submitted_at, portal_submitted_at, robot_captured_claim, robot_confirmation_number, submitted_confirmation, status",
        ),

      db.from("state_portal_credentials").select("company_id, last_used_at, updated_at"),
      db.from("billing_rate_settings").select("company_id"),
    ]);

    const companies = companiesRes.data ?? [];
    const roles = rolesRes.data ?? [];
    const trips = tripsRes.data ?? [];
    const med = medRes.data ?? [];
    const creds = credRes.data ?? [];
    const rates = ratesRes.data ?? [];

    const countRole = (cid: string, role: string) =>
      new Set(roles.filter((r) => r.company_id === cid && r.role === role).map((r) => r.user_id)).size;

    const isClaim = (m: (typeof med)[number]) =>
      Boolean(m.robot_confirmation_number || m.submitted_confirmation || m.status === "submitted");

    const rows: OwnerCompany[] = await Promise.all(
      companies.map(async (c) => {
        const cTrips = trips.filter((t) => t.company_id === c.id);
        const cMed = med.filter((m) => m.company_id === c.id);
        const cCred = creds.filter((x) => x.company_id === c.id);

        const stamps = [
          ...cTrips.map((t) => t.updated_at ?? t.created_at),
          ...cMed.map((m) => m.updated_at),
        ].filter(Boolean) as string[];
        stamps.sort();

        let logo_signed_url: string | null = null;
        if (c.logo_url) {
          if (/^https?:\/\//i.test(c.logo_url)) {
            logo_signed_url = c.logo_url;
          } else {
            const { data: signed } = await db.storage
              .from("company-logos")
              .createSignedUrl(c.logo_url, 60 * 60);
            logo_signed_url = signed?.signedUrl ?? null;
          }
        }

        return {
          id: c.id,
          name: c.name,
          url_slug: c.url_slug,
          status: c.status,
          created_at: c.created_at,
          logo_signed_url,
          drivers: countRole(c.id, "driver"),
          passengers: countRole(c.id, "passenger"),
          dispatchers: countRole(c.id, "dispatch"),
          admins: countRole(c.id, "admin"),
          trips: cTrips.length,
          claims: cMed.filter(isClaim).length,
          earnings: companyEarnings(cMed),

          last_activity: stamps.length ? stamps[stamps.length - 1]! : null,
          has_portal_credentials: cCred.length > 0,
          portal_last_verified:
            cCred
              .map((x) => x.last_used_at ?? x.updated_at)
              .filter(Boolean)
              .sort()
              .slice(-1)[0] ?? null,
          has_billing_rates: rates.some((r) => r.company_id === c.id),
        };
      }),
    );

    return {
      companies: rows,
      totals: {
        companies: companies.length,
        drivers: new Set(roles.filter((r) => r.role === "driver").map((r) => r.user_id)).size,
        passengers: new Set(roles.filter((r) => r.role === "passenger").map((r) => r.user_id)).size,
        dispatchers: new Set(roles.filter((r) => r.role === "dispatch").map((r) => r.user_id)).size,
        trips: trips.length,
        claims: med.filter(isClaim).length,
      },
    };
  });

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { name: string; url_slug: string; logo_base64?: string | null; logo_ext?: string | null }) => {
      const name = String(input?.name ?? "").trim();
      const slug = String(input?.url_slug ?? "").trim().toLowerCase();
      if (name.length < 2 || name.length > 80) throw new Error("Company name is required");
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
        throw new Error("URL slug must be 2-40 characters: lowercase letters, numbers and dashes");
      }
      return {
        name,
        url_slug: slug,
        logo_base64: input.logo_base64 ?? null,
        logo_ext: (input.logo_ext ?? "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png",
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    if (RESERVED_SLUGS.has(data.url_slug)) {
      throw new Error(`"${data.url_slug}" is a reserved URL — pick another slug`);
    }

    const { data: existing } = await db
      .from("companies")
      .select("id")
      .eq("url_slug", data.url_slug)
      .maybeSingle();
    if (existing) throw new Error(`The slug "${data.url_slug}" is already taken`);

    const { data: created, error } = await db
      .from("companies")
      .insert({ name: data.name, url_slug: data.url_slug, status: "active" })
      .select("id, name, url_slug, status")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not create company");

    if (data.logo_base64) {
      const bytes = Buffer.from(data.logo_base64, "base64");
      if (bytes.length > 3_000_000) throw new Error("Logo must be under 3 MB");
      const path = `${created.id}/logo.${data.logo_ext}`;
      const { error: upErr } = await db.storage
        .from("company-logos")
        .upload(path, bytes, { upsert: true, contentType: `image/${data.logo_ext === "svg" ? "svg+xml" : data.logo_ext}` });
      if (!upErr) {
        await db.from("companies").update({ logo_url: path }).eq("id", created.id);
      }
    }

    return created;
  });

export const setCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string; status: "active" | "suspended" }) => {
    if (!input?.company_id) throw new Error("company_id required");
    if (input.status !== "active" && input.status !== "suspended") throw new Error("Invalid status");
    return { company_id: input.company_id, status: input.status };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { error } = await db
      .from("companies")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createCompanyAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id: string;
      email: string;
      password: string;
      first_name?: string;
      last_name?: string;
    }) => {
      const email = String(input?.email ?? "").trim().toLowerCase();
      if (!input?.company_id) throw new Error("company_id required");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");
      if (String(input?.password ?? "").length < 8) throw new Error("Password must be at least 8 characters");
      return {
        company_id: input.company_id,
        email,
        password: input.password,
        first_name: (input.first_name ?? "").trim(),
        last_name: (input.last_name ?? "").trim(),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    const { data: company } = await db
      .from("companies")
      .select("id, name")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!company) throw new Error("Company not found");

    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        company_id: data.company_id,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create the admin account");

    const uid = created.user.id;
    await db.from("profiles").update({ company_id: data.company_id }).eq("id", uid);
    await db
      .from("user_roles")
      .upsert({ user_id: uid, role: "admin", company_id: data.company_id }, { onConflict: "user_id,role" });
    await db.from("user_roles").delete().eq("user_id", uid).neq("role", "admin");
    // The signup trigger creates a passenger record for every new auth user.
    await db.from("passengers").delete().eq("user_id", uid);

    return { ok: true, user_id: uid, email: data.email };
  });

export const listCompanyAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { data: roleRows } = await db
      .from("user_roles")
      .select("user_id")
      .eq("company_id", data.company_id)
      .eq("role", "admin");
    const ids = (roleRows ?? []).map((r) => r.user_id);
    if (!ids.length) return { admins: [] as { id: string; email: string | null; name: string }[] };
    const { data: profs } = await db
      .from("profiles")
      .select("id, email, first_name, last_name")
      .in("id", ids);
    return {
      admins: (profs ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      })),
    };
  });

/** Read-only HCPF portal reachability probe for one company. */
export const runPortalHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    const { data: cred } = await db
      .from("state_portal_credentials")
      .select("portal_id")
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!cred) {
      return {
        ok: false,
        account_active: false,
        detail: "This company has no HCPF portal credentials configured yet.",
      };
    }

    // The robot resolves rates/credentials by provider (the admin who set them
    // up). Prefer the user who owns this company's billing rates.
    const { data: rate } = await db
      .from("billing_rate_settings")
      .select("provider_id")
      .eq("company_id", data.company_id)
      .limit(1)
      .maybeSingle();
    let providerId: string | null = rate?.provider_id ?? null;
    if (!providerId) {
      const { data: adminRole } = await db
        .from("user_roles")
        .select("user_id")
        .eq("company_id", data.company_id)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      providerId = adminRole?.user_id ?? null;
    }
    if (!providerId) {
      return { ok: false, account_active: false, detail: "No provider account found for this company." };
    }

    const { data: keyRow } = await db
      .from("robot_api_keys")
      .select("api_key")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!keyRow?.api_key) {
      return { ok: false, account_active: false, detail: "No active robot API key is configured." };
    }

    try {
      const res = await fetch(
        `${ROBOT_BASE_URL}/health-check-portal?provider_id=${encodeURIComponent(providerId)}&company_id=${encodeURIComponent(data.company_id)}`,
        { headers: { "X-Robot-Api-Key": keyRow.api_key } },
      );
      const body = (await res.json().catch(() => ({}))) as {
        account_active?: boolean;
        checked_at?: string;
        detail?: { status?: string; reason?: string };
      };
      if (!res.ok) {
        return { ok: false, account_active: false, detail: `Health check failed (HTTP ${res.status})` };
      }
      const reason = body.detail?.reason ?? body.detail?.status ?? null;
      return {
        ok: true,
        account_active: Boolean(body.account_active),
        checked_at: body.checked_at ?? new Date().toISOString(),
        status: body.detail?.status ?? null,
        detail: body.account_active
          ? "Portal login succeeded and the account is active."
          : (reason ?? "The portal account did not respond as active."),
      };
    } catch (e) {
      console.error("[owner health-check]", e);
      return { ok: false, account_active: false, detail: "Could not reach the automation service." };
    }
  });

/** Hard delete of a company with no operational history (test cleanup). */
export const deleteCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    const { count: tripCount } = await db
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.company_id);
    const { count: medCount } = await db
      .from("medicaid_trips")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.company_id);
    if ((tripCount ?? 0) > 0 || (medCount ?? 0) > 0) {
      throw new Error("This company has trip history and cannot be deleted. Suspend it instead.");
    }

    const { data: members } = await db
      .from("profiles")
      .select("id")
      .eq("company_id", data.company_id);
    for (const m of members ?? []) {
      await db.from("passengers").delete().eq("user_id", m.id);
      await db.from("user_roles").delete().eq("user_id", m.id);
      await db.auth.admin.deleteUser(m.id).catch(() => undefined);
    }
    await db.from("state_portal_credentials").delete().eq("company_id", data.company_id);
    await db.from("billing_rate_settings").delete().eq("company_id", data.company_id);
    const { error } = await db.from("companies").delete().eq("id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
