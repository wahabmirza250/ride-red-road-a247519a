import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fuel, Loader2, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listStaffGasReceipts, markGasReceiptReimbursed } from "@/lib/gasReceipts.functions";
import { formatCurrency, formatDateTime } from "@/lib/format";

/** Shared by Admin and Dispatch. Expense records only — no pay-rate data. */
export function GasReceiptsPanel({ driverId }: { driverId?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStaffGasReceipts);
  const markFn = useServerFn(markGasReceiptReimbursed);

  const q = useQuery({
    queryKey: ["staff-gas-receipts", driverId ?? "all"],
    queryFn: () => listFn({ data: { driver_id: driverId ?? null } }),
  });

  const mark = useMutation({
    mutationFn: (v: { receipt_id: string; reimbursed: boolean }) => markFn({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["staff-gas-receipts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Fuel className="h-3.5 w-3.5" /> Gas receipts
      </div>

      {q.isLoading && (
        <div className="py-6 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="space-y-2">
        {q.data?.receipts.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
            {r.photo_url ? (
              <a href={r.photo_url} target="_blank" rel="noreferrer" className="shrink-0">
                <img
                  src={r.photo_url}
                  alt={`Gas receipt from ${r.driver_name}`}
                  className="h-14 w-14 rounded-lg object-cover"
                />
              </a>
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Fuel className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{formatCurrency(r.amount)}</span>
                <span className="truncate text-sm text-muted-foreground">{r.driver_name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(r.submitted_at)}
                {r.gallons ? ` · ${r.gallons} gal` : ""}
                {r.notes ? ` · ${r.notes}` : ""}
              </div>
              {r.reimbursed_at && (
                <div className="text-xs font-medium text-emerald-600">
                  Reimbursed {formatDateTime(r.reimbursed_at)}
                </div>
              )}
            </div>
            {r.photo_url && (
              <a href={r.photo_url} target="_blank" rel="noreferrer" download>
                <Button size="sm" variant="outline" className="rounded-full">
                  <Download className="mr-1 h-3.5 w-3.5" /> View
                </Button>
              </a>
            )}
            {q.data.can_reimburse && (
              <Button
                size="sm"
                variant={r.reimbursed_at ? "outline" : "default"}
                className="rounded-full"
                disabled={mark.isPending}
                onClick={() => mark.mutate({ receipt_id: r.id, reimbursed: !r.reimbursed_at })}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                {r.reimbursed_at ? "Undo" : "Mark reimbursed"}
              </Button>
            )}
          </div>
        ))}
        {q.data && !q.data.receipts.length && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No gas receipts submitted yet.
          </div>
        )}
      </div>
    </div>
  );
}
