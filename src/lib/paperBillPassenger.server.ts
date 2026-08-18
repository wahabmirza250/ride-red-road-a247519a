/**
 * Paper bill → unified Passenger database sync.
 *
 * A paper bill resolves to a `riders` row (the billing-side member record).
 * The rest of the app — the admin Passengers list, dispatch, booking — reads
 * `passengers`. Without this bridge a member billed from paper never appears
 * in that unified list. Matching is by Medicaid ID first (the authoritative
 * key, unique per company), then by name inside the same company.
 */
type Sb = import("@supabase/supabase-js").SupabaseClient;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "Unknown", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

export async function syncPassengerFromPaperBill(args: {
  supabaseAdmin: Sb;
  companyId: string;
  fullName: string;
  medicaidId: string;
  dob?: string | null;
  phone?: string | null;
}): Promise<{ passenger_id: string | null; created: boolean }> {
  const { supabaseAdmin, companyId } = args;
  const fullName = (args.fullName ?? "").trim();
  const medicaidId = (args.medicaidId ?? "").trim();
  if (!medicaidId && !fullName) return { passenger_id: null, created: false };

  // 1. Match on Medicaid ID within the company.
  if (medicaidId) {
    const { data: byId } = await supabaseAdmin
      .from("passengers")
      .select("id, date_of_birth, phone")
      .eq("company_id", companyId)
      .eq("medicaid_id", medicaidId)
      .maybeSingle();
    if (byId?.id) {
      // Fill in blanks we learned from the paper form; never overwrite.
      const patch: Record<string, unknown> = {};
      if (!byId.date_of_birth && args.dob) patch["date_of_birth"] = args.dob;
      if (!byId.phone && args.phone) patch["phone"] = args.phone;
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("passengers").update(patch).eq("id", byId.id);
      }
      return { passenger_id: byId.id, created: false };
    }
  }

  // 2. Match on name within the company (member billed before the ID existed).
  if (fullName) {
    const { data: candidates } = await supabaseAdmin
      .from("passengers")
      .select("id, first_name, last_name, medicaid_id")
      .eq("company_id", companyId)
      .limit(1000);
    const target = norm(fullName);
    const hit = (candidates ?? []).find(
      (p: { first_name: string; last_name: string }) =>
        norm(`${p.first_name} ${p.last_name}`) === target,
    ) as { id: string; medicaid_id: string | null } | undefined;
    if (hit) {
      if (medicaidId && !hit.medicaid_id) {
        await supabaseAdmin
          .from("passengers")
          .update({ medicaid_id: medicaidId })
          .eq("id", hit.id);
      }
      return { passenger_id: hit.id, created: false };
    }
  }

  // 3. Create the passenger so they show up in the unified list going forward.
  const { first_name, last_name } = splitName(fullName || medicaidId);
  const { data: created, error } = await supabaseAdmin
    .from("passengers")
    .insert({
      first_name,
      last_name,
      medicaid_id: medicaidId || null,
      date_of_birth: args.dob || null,
      phone: args.phone || null,
      company_id: companyId,
      notes: "Created automatically from a paper bill.",
    })
    .select("id")
    .single();
  if (error) {
    // Race with a concurrent bill for the same member: reuse the winner.
    if (medicaidId) {
      const { data: dupe } = await supabaseAdmin
        .from("passengers")
        .select("id")
        .eq("company_id", companyId)
        .eq("medicaid_id", medicaidId)
        .maybeSingle();
      if (dupe?.id) return { passenger_id: dupe.id, created: false };
    }
    return { passenger_id: null, created: false };
  }
  return { passenger_id: created.id, created: true };
}
