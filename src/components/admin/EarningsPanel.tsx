import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { DollarSign, TrendingUp, Loader2 } from "lucide-react";
import { getCompanyEarnings } from "@/lib/earnings.functions";
import type { EarningsBucket } from "@/lib/earnings";

import { cn } from "@/lib/utils";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const TABS = [
  { key: "byDay", label: "Daily" },
  { key: "byWeek", label: "Weekly" },
  { key: "byMonth", label: "Monthly" },
] as const;

export function EarningsPanel() {
  const fetchEarnings = useServerFn(getCompanyEarnings);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("byDay");

  const { data, isLoading, error } = useQuery({
    queryKey: ["company-earnings"],
    queryFn: () => fetchEarnings({ data: undefined as never }),
    staleTime: 60_000,
  });

  const buckets: EarningsBucket[] = data ? data[tab] : [];
  const max = Math.max(1, ...buckets.map((b) => b.amount));

  return (
    <div className="fleet-card flex flex-col p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-success" />
          <h2 className="font-display text-sm font-semibold tracking-tight">Earnings</h2>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition",
                tab === t.key && "bg-background text-foreground shadow-sm",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load earnings"}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Paid income (portal-confirmed payments)
              </p>
              <p className="font-display text-3xl font-semibold tracking-tight">
                {money(data?.total ?? 0)}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                {data?.claims ?? 0} claim{(data?.claims ?? 0) === 1 ? "" : "s"} paid by HCPF
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Billed, awaiting payment (estimate)
              </p>
              <p className="font-display text-xl font-semibold tracking-tight text-muted-foreground">
                {money(data?.pendingTotal ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data?.pendingClaims ?? 0} claim{(data?.pendingClaims ?? 0) === 1 ? "" : "s"} — our
                own calculation, not income
              </p>
            </div>
            {(data?.unknownClaims ?? 0) > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Unverified / needs attention
                </p>
                <p className="font-display text-xl font-semibold tracking-tight text-muted-foreground">
                  {data?.unknownClaims ?? 0} claim{(data?.unknownClaims ?? 0) === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {money(data?.unknownEstimated ?? 0)} estimated — no portal amount confirmed
                </p>
              </div>
            )}
            {(data?.deniedClaims ?? 0) > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Denied / rejected
                </p>
                <p className="font-display text-xl font-semibold tracking-tight text-destructive">
                  {money(data?.deniedTotal ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data?.deniedClaims ?? 0} claim{(data?.deniedClaims ?? 0) === 1 ? "" : "s"} — never
                  income
                </p>
              </div>
            )}
          </div>




          <div className="mt-5 space-y-2">
            {buckets.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No submitted claims yet.
              </p>
            ) : (
              buckets.map((b) => (
                <div key={b.period} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{b.period}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full bg-success/70"
                      style={{ width: `${Math.max(3, (b.amount / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-medium tabular-nums">
                    {money(b.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
