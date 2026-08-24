import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { DriverGroupedList } from "@/components/billing/DriverGroups";
import { STATUS_LABEL, type DestinationStatus } from "@/lib/destinationClassifier";
import {
  classifyDestinationsForReview,
  listDestinationReview,
  overrideDestinationReview,
  recheckTripDestination,
} from "@/lib/destinationReview.functions";

const STATUS_STYLE: Record<string, string> = {
  review_non_medical: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  unknown: "bg-muted text-muted-foreground",
  medical_possible: "bg-info/15 text-info",
  medical_confident: "bg-success/15 text-success",
};

function ClassificationPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {STATUS_LABEL[status as DestinationStatus] ?? status}
    </span>
  );
}

/**
 * "Needs Medical Review" — destinations that do not look medical, surfaced for
 * a human biller. This is a review queue, not an eligibility decision: nothing
 * here is denied, nothing is submitted, and the biller can always send a bill
 * on with an explicit, audited override.
 */
export function MedicalReviewTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDestinationReview);
  const classifyFn = useServerFn(classifyDestinationsForReview);
  const recheckFn = useServerFn(recheckTripDestination);
  const overrideFn = useServerFn(overrideDestinationReview);

  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [showOverridden, setShowOverridden] = useState(false);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [note, setNote] = useState("");

  const rows = useQuery({
    queryKey: ["destination_review", includeUnknown, showOverridden],
    queryFn: () =>
      listFn({
        data: { include_unknown: includeUnknown, include_overridden: showOverridden },
      }),
    refetchInterval: 60000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["destination_review"] });
    qc.invalidateQueries({ queryKey: ["billing_list"] });
  };

  const scan = useMutation({
    mutationFn: () => classifyFn({ data: {} }),
    onSuccess: (res: any) => {
      toast.success(
        res.classified
          ? `Checked ${res.classified} destination${res.classified === 1 ? "" : "s"} — ${
              res.counts?.review_non_medical ?? 0
            } need review.`
          : "All active bills are already checked.",
      );
      if (res.places_configured === false) {
        toast.info("Place lookups are unavailable, so results use destination text only.");
      }
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not run the destination check"),
  });

  const recheck = useMutation({
    mutationFn: (trip_id: string) => recheckFn({ data: { trip_id } }),
    onSuccess: () => {
      toast.success("Destination rechecked — claim data untouched.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Recheck failed"),
  });

  const override = useMutation({
    mutationFn: (row: any) =>
      overrideFn({ data: { billing_record_id: row.id, note: note.trim() || undefined } }),
    onSuccess: () => {
      toast.success("Override recorded — the bill continues in its normal workflow.");
      setConfirm(null);
      setNote("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not record the override"),
  });

  const data = rows.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Review only — nothing is denied here</div>
          <div className="text-xs">
            These destinations don&apos;t show medical, behavioral-health, recovery or pharmacy
            evidence. Colorado NEMT covers medically necessary trips plus enrolled-pharmacy trips
            (prescriptions, vaccines, preventive services, DME). Check the trip, then either fix the
            destination or send it on with an override.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
        <Button size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
          {scan.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Check destinations
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={includeUnknown}
            onCheckedChange={(v) => setIncludeUnknown(Boolean(v))}
          />
          Include unknown destinations
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={showOverridden}
            onCheckedChange={(v) => setShowOverridden(Boolean(v))}
          />
          Show already overridden
        </label>
        <span className="ml-auto text-sm text-muted-foreground">
          {data.length} bill{data.length === 1 ? "" : "s"} flagged
        </span>
      </div>

      {rows.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No destinations need review. Run “Check destinations” after adding new bills.
        </div>
      ) : (
        <DriverGroupedList
          rows={data}
          renderItem={(r: any) => (
            <div
              key={r.id}
              className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.passenger_name ?? "Unknown passenger"}</span>
                {r.medicaid_id && (
                  <span className="font-mono text-xs text-muted-foreground">{r.medicaid_id}</span>
                )}
                <ClassificationPill status={r.classification_status} />
                {r.confidence != null && (
                  <span className="text-[11px] text-muted-foreground">
                    confidence {Math.round(Number(r.confidence) * 100)}%
                  </span>
                )}
                {r.override && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                    <CheckCircle2 className="h-3 w-3" /> Overridden
                  </span>
                )}
              </div>

              <div className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div>Driver: {r.driver_name || "—"}</div>
                <div>Trip: {r.pickup_at ? formatDateTime(r.pickup_at) : "—"}</div>
                <div>Bill stage: {String(r.bill_status).replace(/_/g, " ")}</div>
                <div>Submitted: {r.submitted_at ? formatDateTime(r.submitted_at) : "not yet"}</div>
                <div className="sm:col-span-2">Pickup: {r.pickup_address ?? "—"}</div>
                <div className="sm:col-span-2 text-foreground">
                  Dropoff: {r.dropoff_address ?? "—"}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface-muted/60 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium text-foreground">{r.summary ?? "No summary"}</div>
                    {Array.isArray(r.reasons) && r.reasons.length > 0 && (
                      <div className="text-muted-foreground">
                        Reasons: {r.reasons.join(", ")}
                      </div>
                    )}
                    {Array.isArray(r.matched) && r.matched.length > 0 && (
                      <div className="text-muted-foreground">
                        Evidence: {r.matched.slice(0, 6).join(", ")}
                      </div>
                    )}
                    {r.evidence?.place?.name && (
                      <div className="text-muted-foreground">
                        Place: {r.evidence.place.name}
                        {Array.isArray(r.evidence.place.types) && r.evidence.place.types.length
                          ? ` (${r.evidence.place.types.slice(0, 4).join(", ")})`
                          : ""}
                      </div>
                    )}
                    {Array.isArray(r.evidence?.nearby) && r.evidence.nearby.length > 0 && (
                      <div className="text-muted-foreground">
                        Same address:{" "}
                        {r.evidence.nearby
                          .slice(0, 4)
                          .map((p: any) => p?.name)
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                    {r.override && (
                      <div className="text-success">
                        Sent anyway by {r.override.by} on {formatDateTime(r.override.at)}
                        {r.override.note ? ` — “${r.override.note}”` : ""} (was{" "}
                        {r.override.original_status})
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => recheck.mutate(r.trip_id)}
                  disabled={recheck.isPending}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Recheck destination
                </Button>
                {!r.override && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setNote("");
                      setConfirm(r);
                    }}
                  >
                    Send anyway to billing
                  </Button>
                )}
              </div>
            </div>
          )}
        />
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send this bill on to billing anyway?</DialogTitle>
            <DialogDescription>
              This records that you reviewed a destination flagged “
              {STATUS_LABEL[(confirm?.classification_status ?? "unknown") as DestinationStatus]}”
              and decided the trip is billable. Nothing is submitted to the state now — the bill
              simply continues in its normal workflow.
            </DialogDescription>
          </DialogHeader>
          {confirm && (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border bg-surface-muted/60 p-3 text-xs">
                <div>
                  <strong>{confirm.passenger_name ?? "Unknown passenger"}</strong> ·{" "}
                  {confirm.pickup_at ? formatDateTime(confirm.pickup_at) : "—"}
                </div>
                <div className="mt-1">Dropoff: {confirm.dropoff_address ?? "—"}</div>
                <div className="mt-1 text-muted-foreground">{confirm.summary}</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="override-note">
                  Reason / note (optional but recommended)
                </label>
                <Textarea
                  id="override-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Confirmed with the member: appointment was with the behavioral-health suite in this building."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={override.isPending}>
              Cancel
            </Button>
            <Button onClick={() => confirm && override.mutate(confirm)} disabled={override.isPending}>
              {override.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
