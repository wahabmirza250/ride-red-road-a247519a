import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseAmount } from "@/lib/earnings";
import { passwordError } from "@/lib/passwordError";


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
  billers: number;
  /** Subscription seat caps. `null` means unlimited. */
  max_drivers: number | null;
  max_dispatchers: number | null;
  max_billers: number | null;
  max_admins: number | null;
  trips: number;
  claims: number;
  /** Billed total from this company's submitted claims. Never blended across tenants. */
  earnings: number;

  last_activity: string | null;
  has_portal_credentials: boolean;
  portal_last_verified: string | null;
  has_billing_rates: boolean;
  twilio_phone: string | null;
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
      db
        .from("companies")
        .select(
          "id, name, url_slug, status, logo_url, created_at, twilio_phone, max_drivers, max_dispatchers, max_billers, max_admins",
        )
        .order("created_at"),
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

    /** Per-tenant billed total; the owner list keeps every company separate. */
    const companyEarnings = (rows: typeof med) =>
      Math.round(
        rows
          .filter(isClaim)
          .reduce((sum, m) => {
            const captured = (m.robot_captured_claim ?? null) as
              | { total_charged_amount?: unknown }
              | null;
            return sum + parseAmount(captured?.total_charged_amount);
          }, 0) * 100,
      ) / 100;


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
          billers: countRole(c.id, "billing"),
          max_drivers: (c as { max_drivers?: number | null }).max_drivers ?? null,
          max_dispatchers: (c as { max_dispatchers?: number | null }).max_dispatchers ?? null,
          max_billers: (c as { max_billers?: number | null }).max_billers ?? null,
          max_admins: (c as { max_admins?: number | null }).max_admins ?? null,
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
          twilio_phone: (c as { twilio_phone?: string | null }).twilio_phone ?? null,
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
    (input: {
      name: string;
      url_slug: string;
      logo_base64?: string | null;
      logo_ext?: string | null;
      max_drivers?: number | null;
      max_dispatchers?: number | null;
      max_billers?: number | null;
      max_admins?: number | null;
    }) => {
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
        ...normalizeLimits(input),
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
      .insert({
        name: data.name,
        url_slug: data.url_slug,
        status: "active",
        max_drivers: data.max_drivers,
        max_dispatchers: data.max_dispatchers,
        max_billers: data.max_billers,
        max_admins: data.max_admins,
      })
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

/** Seat caps: blank/0/negative means unlimited. */
function normalizeLimits(input: {
  max_drivers?: number | null;
  max_dispatchers?: number | null;
  max_billers?: number | null;
  max_admins?: number | null;
}) {
  const one = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  return {
    max_drivers: one(input?.max_drivers),
    max_dispatchers: one(input?.max_dispatchers),
    max_billers: one(input?.max_billers),
    max_admins: one(input?.max_admins),
  };
}

/** Owner-only: update a company's subscription seat caps. */
export const setCompanyLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id: string;
      max_drivers?: number | null;
      max_dispatchers?: number | null;
      max_billers?: number | null;
      max_admins?: number | null;
    }) => {
      if (!input?.company_id) throw new Error("company_id required");
      return { company_id: input.company_id, ...normalizeLimits(input) };
    },
  )
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { company_id, ...limits } = data;
    const { error } = await db.from("companies").update(limits).eq("id", company_id);
    if (error) throw new Error(error.message);
    return { ok: true, ...limits };
  });

/** Owner-only: replace or remove a company's logo (shown across their apps). */
export const setCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string; logo_base64?: string | null; logo_ext?: string | null }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return {
      company_id: input.company_id,
      logo_base64: input.logo_base64 ?? null,
      logo_ext: (input.logo_ext ?? "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png",
    };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    if (!data.logo_base64) {
      await db.from("companies").update({ logo_url: null }).eq("id", data.company_id);
      return { ok: true, logo_signed_url: null as string | null };
    }

    const bytes = Buffer.from(data.logo_base64, "base64");
    if (bytes.length > 3_000_000) throw new Error("Logo must be under 3 MB");
    const path = `${data.company_id}/logo-${Date.now()}.${data.logo_ext}`;
    const { error: upErr } = await db.storage.from("company-logos").upload(path, bytes, {
      upsert: true,
      contentType: `image/${data.logo_ext === "svg" ? "svg+xml" : data.logo_ext}`,
    });
    if (upErr) throw new Error(upErr.message);
    const { error } = await db.from("companies").update({ logo_url: path }).eq("id", data.company_id);
    if (error) throw new Error(error.message);

    const { data: signed } = await db.storage.from("company-logos").createSignedUrl(path, 60 * 60);
    return { ok: true, logo_signed_url: signed?.signedUrl ?? null };
  });

/**
 * Maps a Twilio number to a tenant. The inbound SMS webhook resolves the owning
 * company from this value, so it must stay unique across companies.
 */
export const setCompanyTwilioPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string; twilio_phone: string | null }) => {
    if (!input?.company_id) throw new Error("company_id required");
    const raw = (input.twilio_phone ?? "").trim();
    if (!raw) return { company_id: input.company_id, twilio_phone: null };
    const digits = raw.replace(/\D/g, "");
    const e164 =
      raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
    if (!/^\+\d{8,15}$/.test(e164)) throw new Error("Enter a valid phone number");
    return { company_id: input.company_id, twilio_phone: e164 };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { error } = await db
      .from("companies")
      .update({ twilio_phone: data.twilio_phone })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true, twilio_phone: data.twilio_phone };
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

/* ------------------------------------------------------------------ *
 * "View as company" — platform-owner only.
 *
 * Tenancy is derived from `profiles.company_id` (see current_user_company_id()).
 * Viewing as a company temporarily repoints the OWNER'S OWN profile at that
 * company, so every RLS-scoped read returns that tenant's real data with no
 * policy weakened anywhere. The owner's home company is stashed in auth user
 * metadata (server-side, never client-supplied) so exiting always restores it.
 * A company admin calling these gets "Forbidden" from `gate()`.
 * ------------------------------------------------------------------ */

const VIEW_AS_HOME = "owner_home_company_id";

export const getViewAsState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as { userId: string }).userId;
    const { isPlatformOwner } = await import("@/lib/company.server");
    if (!(await isPlatformOwner(userId))) return { viewing: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const home = (u.user?.user_metadata as Record<string, unknown> | undefined)?.[VIEW_AS_HOME];
    if (!home || typeof home !== "string") return { viewing: false as const };

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!prof?.company_id) return { viewing: false as const };

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, url_slug")
      .eq("id", prof.company_id)
      .maybeSingle();
    if (!company) return { viewing: false as const };

    return { viewing: true as const, name: company.name, slug: company.url_slug };
  });

export const startViewAsCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return { company_id: input.company_id };
  })
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const db = await gate(userId);

    const { data: company } = await db
      .from("companies")
      .select("id, name, url_slug")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!company) throw new Error("Company not found");

    const { data: u } = await db.auth.admin.getUserById(userId);
    const meta = (u.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (!meta[VIEW_AS_HOME]) {
      const { data: prof } = await db.from("profiles").select("company_id").eq("id", userId).maybeSingle();
      await db.auth.admin.updateUserById(userId, {
        user_metadata: { ...meta, [VIEW_AS_HOME]: prof?.company_id ?? null },
      });
    }

    const { error } = await db.from("profiles").update({ company_id: company.id }).eq("id", userId);
    if (error) throw new Error(error.message);

    return { ok: true, slug: company.url_slug, name: company.name };
  });

export const stopViewAsCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as { userId: string }).userId;
    const db = await gate(userId);

    const { data: u } = await db.auth.admin.getUserById(userId);
    const meta = (u.user?.user_metadata ?? {}) as Record<string, unknown>;
    const home = typeof meta[VIEW_AS_HOME] === "string" ? (meta[VIEW_AS_HOME] as string) : null;

    await db.from("profiles").update({ company_id: home }).eq("id", userId);
    const next = { ...meta };
    delete next[VIEW_AS_HOME];
    await db.auth.admin.updateUserById(userId, { user_metadata: { ...next, [VIEW_AS_HOME]: null } });

    return { ok: true };
  });

/* ------------------------------------------------------------------ *
 * Staff management (platform owner only)
 *
 * Lets the owner create, remove and reset passwords for staff accounts of
 * ANY company. Roles stay in `user_roles`; tenancy stays on `profiles`.
 * ------------------------------------------------------------------ */

export type StaffRole = "admin" | "dispatch" | "billing" | "admin_biller" | "driver";
const STAFF_ROLES: StaffRole[] = ["admin", "dispatch", "billing", "admin_biller", "driver"];

export type CompanyStaff = {
  id: string;
  email: string | null;
  name: string;
  roles: StaffRole[];
  is_active: boolean;
  created_at: string;
};

export const listCompanyStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { company_id: string }) => {
    if (!input?.company_id) throw new Error("company_id required");
    return { company_id: input.company_id };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    const { data: roleRows } = await db
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", data.company_id)
      .in("role", STAFF_ROLES);

    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (!ids.length) return { staff: [] as CompanyStaff[] };

    const { data: profs } = await db
      .from("profiles")
      .select("id, email, first_name, last_name, is_active, created_at")
      .in("id", ids);

    const staff: CompanyStaff[] = (profs ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || (p.email ?? "Unnamed"),
      roles: (roleRows ?? [])
        .filter((r) => r.user_id === p.id)
        .map((r) => r.role as StaffRole),
      is_active: p.is_active,
      created_at: p.created_at,
    }));
    staff.sort((a, b) => a.name.localeCompare(b.name));
    return { staff };
  });

export const createCompanyStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id: string;
      role: StaffRole;
      email: string;
      password: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
    }) => {
      const email = String(input?.email ?? "").trim().toLowerCase();
      if (!input?.company_id) throw new Error("company_id required");
      if (!STAFF_ROLES.includes(input?.role)) throw new Error("Invalid role");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");
      if (String(input?.password ?? "").length < 8) throw new Error("Password must be at least 8 characters");
      return {
        company_id: input.company_id,
        role: input.role,
        email,
        password: input.password,
        first_name: (input.first_name ?? "").trim(),
        last_name: (input.last_name ?? "").trim(),
        phone: (input.phone ?? "").trim(),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);

    const { data: company } = await db
      .from("companies")
      .select("id, max_drivers, max_dispatchers, max_billers, max_admins")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!company) throw new Error("Company not found");

    // Subscription seat caps — enforced server-side, never trusted from the UI.
    const capField = {
      driver: "max_drivers",
      dispatch: "max_dispatchers",
      billing: "max_billers",
      admin_biller: "max_billers",
      admin: "max_admins",
    }[data.role] as "max_drivers" | "max_dispatchers" | "max_billers" | "max_admins";
    const cap = (company as unknown as Record<string, number | null>)[capField];
    if (cap != null) {
      const { data: existingRoles } = await db
        .from("user_roles")
        .select("user_id")
        .eq("company_id", data.company_id)
        .eq("role", data.role);
      const used = new Set((existingRoles ?? []).map((r) => r.user_id)).size;
      if (used >= cap) {
        throw new Error(
          `Seat limit reached: this company's plan allows ${cap} ${data.role} account${cap === 1 ? "" : "s"} (${used} in use). Raise the limit first.`,
        );
      }
    }

    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        company_id: data.company_id,
      },
    });
    if (error || !created.user) throw new Error(passwordError(error?.message) ?? "Could not create the account");

    const uid = created.user.id;
    await db.from("profiles").update({ company_id: data.company_id }).eq("id", uid);
    await db
      .from("user_roles")
      .upsert({ user_id: uid, role: data.role, company_id: data.company_id }, { onConflict: "user_id,role" });
    // Staff accounts hold exactly one role; the signup trigger's passenger
    // role/record is not meaningful for them.
    await db.from("user_roles").delete().eq("user_id", uid).neq("role", data.role);
    await db.from("passengers").delete().eq("user_id", uid);

    if (data.role === "driver") {
      await db
        .from("drivers")
        .upsert({ user_id: uid, status: "offline", company_id: data.company_id }, { onConflict: "user_id" });
    }

    return { ok: true, user_id: uid, email: data.email, role: data.role };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; password: string }) => {
    if (!input?.user_id) throw new Error("user_id required");
    if (String(input?.password ?? "").length < 8) throw new Error("Password must be at least 8 characters");
    return { user_id: input.user_id, password: input.password };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { error } = await db.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(passwordError(error.message) ?? "Could not reset the password");
    return { ok: true };
  });

/** Removes a staff account entirely (auth user + roles + profile records). */
export const removeCompanyStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id required");
    return { user_id: input.user_id };
  })
  .handler(async ({ data, context }) => {
    const ownerId = (context as { userId: string }).userId;
    if (data.user_id === ownerId) throw new Error("You cannot remove your own account");
    const db = await gate(ownerId);

    const { data: isOwner } = await db
      .from("user_roles")
      .select("id")
      .eq("user_id", data.user_id)
      .eq("role", "platform_owner")
      .maybeSingle();
    if (isOwner) throw new Error("Platform owner accounts cannot be removed here");

    await db.from("passengers").delete().eq("user_id", data.user_id);
    await db.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await db.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ *
 * Subscriptions — what each company pays the platform owner.
 * ------------------------------------------------------------------ */

export type CompanySubscription = {
  company_id: string;
  plan_name: string;
  monthly_price: number;
  status: string;
  started_on: string;
  renews_on: string | null;
  notes: string | null;
};

export type SubscriptionPayment = {
  id: string;
  company_id: string;
  amount: number;
  paid_on: string;
  period_start: string | null;
  period_end: string | null;
  method: string;
  reference: string | null;
  notes: string | null;
};

export const getSubscriptionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await gate((context as { userId: string }).userId);

    const [companiesRes, subsRes, paysRes] = await Promise.all([
      db.from("companies").select("id, name, url_slug, status").order("name"),
      db.from("company_subscriptions").select("*"),
      db.from("subscription_payments").select("*").order("paid_on", { ascending: false }),
    ]);

    const companies = companiesRes.data ?? [];
    const subs = subsRes.data ?? [];
    const pays = paysRes.data ?? [];

    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const yearKey = String(now.getUTCFullYear());

    const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

    const rows = companies.map((c) => {
      const sub = subs.find((s) => s.company_id === c.id) ?? null;
      const cPays = pays.filter((p) => p.company_id === c.id);
      const collected = cPays.reduce((s, p) => s + num(p.amount), 0);
      return {
        company_id: c.id,
        company_name: c.name,
        url_slug: c.url_slug,
        company_status: c.status,
        plan_name: sub?.plan_name ?? null,
        monthly_price: sub ? num(sub.monthly_price) : 0,
        status: sub?.status ?? "none",
        started_on: sub?.started_on ?? null,
        renews_on: sub?.renews_on ?? null,
        notes: sub?.notes ?? null,
        collected: Math.round(collected * 100) / 100,
        last_payment_on: cPays[0]?.paid_on ?? null,
        payments: cPays.map((p) => ({
          id: p.id,
          company_id: p.company_id,
          amount: num(p.amount),
          paid_on: p.paid_on,
          period_start: p.period_start,
          period_end: p.period_end,
          method: p.method,
          reference: p.reference,
          notes: p.notes,
        })) as SubscriptionPayment[],
      };
    });

    const activeMrr = rows
      .filter((r) => r.status === "active" || r.status === "trial")
      .reduce((s, r) => s + (r.status === "active" ? r.monthly_price : 0), 0);

    return {
      rows,
      totals: {
        mrr: Math.round(activeMrr * 100) / 100,
        arr: Math.round(activeMrr * 12 * 100) / 100,
        collected_all_time: Math.round(pays.reduce((s, p) => s + num(p.amount), 0) * 100) / 100,
        collected_this_month:
          Math.round(
            pays
              .filter((p) => String(p.paid_on ?? "").startsWith(monthKey))
              .reduce((s, p) => s + num(p.amount), 0) * 100,
          ) / 100,
        collected_this_year:
          Math.round(
            pays
              .filter((p) => String(p.paid_on ?? "").startsWith(yearKey))
              .reduce((s, p) => s + num(p.amount), 0) * 100,
          ) / 100,
        paying_companies: rows.filter((r) => r.status === "active").length,
      },
    };
  });

export const upsertCompanySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id: string;
      plan_name: string;
      monthly_price: number | string;
      status: string;
      started_on?: string | null;
      renews_on?: string | null;
      notes?: string | null;
    }) => {
      if (!input?.company_id) throw new Error("company_id required");
      const price = Number(input?.monthly_price ?? 0);
      if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid monthly price");
      const status = String(input?.status ?? "trial");
      if (!["trial", "active", "past_due", "cancelled"].includes(status)) throw new Error("Invalid status");
      return {
        company_id: input.company_id,
        plan_name: String(input.plan_name ?? "Standard").trim().slice(0, 60) || "Standard",
        monthly_price: Math.round(price * 100) / 100,
        status,
        started_on: input.started_on || null,
        renews_on: input.renews_on || null,
        notes: (input.notes ?? "").trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { error } = await db.from("company_subscriptions").upsert(
      {
        company_id: data.company_id,
        plan_name: data.plan_name,
        monthly_price: data.monthly_price,
        status: data.status,
        renews_on: data.renews_on,
        notes: data.notes,
        ...(data.started_on ? { started_on: data.started_on } : {}),
      },
      { onConflict: "company_id" },
    );

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recordSubscriptionPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      company_id: string;
      amount: number | string;
      paid_on?: string | null;
      period_start?: string | null;
      period_end?: string | null;
      method?: string | null;
      reference?: string | null;
      notes?: string | null;
    }) => {
      if (!input?.company_id) throw new Error("company_id required");
      const amount = Number(input?.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount");
      return {
        company_id: input.company_id,
        amount: Math.round(amount * 100) / 100,
        paid_on: input.paid_on || new Date().toISOString().slice(0, 10),
        period_start: input.period_start || null,
        period_end: input.period_end || null,
        method: (input.method ?? "other").trim() || "other",
        reference: (input.reference ?? "").trim() || null,
        notes: (input.notes ?? "").trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const db = await gate(userId);
    const { error } = await db.from("subscription_payments").insert({ ...data, recorded_by: userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSubscriptionPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payment_id: string }) => {
    if (!input?.payment_id) throw new Error("payment_id required");
    return { payment_id: input.payment_id };
  })
  .handler(async ({ data, context }) => {
    const db = await gate((context as { userId: string }).userId);
    const { error } = await db.from("subscription_payments").delete().eq("id", data.payment_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
