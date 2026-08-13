export type EarningsBucket = { period: string; amount: number; claims: number };
export type CompanyEarnings = {
  total: number;
  claims: number;
  byDay: EarningsBucket[];
  byWeek: EarningsBucket[];
  byMonth: EarningsBucket[];
};

export type ClaimRow = {
  robot_captured_claim: unknown;
  /** Pre-resolved charge (captured OR recalculated from company rates). */
  amount?: number | null;
  submitted_at?: string | null;
  portal_submitted_at?: string | null;
  updated_at?: string | null;
};


/** Parse "$1,234.56" / 1234.56 / null into a number. */
export function parseAmount(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function isoWeekStart(d: Date) {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - (day - 1));
  return copy.toISOString().slice(0, 10);
}

/** Shared aggregation so the admin panel and the owner panel never diverge. */
export function aggregateEarnings(rows: ClaimRow[]): CompanyEarnings {
  const day = new Map<string, EarningsBucket>();
  const week = new Map<string, EarningsBucket>();
  const month = new Map<string, EarningsBucket>();
  let total = 0;
  let claims = 0;

  for (const r of rows) {
    const captured = (r.robot_captured_claim ?? null) as { total_charged_amount?: unknown } | null;
    const amount = parseAmount(captured?.total_charged_amount);
    const stamp = r.submitted_at ?? r.portal_submitted_at ?? r.updated_at;
    if (!stamp) continue;
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) continue;

    total += amount;
    claims += 1;

    const add = (m: Map<string, EarningsBucket>, key: string) => {
      const cur = m.get(key) ?? { period: key, amount: 0, claims: 0 };
      cur.amount += amount;
      cur.claims += 1;
      m.set(key, cur);
    };
    add(day, d.toISOString().slice(0, 10));
    add(week, isoWeekStart(d));
    add(month, d.toISOString().slice(0, 7));
  }

  const sorted = (m: Map<string, EarningsBucket>) =>
    Array.from(m.values())
      .map((b) => ({ ...b, amount: Math.round(b.amount * 100) / 100 }))
      .sort((a, b) => (a.period < b.period ? 1 : -1));

  return {
    total: Math.round(total * 100) / 100,
    claims,
    byDay: sorted(day).slice(0, 30),
    byWeek: sorted(week).slice(0, 12),
    byMonth: sorted(month).slice(0, 12),
  };
}
