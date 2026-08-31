/**
 * DRIVER PICKER OPTIONS (pure).
 *
 * public.drivers has NO `full_name` column — selecting one makes PostgREST
 * fail the whole query. The display name is derived from the linked profile
 * (first/last name), with safe fallbacks so a driver row without a profile
 * still shows up in the picker.
 */
export type DriverRow = { id: string; user_id?: string | null; unit_number?: string | null };
export type ProfileRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};
export type DriverOption = { id: string; user_id: string | null; name: string };

export function profileDisplayName(p: ProfileRow | undefined | null): string {
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  return String(p?.email ?? "").trim();
}

export function deriveDriverOptions(drivers: DriverRow[], profiles: ProfileRow[]): DriverOption[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return (drivers ?? [])
    .map((d) => {
      const name =
        profileDisplayName(d.user_id ? byId.get(d.user_id) : null) ||
        (d.unit_number ? `Unit ${d.unit_number}` : "") ||
        `Driver ${String(d.id).slice(0, 8)}`;
      return { id: d.id, user_id: d.user_id ?? null, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
