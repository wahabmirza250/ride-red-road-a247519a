/**
 * Paging helper for the billing workspace list (pure, shared + tested).
 *
 * The list used to load every matching bill on every 10s poll. It now pages;
 * counts stay exact because they come from head-count queries, not row data.
 */
export const BILLING_PAGE_SIZE = 100;
export const BILLING_MAX_PAGE_SIZE = 500;

export function pageRange(limit?: number | null, offset?: number | null) {
  const from = Math.max(0, Math.floor(offset ?? 0));
  const size = Math.min(
    BILLING_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(limit ?? BILLING_PAGE_SIZE)),
  );
  return { from, to: from + size - 1, size };
}
