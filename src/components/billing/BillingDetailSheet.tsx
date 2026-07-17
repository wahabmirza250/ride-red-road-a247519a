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
import { Loader2, FileDown, Check, X, AlertCircle, RefreshCw, Bot } from "lucide-react";
import { StatusPill } from "@/components/nemt/StatusPill";
import { formatDateTime } from "@/lib/format";
import {
  approveBillingRecord,
  checkRobotJobStatus,
  getBillingRecord,
  markApproved,
  markRejected,
  regenerateBillingPdf,
  requestFix,
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
  
  const markApprovedFn = useServerFn(markApproved);
  const markRejectedFn = useServerFn(markRejected);
  const regeneratePdfFn = useServerFn(regenerateBillingPdf);
  const checkRobotFn = useServerFn(checkRobotJobStatus);

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
      toast.success("Approved — automation started");
      invalidate();
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

  const regeneratePdf = useMutation({
    mutationFn: () => regeneratePdfFn({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("PDF regenerated with signature");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const checkRobot = useMutation({
    mutationFn: () => checkRobotFn({ data: { id: id! } }),
    onSuccess: (res: any) => {
      if (res?.status === "no_job") toast.message(res.message);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rec = detail.data?.record as any;
  const trip = detail.data?.trip as any;
  const rider = trip?.riders;

  const robotJobId: string | null = trip?.robot_job_id ?? null;
  const robotStatus: string | null = trip?.robot_last_status ?? null;
  const robotMessage: string | null = trip?.robot_last_message ?? null;
  const robotStartedAt: string | null = trip?.robot_job_started_at ?? null;
  const robotIsRunning =
    rec?.status === "submitting" ||
    (!!robotJobId &&
      robotStatus !== null &&
      robotStatus !== "READY_FOR_HUMAN_REVIEW" &&
      robotStatus !== "error" &&
      !String(robotStatus).startsWith("BLOCKED_"));

  // Auto-poll every 15s while a robot job is in-flight.
  useEffect(() => {
    if (!open || !id || !robotIsRunning) return;
    const t = setInterval(() => {
      checkRobot.mutate();
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, robotIsRunning]);


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
            {rec.requires_human_step && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs">
                  <div className="font-medium">
                    This portal needs a manual step to submit
                  </div>
                  <div>
                    {rec.submission_error ??
                      "The portal presented a CAPTCHA or two-factor challenge. Complete it manually in the portal, then hit Retry."}
                  </div>
                </div>
              </div>
            )}
            {rec.submission_error && !rec.requires_human_step && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs">
                  <div className="font-medium">Submission error</div>
                  <div>{rec.submission_error}</div>
                </div>
              </div>
            )}

            {robotJobId && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="text-xs">
                      <div className="flex items-center gap-2 font-medium">
                        Automation robot
                        {robotIsRunning && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        Status: <span className="font-mono">{robotStatus ?? "unknown"}</span>
                        {robotStartedAt && (
                          <> · started {formatDateTime(robotStartedAt)}</>
                        )}
                      </div>
                      {robotMessage && (
                        <div className="mt-1 text-foreground/80">{robotMessage}</div>
                      )}
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Job ID: <span className="font-mono">{robotJobId}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => checkRobot.mutate()}
                    disabled={checkRobot.isPending}
                  >
                    {checkRobot.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    <span className="ml-1">Check status</span>
                  </Button>
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
                <BlobImage
                  src={detail.data.signature_url}
                  alt="Signature"
                  className="mt-1 h-32 rounded-lg border bg-white"
                />
              </div>
            )}

            {detail.data?.pdf_url ? (
              <PdfViewer
                url={detail.data.pdf_url}
                onRegenerate={() => regeneratePdf.mutate()}
                regenerating={regeneratePdf.isPending}
                canRegenerate={!!detail.data?.signature_url}
              />
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                No stored PDF for this trip yet.
                {detail.data?.signature_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => regeneratePdf.mutate()}
                    disabled={regeneratePdf.isPending}
                  >
                    {regeneratePdf.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Regenerate PDF with signature
                  </Button>
                )}
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

/**
 * Fetch a Supabase-signed URL as a blob so ad-blockers/privacy shields
 * (which frequently drop direct requests to *.supabase.co with
 * ERR_BLOCKED_BY_CLIENT) can't intercept the render. We hand React a
 * `blob:` URL, which is never on any blocklist.
 */
function useBlobUrl(url: string | null | undefined, mime?: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setError(null);
    setBlobUrl(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const blob = await res.blob();
        return mime ? new Blob([blob], { type: mime }) : blob;
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, mime]);

  return { blobUrl, error };
}

function BlobImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const { blobUrl, error } = useBlobUrl(src);
  if (error)
    return (
      <div className={`${className ?? ""} flex items-center justify-center text-xs text-destructive`}>
        {error}
      </div>
    );
  if (!blobUrl)
    return (
      <div className={`${className ?? ""} flex items-center justify-center`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  return <img src={blobUrl} alt={alt} className={className} />;
}

function PdfViewer({
  url,
  onRegenerate,
  regenerating,
  canRegenerate,
}: {
  url: string;
  onRegenerate?: () => void;
  regenerating?: boolean;
  canRegenerate?: boolean;
}) {
  const { blobUrl, error } = useBlobUrl(url, "application/pdf");

  async function openInNewTab() {
    const win = window.open("", "_blank");
    if (blobUrl) {
      if (win) win.location.href = blobUrl;
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(
        new Blob([blob], { type: "application/pdf" }),
      );
      if (win) win.location.href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Could not open PDF");
    }
  }

  async function download() {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(
        new Blob([blob], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "state-trip-log.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download PDF");
    }
  }

  return (
    <div>
      <Label>State trip log PDF</Label>
      {error ? (
        <div className="mt-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Couldn&apos;t load the PDF ({error}). This is usually a browser
          ad-blocker or privacy extension blocking Supabase storage — try
          &quot;Open in new tab&quot; or disable the blocker for this site.
        </div>
      ) : !blobUrl ? (
        <div className="mt-1 flex h-[520px] w-full items-center justify-center rounded-lg border bg-white">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <iframe
          src={blobUrl}
          title="State trip log"
          className="mt-1 h-[520px] w-full rounded-lg border bg-white"
        />
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" onClick={openInNewTab}>
          Open in new tab
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <FileDown className="mr-1 h-4 w-4" /> Download PDF
        </Button>
        {canRegenerate && onRegenerate && (
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
            {regenerating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Regenerate signed PDF
          </Button>
        )}
      </div>
    </div>
  );
}
