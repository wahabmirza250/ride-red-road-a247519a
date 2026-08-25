import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { listDeniedClaims, prepareResubmission } from "@/lib/resubmission.functions";
import { ResubmissionDialog } from "@/components/billing/ResubmissionDialog";

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
        Preparing a resubmission creates a new draft linked to the original claim. The original
        claim ID, status and denial reason stay exactly as they are.
      </p>

      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Trip date</th>
                <th className="p-2 text-left">Passenger</th>
                <th className="p-2 text-left">Driver</th>
                <th className="p-2 text-left">Claim ID</th>
                <th className="p-2 text-left">Denial reason</th>
                <th className="p-2 text-left">Resubmission</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.trip_id} className="border-t">
                  <td className="whitespace-nowrap p-2">
                    {r.trip_date ? formatDate(r.trip_date) : "—"}
                  </td>
                  <td className="p-2">{r.passenger ?? "—"}</td>
                  <td className="p-2">{r.driver_name ?? "—"}</td>
                  <td className="p-2 font-mono text-xs">{r.claim_number ?? "—"}</td>
                  <td className="max-w-[280px] truncate p-2 text-xs text-muted-foreground">
                    {r.denial_reason ?? "—"}
                  </td>
                  <td className="p-2">
                    {r.resubmission_status ? (
                      <Badge variant="secondary">{r.resubmission_status}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <Button
                      size="sm"
                      variant={r.resubmission_id ? "outline" : "default"}
                      disabled={prepare.isPending}
                      onClick={() =>
                        r.resubmission_id ? setOpenId(r.resubmission_id) : prepare.mutate(r.trip_id)
                      }
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      {r.resubmission_id ? "Open draft" : "Prepare Resubmission"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No denied claims. 🎉
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

      <ResubmissionDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
