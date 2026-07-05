import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, FileDown, Check, X, Send, AlertCircle } from "lucide-react";
import { StatusPill } from "@/components/nemt/StatusPill";
import { formatDateTime } from "@/lib/format";
import {
  approveBillingRecord,
  getBillingRecord,
  markApproved,
  markRejected,
  requestFix,
  submitBillingRecords,
} from "@/lib/billing.functions";

export function BillingDetailSheet({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = !!id;
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getBillingRecord);
  const approveFn = useServerFn(approveBillingRecord);
  const requestFixFn = useServerFn(requestFix);
  const submitFn = useServerFn(submitBillingRecords);
  const markApprovedFn = useServerFn(markApproved);
  const markRejectedFn = useServerFn(markRejected);

  const [fixNotes, setFixNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const detail = useQuery({
    queryKey: ["billing_detail", id],
    queryFn: () => fetchDetail({ data: { id: id! } }),
    enabled: open,
  });

  useEffect(() => {
    setFixNotes("");
    setRejectReason("");
  }, [id]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["billing_list"] });
    qc.invalidateQueries({ queryKey: ["billing_detail", id] });
  };

  const approve = useMutation({
    mutationFn: () => approveFn({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("Approved — moved to Pending Submit");
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const needsFix = useMutation({
    mutationFn: () =>
      requestFixFn({ data: { id: id!, notes: fixNotes.trim() } }),
    onSuccess: () => {
      toast.success("Sent back to driver");
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitOne = useMutation({
    mutationFn: () => submitFn({ data: { ids: [id!] } }),
    onSuccess: (r: any) => {
      const first = r?.results?.[0];
      if (first?.ok) toast.success("Submission started");
      else toast.error(first?.error ?? "Submit failed");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const stateApprove = useMutation({
    mutationFn: () => markApprovedFn({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("Marked approved by state");
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const stateReject = useMutation({
    mutationFn: () =>
      markRejectedFn({ data: { id: id!, reason: rejectReason.trim() } }),
    onSuccess: () => {
      toast.success("Marked rejected by state");
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rec = detail.data?.record as any;
  const trip = detail.data?.trip as any;
  const rider = trip?.riders;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            Trip details
            {rec?.status && <StatusPill status={rec.status} />}
          </SheetTitle>
        </SheetHeader>

        {detail.isLoading || !rec ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            {rec.submission_error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs">
                  <div className="font-medium">Submission error</div>
                  <div>{rec.submission_error}</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Passenger" value={rider?.full_name} />
              <Field label="Medicaid ID" value={rider?.medicaid_id} />
              <Field label="DOB" value={rider?.dob} />
              <Field label="Last 4 SSN" value={rider?.last_4_ssn} />
              <Field label="Driver" value={detail.data?.driver_name} />
              <Field label="Pickup" value={formatDateTime(trip?.pickup_at)} />
              <Field label="Odometer start" value={trip?.odometer_start} />
              <Field label="Odometer end" value={trip?.odometer_end} />
              <Field label="Miles" value={trip?.miles} />
            </div>
            <Field label="Pickup address" value={trip?.pickup_address} />
            <Field label="Drop-off address" value={trip?.dropoff_address} />

            {rec.state_confirmation_number && (
              <Field
                label="State confirmation"
                value={`${rec.state_confirmation_number} · ${formatDateTime(rec.submitted_at)}`}
              />
            )}
            {rec.fix_notes && (
              <Field label="Fix notes" value={rec.fix_notes} />
            )}
            {rec.rejection_reason && (
              <Field label="Rejection reason" value={rec.rejection_reason} />
            )}

            {detail.data?.signature_url && (
              <div>
                <Label>Passenger signature</Label>
                <img
                  src={detail.data.signature_url}
                  alt="Signature"
                  className="mt-1 h-32 rounded-lg border bg-white"
                />
              </div>
            )}

            {detail.data?.pdf_url ? (
              <div>
                <Label>State trip log PDF</Label>
                <iframe
                  src={detail.data.pdf_url}
                  title="State trip log"
                  className="mt-1 h-[520px] w-full rounded-lg border bg-white"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    window.open(detail.data!.pdf_url!, "_blank", "noopener,noreferrer")
                  }
                >
                  <FileDown className="mr-1 h-4 w-4" /> Download PDF
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                No stored PDF for this trip yet.
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3 border-t pt-4">
              {rec.status === "pending_review" && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => approve.mutate()}
                    disabled={approve.isPending}
                  >
                    <Check className="mr-1 h-4 w-4" /> Approve → Pending Submit
                  </Button>
                  <div>
                    <Label>Needs fix — describe the issue</Label>
                    <Textarea
                      rows={2}
                      value={fixNotes}
                      onChange={(e) => setFixNotes(e.target.value)}
                      placeholder="e.g. missing rider signature"
                    />
                    <Button
                      variant="secondary"
                      className="mt-2 w-full"
                      disabled={!fixNotes.trim() || needsFix.isPending}
                      onClick={() => needsFix.mutate()}
                    >
                      Send back to driver
                    </Button>
                  </div>
                </>
              )}

              {(rec.status === "pending_submit" ||
                rec.status === "submitting") && (
                <Button
                  className="w-full"
                  disabled={
                    submitOne.isPending || rec.status === "submitting"
                  }
                  onClick={() => submitOne.mutate()}
                >
                  {submitOne.isPending || rec.status === "submitting" ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1 h-4 w-4" />
                  )}
                  {rec.submission_error ? "Retry submit" : "Submit to state portal"}
                </Button>
              )}

              {rec.status === "submitted" && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => stateApprove.mutate()}
                    disabled={stateApprove.isPending}
                  >
                    <Check className="mr-1 h-4 w-4" /> Mark Approved by State
                  </Button>
                  <div>
                    <Label>Rejection reason</Label>
                    <Input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Why did the state reject?"
                    />
                    <Button
                      variant="destructive"
                      className="mt-2 w-full"
                      disabled={!rejectReason.trim() || stateReject.isPending}
                      onClick={() => stateReject.mutate()}
                    >
                      <X className="mr-1 h-4 w-4" /> Mark Rejected by State
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Audit trail */}
            {detail.data?.audit && detail.data.audit.length > 0 && (
              <div className="border-t pt-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Audit trail
                </div>
                <div className="space-y-2">
                  {detail.data.audit.map((a: any) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <div className="flex justify-between">
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground">
                          {formatDateTime(a.created_at)}
                        </span>
                      </div>
                      {a.notes && (
                        <div className="mt-1 text-muted-foreground">{a.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium text-muted-foreground">{children}</div>
  );
}
