import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpDown, Loader2, Search, ReceiptText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/claimReview";
import { listClaimsHistory, type ClaimHistoryRow } from "@/lib/claimsHistory.functions";

/** Permanent audit trail of every claim that reached the state portal. */
export function ClaimsHistoryTab() {
  const listFn = useServerFn(listClaimsHistory);
  const [q, setQ] = useState("");
  const [desc, setDesc] = useState(true);

  const query = useQuery({
    queryKey: ["claims_history"],
    queryFn: () => listFn() as Promise<ClaimHistoryRow[]>,
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (query.data ?? []).filter((r) =>
      !term
        ? true
        : (r.member_name ?? "").toLowerCase().includes(term) ||
          (r.claim_id ?? "").toLowerCase().includes(term) ||
          (r.medicaid_id ?? "").toLowerCase().includes(term),
    );
    return [...list].sort((a, b) => {
      const av = new Date(a.submitted_at ?? a.trip_date ?? 0).getTime();
      const bv = new Date(b.submitted_at ?? b.trip_date ?? 0).getTime();
      return desc ? bv - av : av - bv;
    });
  }, [query.data, q, desc]);

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by member name or claim ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setDesc((d) => !d)}>
          <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
          {desc ? "Newest first" : "Oldest first"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No submitted claims yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Claim ID</th>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-left font-medium">Trip date</th>
                <th className="px-3 py-2 text-left font-medium">Submitted</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono">
                    <span className="inline-flex items-center gap-1">
                      <ReceiptText className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.claim_id ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.member_name ?? "—"}</div>
                    {r.medicaid_id && (
                      <div className="font-mono text-xs text-muted-foreground">{r.medicaid_id}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.trip_date ? formatDateTime(r.trip_date) : "—"}</td>
                  <td className="px-3 py-2">
                    {r.submitted_at ? formatDateTime(r.submitted_at) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(r.total_amount)}
                    {r.total_source === "billing_records" && (
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        from line items
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
