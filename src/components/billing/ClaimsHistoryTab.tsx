import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpDown, Loader2, Plus, Search, ReceiptText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { ClaimStatusSyncCard } from "@/components/billing/ClaimStatusSyncCard";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/claimReview";
import { AddManualTripDialog } from "@/components/billing/AddManualTripDialog";
import {
  listManualClaimTrips,
  setManualClaimStatus,
  type ManualClaimRow,
} from "@/lib/manualClaims.functions";
import {
  MANUAL_CLAIM_STATUS_LABEL,
  MANUAL_CLAIM_STATUS_OPTIONS,
} from "@/lib/manualClaims";
import {
  listClaimsHistory,
  clearClaimsHistory,
  setClaimStatus,
  CLAIM_STATUS_OPTIONS,
} from "@/lib/claimsHistory.functions";
import {
  dedupeClaimHistory,
  matchesClaimSearch,
  type ClaimHistoryRow,
} from "@/lib/claimsHistory";



/** Permanent audit trail of every claim that reached the state portal. */
export function ClaimsHistoryTab() {
  const listFn = useServerFn(listClaimsHistory);
  const clearFn = useServerFn(clearClaimsHistory);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [desc, setDesc] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const manualListFn = useServerFn(listManualClaimTrips);
  const manualStatusFn = useServerFn(setManualClaimStatus);
  const manualQuery = useQuery({
    queryKey: ["manual_claims"],
    queryFn: () => manualListFn({ data: {} }) as Promise<ManualClaimRow[]>,
    retry: false,
  });
  const manualStatusMutation = useMutation({
    mutationFn: (vars: { id: string; claim_status: string }) =>
      manualStatusFn({ data: vars }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      toast.success("Manual trip status updated");
      void qc.invalidateQueries({ queryKey: ["manual_claims"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update status"),
  });

  // An exact claim number is looked up server-side too, so a claim that is
  // older than the visible page is still findable.
  const exactTerm = /^[A-Za-z0-9-]{6,}$/.test(q.trim()) ? q.trim() : "";
  const query = useQuery({
    queryKey: ["claims_history", exactTerm],
    queryFn: () =>
      listFn({ data: exactTerm ? { search: exactTerm } : {} }) as Promise<ClaimHistoryRow[]>,
    retry: false,
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn() as Promise<{ cleared: number }>,
    onSuccess: (res) => {
      toast.success(`Cleared ${res.cleared} claim${res.cleared === 1 ? "" : "s"} from history`);
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ["claims_history"] });
      void qc.invalidateQueries({ queryKey: ["billing_counts"] });
      void qc.invalidateQueries({ queryKey: ["billing_list"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not clear history");
    },
  });

  const statusFn = useServerFn(setClaimStatus);
  const [savingId, setSavingId] = useState<string | null>(null);
  const statusMutation = useMutation({
    mutationFn: (vars: { tripId: string; status: string }) =>
      statusFn({ data: vars as never }) as Promise<{ from: string | null; to: string }>,
    onMutate: (vars) => setSavingId(vars.tripId),
    onSettled: () => setSavingId(null),
    onSuccess: (res) => {
      toast.success(`Status updated to ${res.to}`);
      void qc.invalidateQueries({ queryKey: ["claims_history"] });
      void qc.invalidateQueries({ queryKey: ["company-earnings"] });
      void qc.invalidateQueries({ queryKey: ["billing_list"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update status"),
  });

  /** Manual trips live alongside portal claims in the same list. */
  const manualRows = useMemo<ClaimHistoryRow[]>(
    () =>
      (manualQuery.data ?? []).map((m) => ({
        id: m.id,
        record_id: null,
        company_id: null,
        source: "manual" as const,
        claim_id: m.claim_number,
        member_name: m.passenger_name,
        medicaid_id: null,
        trip_date: m.service_date,
        submitted_at: null,
        total_amount: m.billed_amount,
        total_source: null,
        status: m.claim_status,
      })),
    [manualQuery.data],
  );
  const manualById = useMemo(
    () => new Map((manualQuery.data ?? []).map((m) => [m.id, m])),
    [manualQuery.data],
  );

  const rows = useMemo(() => {
    const list = dedupeClaimHistory([...(query.data ?? []), ...manualRows]).filter((r) =>
      matchesClaimSearch(r, q, manualById.get(r.id)?.driver_name ?? ""),
    );
    return [...list].sort((a, b) => {
      const av = new Date(a.submitted_at ?? a.trip_date ?? 0).getTime();
      const bv = new Date(b.submitted_at ?? b.trip_date ?? 0).getTime();
      return desc ? bv - av : av - bv;
    });
  }, [query.data, manualRows, manualById, q, desc]);

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Could not load claims history:{" "}
        {query.error instanceof Error ? query.error.message : "unknown error"}
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ClaimStatusSyncCard />
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
        <Button size="sm" onClick={() => setManualOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add Manual Trip
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDesc((d) => !d)}>
          <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
          {desc ? "Newest first" : "Oldest first"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={(query.data ?? []).length === 0 || clearMutation.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Clear history
        </Button>
      </div>


      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No claims yet. Use “Add Manual Trip” for a trip handled outside the automated flow.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface/60">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Claim ID</th>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-left font-medium">Trip date</th>
                <th className="px-3 py-2 text-left font-medium">Submitted</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const manual = manualById.get(r.id);
                return (
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
                    {manual && (
                      <div className="text-xs text-muted-foreground">{manual.driver_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.trip_date ? formatDateTime(r.trip_date) : "—"}</td>
                  <td className="px-3 py-2">
                    {manual ? "—" : r.submitted_at ? formatDateTime(r.submitted_at) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {manual ? (
                      <Select
                        value={
                          MANUAL_CLAIM_STATUS_OPTIONS.includes((manual.claim_status ?? "") as never)
                            ? (manual.claim_status as string)
                            : "internal"
                        }
                        onValueChange={(v) =>
                          manualStatusMutation.mutate({ id: manual.id, claim_status: v })
                        }
                        disabled={manualStatusMutation.isPending}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MANUAL_CLAIM_STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {MANUAL_CLAIM_STATUS_LABEL[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <>
                        <Select
                          value={CLAIM_STATUS_OPTIONS.includes((r.status ?? "") as never)
                            ? (r.status as string)
                            : "submitted"}
                          onValueChange={(v) => statusMutation.mutate({ tripId: r.id, status: v })}
                          disabled={savingId === r.id}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs capitalize">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CLAIM_STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs capitalize">
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {savingId === r.id && (
                          <Loader2 className="mt-1 h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.portal_paid_amount != null ? (
                      <span className="font-semibold text-success">
                        {formatMoney(r.portal_paid_amount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {r.total_amount != null ? formatMoney(r.total_amount) : "—"}
                      </span>
                    )}
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {r.portal_paid_amount != null
                        ? "paid by portal"
                        : manual
                          ? "entered by hand"
                          : "estimate — not income"}
                    </div>
                    {manual && manual.driver_pay_amount != null && (
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        driver pay {formatMoney(manual.driver_pay_amount)}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {manual ? (
                      <Badge variant="outline">MANUAL</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Portal</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddManualTripDialog open={manualOpen} onOpenChange={setManualOpen} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear claims history?</DialogTitle>
            <DialogDescription>
              This will reset all {(query.data ?? []).length} submitted claim{(query.data ?? []).length === 1 ? "" : "s"} back to
              “Ready to Submit” and remove the confirmation numbers. The trips themselves stay in the
              billing workflow and can be re-submitted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={clearMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

