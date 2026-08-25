import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown, Gauge, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { getSubmissionDoneFeed } from "@/lib/submissionQueue.functions";
import {
  TARGET_SECONDS_PER_CLAIM,
  filterDoneClaims,
  formatSeconds,
  throughputSummary,
  type DoneClaim,
} from "@/lib/submissionThroughput";

type Feed = {
  counters: { queued: number; processing: number; verifying: number; needs_attention: number; done: number };
  claims: DoneClaim[];
  completions: string[];
};

/**
 * DONE / COMPLETED history — deliberately separate from the active queue.
 * Collapsed and compact by default so a long history never crowds out the
 * live Queued / Processing / Verifying / Needs attention counters.
 */
export function DoneClaimsSection() {
  const feedFn = useServerFn(getSubmissionDoneFeed);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const feed = useQuery({
    queryKey: ["submission_done_feed"],
    queryFn: () => feedFn({ data: {} }) as Promise<Feed>,
    retry: false,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const claims = feed.data?.claims ?? [];
  const counters = feed.data?.counters;
  const pending = (counters?.queued ?? 0) + (counters?.processing ?? 0);
  const tp = useMemo(() => throughputSummary(claims, pending), [claims, pending]);
  const filtered = useMemo(() => filterDoneClaims(claims, q), [claims, q]);

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-3 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Done / Completed
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">
              {claims.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Submitted, approved and paid claims with their Claim ID — history only, nothing here is
            queued or retried.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThroughputBadge
            avg={tp.avgSecondsPerClaim}
            perHour={tp.claimsPerHour}
            eta={tp.etaSeconds}
            pending={pending}
          />
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide" : "Show"} history
            <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search claim ID, passenger, biller or batch"
              className="h-8 pl-8 text-xs"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {claims.length === 0 ? "No completed claims yet." : "No completed claims match that search."}
            </p>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Claim ID</th>
                    <th className="px-2 py-1.5 font-medium">Passenger</th>
                    <th className="px-2 py-1.5 font-medium">Completed</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Biller / batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-1.5 font-mono">{c.claimId ?? "—"}</td>
                      <td className="px-2 py-1.5">{c.passenger ?? "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {c.completedAt ? formatDateTime(c.completedAt) : "—"}
                      </td>
                      <td className="px-2 py-1.5 capitalize">{c.status}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {c.biller ?? "—"}
                        {c.batchLabel ? ` · ${c.batchLabel}` : c.batchId ? ` · ${c.batchId.slice(0, 8)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Measured throughput only — the 60s figure is shown strictly as a target. */
export function ThroughputBadge({
  avg,
  perHour,
  eta,
  pending,
}: {
  avg: number | null;
  perHour: number | null;
  eta: number | null;
  pending: number;
}) {
  const ok = avg != null && avg <= TARGET_SECONDS_PER_CLAIM;
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        avg == null
          ? "border-border bg-muted/40 text-muted-foreground"
          : ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
      title={`Target ≤${TARGET_SECONDS_PER_CLAIM}s/claim`}
    >
      <Gauge className="h-3 w-3" />
      {avg == null ? "Measuring…" : `${avg}s/claim`}
      {perHour != null && <span className="tabular-nums opacity-80">· ~{perHour}/hr</span>}
      {pending > 0 && <span className="opacity-80">· ETA {formatSeconds(eta)}</span>}
      <span className="opacity-70">· Target ≤{TARGET_SECONDS_PER_CLAIM}s/claim</span>
    </span>
  );
}
