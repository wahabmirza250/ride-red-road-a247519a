/**
 * Safe batched `IN (...)` reads.
 *
 * PostgREST puts `.in()` filters in the request URL. Once a company has a few
 * hundred claims, a single `.in("trip_id", [...1000 uuids])` produces a ~37 KB
 * URL that the gateway rejects — and because those call sites ignored the
 * error, the result silently came back EMPTY. That is how paid claims stopped
 * being recognised (earnings read $0) even though the rows were fine.
 *
 * Always read big id lists through these helpers.
 */

/** Split ids into fixed-size chunks. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * `select ... where column in (ids)` executed in safe chunks.
 * Throws when the database reports an error, so a failed read can never be
 * mistaken for "no matching rows".
 */
export async function selectIn<T = any>(
  supabase: any,
  table: string,
  columns: string,
  column: string,
  ids: string[],
  size = 150,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return [];
  const out: T[] = [];
  for (const part of chunk(unique, size)) {
    const { data, error } = await supabase.from(table).select(columns).in(column, part);
    if (error) throw new Error(`${table}.${column} lookup failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/**
 * Read every row of a filtered query, page by page.
 * `build()` must return a fresh query builder each call.
 */
export async function selectAllPages<T = any>(
  build: () => any,
  pageSize = 1000,
  maxRows = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
