import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { listDeniedClaims, prepareResubmission } from "@/lib/resubmission.functions";
import { ResubmissionEditor } from "@/components/billing/ResubmissionEditor";

/** Denied claims and their linked resubmission drafts. */
export function DeniedClaimsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeniedClaims);
  const prepareFn = useServerFn(prepareResubmission);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const pageSize = 50;

  const q = useQuery({
    queryKey: ["denied_claims", page],
    queryFn: () => listFn({ data: { page, page_size: pageSize } }) as Promise<any>,
    retry: false,
  });

  const prepare = useMutation({
    mutationFn: (tripId: string) =>
      prepareFn({ data: { trip_id: tripId } }) as Promise<{ id: string; created: boolean }>,
    onSuccess: (res) => {
      if (!res.created) toast.info("Opening the existing resubmission draft");
      setOpenId(res.id);
      void qc.invalidateQueries({ queryKey: ["denied_claims"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not prepare resubmission"),
  });

  if (q.isError)
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Could not load denied claims:{" "}
        {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    );

  const rows = (q.data?.rows ?? []) as any[];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        State-denied claims. Review or edit a claim first — nothing is ever resubmitted
        automatically. Preparing a resubmission creates a new draft; the original claim ID,
        status and denial reason stay exactly as they are.
      </p>

      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length ? (
        <div className="bill-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-medium">Claim #</th>
                  <th className="p-3 text-left font-medium">Patient / Driver</th>
                  <th className="p-3 text-left font-medium">Service date</th>
                  <th className="p-3 text-left font-medium">Medicaid ID</th>
                  <th className="p-3 text-left font-medium">Denial reason</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.trip_id} className="border-t border-border/70 hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{r.claim_number ?? "—"}</td>
                    <td className="p-3">
                      <div className="truncate font-medium">{r.passenger ?? "—"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.driver_name ?? "—"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {r.trip_date ? formatDate(r.trip_date) : "—"}
                    </td>
                    <td className="p-3 font-mono text-xs">{r.medicaid_id ?? "—"}</td>
                    <td className="max-w-[300px] truncate p-3 text-xs text-muted-foreground">
                      {r.denial_reason ?? "—"}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                        {r.claim_status === "denied" ? "Denied" : "Rejected"}
                      </span>
                      {r.resubmission_status ? (
                        <Badge variant="secondary" className="ml-1.5">
                          {r.resubmission_status}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant={r.resubmission_id ? "outline" : "default"}
                        className="rounded-full"
                        disabled={prepare.isPending}
                        onClick={() =>
                          r.resubmission_id ? setOpenId(r.resubmission_id) : prepare.mutate(r.trip_id)
                        }
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        {r.resubmission_id ? "View / Edit draft" : "Review & edit"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No denied claims.
        </div>
      )}


      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * pageSize >= (q.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      <ResubmissionEditor id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
