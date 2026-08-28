/**
 * CANONICAL DRIVER RESOLUTION (pure).
 *
 * After an admin merges a duplicate driver profile, the duplicate row is
 * retired — never deleted — and points at the driver that was kept through
 * `drivers.merged_into`. Everything that groups work "per driver" (payroll,
 * claim → driver pay mapping, the drivers list) must therefore resolve a
 * driver id to its canonical record first, or the same person shows up twice.
 */

export type MergeableDriver = {
  id: string;
  merged_into?: string | null;
};

/** Follow the merge chain to the surviving driver id (cycle-safe). */
export function canonicalDriverId(
  id: string,
  drivers: readonly MergeableDriver[] | Map<string, MergeableDriver>,
): string {
  const byId =
    drivers instanceof Map ? drivers : new Map(drivers.map((d) => [d.id, d] as const));
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    const next = byId.get(cur)?.merged_into ?? null;
    if (!next || next === cur || seen.has(next)) return cur;
    seen.add(cur);
    cur = next;
  }
}

/** Map every driver id (including retired duplicates) to its canonical id. */
export function canonicalDriverMap(drivers: readonly MergeableDriver[]): Map<string, string> {
  const byId = new Map(drivers.map((d) => [d.id, d] as const));
  return new Map(drivers.map((d) => [d.id, canonicalDriverId(d.id, byId)] as const));
}

/** Only the drivers a human should see/pay: retired duplicates are excluded. */
export function activeDrivers<T extends MergeableDriver>(drivers: readonly T[]): T[] {
  return drivers.filter((d) => !d.merged_into);
}

/* ------------------------------------------------------------------ search */

export type DriverSearchFields = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  license_number?: string | null;
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  unit_number?: string | null;
};

const digits = (s: string) => s.replace(/\D+/g, "");

/**
 * One plain search box, no filters: every term must appear somewhere in the
 * driver's name, email, phone, id, licence, unit or vehicle.
 */
export function driverMatchesSearch(d: DriverSearchFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    d.name,
    `${d.first_name ?? ""} ${d.last_name ?? ""}`,
    d.email,
    d.phone,
    digits(d.phone ?? ""),
    d.id,
    d.license_number,
    d.unit_number,
    d.vehicle_plate,
    d.vehicle_make,
    d.vehicle_model,
    `${d.vehicle_make ?? ""} ${d.vehicle_model ?? ""}`,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return q
    .split(/\s+/)
    .every((term) => hay.includes(term) || (digits(term) !== "" && hay.includes(digits(term))));
}

export function filterDrivers<T extends DriverSearchFields>(rows: readonly T[], query: string): T[] {
  return rows.filter((r) => driverMatchesSearch(r, query));
}
