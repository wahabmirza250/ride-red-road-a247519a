import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FileDown, Check, X, Send } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { generateStateFormPdf } from "@/lib/medicaidPdf";

export const Route = createFileRoute("/_authenticated/medicaid-billing")({
  component: MedicaidBillingPage,
});

const STATUSES = ["pending_review", "approved", "submitted", "rejected", "needs_fix"] as const;

function MedicaidBillingPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending_review");
  const [selected, setSelected] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sigUrl, setSigUrl] = useState<string | null>(null);

  const trips = useQuery({
    queryKey: ["medicaid_billing", status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicaid_trips")
        .select(
          "*, riders(full_name, medicaid_id, dob, phone, address), profiles!medicaid_trips_driver_id_fkey(first_name, last_name)",
        )
        .eq("status", status)
        .order("pickup_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("medicaid_trips_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "medicaid_trips" },
        () => qc.invalidateQueries({ queryKey: ["medicaid_billing"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // Load signature URL
  useEffect(() => {
    if (!selected?.signature_path) {
      setSigUrl(null);
      return;
    }
    supabase.storage
      .from("signatures")
      .createSignedUrl(selected.signature_path, 300)
      .then(({ data }) => setSigUrl(data?.signedUrl ?? null));
  }, [selected]);

  const review = useMutation({
    mutationFn: async (payload: { id: string; status: string; notes?: string }) => {
      const { error } = await supabase
        .from("medicaid_trips")
        .update({
          status: payload.status as any,
          review_notes: payload.notes ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["medicaid_billing"] });
      setSelected(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markSubmitted = useMutation({
    mutationFn: async ({ id, conf }: { id: string; conf: string }) => {
      const { error } = await supabase
        .from("medicaid_trips")
        .update({
          status: "submitted" as any,
          submitted_confirmation: conf,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as submitted to state");
      qc.invalidateQueries({ queryKey: ["medicaid_billing"] });
      setSelected(null);
      setConfirmation("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function downloadPdf(trip: any) {
    try {
      const pdfBytes = await generateStateFormPdf({
        rider: trip.riders,
        driverName: trip.profiles
          ? `${trip.profiles.first_name ?? ""} ${trip.profiles.last_name ?? ""}`.trim()
          : "",
        pickupAt: trip.pickup_at,
        pickupAddress: trip.pickup_address,
        dropoffAddress: trip.dropoff_address,
        odometerStart: trip.odometer_start,
        odometerEnd: trip.odometer_end,
        miles: trip.miles,
        signatureName: trip.signature_name,
        signatureUrl: sigUrl,
      });
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medicaid-trip-${trip.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message ?? "PDF failed");
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Admins only.</div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicaid Billing"
        description="Review driver-submitted trips, export the state form, and record submission"
      />

      <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
        <TabsList className="flex-wrap">
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s.replace("_", " ")}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {trips.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !trips.data?.length ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No trips in this queue.
        </div>
      ) : (
        <div className="grid gap-3">
          {trips.data.map((t: any) => (
            <button
              key={t.id}
              onClick={() => {
                setSelected(t);
                setReviewNotes(t.review_notes ?? "");
              }}
              className="rounded-2xl border border-border bg-surface p-4 text-left shadow-soft hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {t.riders?.full_name}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {t.riders?.medicaid_id}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Driver: {t.profiles?.first_name} {t.profiles?.last_name} ·{" "}
                    {formatDateTime(t.pickup_at)} · {t.miles} mi
                  </div>
                </div>
                <StatusPill status={t.status} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Trip review</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Rider" value={selected.riders?.full_name} />
                  <Field label="Medicaid ID" value={selected.riders?.medicaid_id} />
                  <Field label="DOB" value={selected.riders?.dob} />
                  <Field label="Phone" value={selected.riders?.phone} />
                  <Field
                    label="Driver"
                    value={`${selected.profiles?.first_name ?? ""} ${selected.profiles?.last_name ?? ""}`}
                  />
                  <Field label="Pickup" value={formatDateTime(selected.pickup_at)} />
                  <Field label="Odometer start" value={selected.odometer_start} />
                  <Field label="Odometer end" value={selected.odometer_end} />
                  <Field label="Miles" value={selected.miles} />
                  <Field label="Status" value={selected.status} />
                </div>
                <Field label="Pickup address" value={selected.pickup_address} />
                <Field label="Drop-off address" value={selected.dropoff_address} />

                {sigUrl && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Rider signature ({selected.signature_name})
                    </div>
                    <img
                      src={sigUrl}
                      alt="Signature"
                      className="mt-1 h-32 rounded-lg border bg-white"
                    />
                  </div>
                )}

                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Review notes
                  </div>
                  <Textarea
                    rows={2}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Optional notes for the driver"
                  />
                </div>

                {selected.status === "approved" && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs font-medium">
                      Submit to Colorado state
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Download the PDF, upload it on the state portal, then paste
                      the confirmation number here.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Input
                        placeholder="Confirmation #"
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          markSubmitted.mutate({
                            id: selected.id,
                            conf: confirmation,
                          })
                        }
                        disabled={!confirmation || markSubmitted.isPending}
                      >
                        <Send className="mr-1 h-4 w-4" /> Mark submitted
                      </Button>
                    </div>
                  </div>
                )}

                {selected.submitted_confirmation && (
                  <Field
                    label="Submitted"
                    value={`${selected.submitted_confirmation} · ${formatDateTime(selected.submitted_at)}`}
                  />
                )}
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadPdf(selected)}
                >
                  <FileDown className="mr-1 h-4 w-4" /> Download PDF
                </Button>
                {selected.status !== "approved" && selected.status !== "submitted" && (
                  <Button
                    onClick={() =>
                      review.mutate({
                        id: selected.id,
                        status: "approved",
                        notes: reviewNotes,
                      })
                    }
                    disabled={review.isPending}
                  >
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                )}
                {selected.status !== "needs_fix" && selected.status !== "submitted" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      review.mutate({
                        id: selected.id,
                        status: "needs_fix",
                        notes: reviewNotes,
                      })
                    }
                  >
                    Request fix
                  </Button>
                )}
                {selected.status !== "rejected" && selected.status !== "submitted" && (
                  <Button
                    variant="destructive"
                    onClick={() =>
                      review.mutate({
                        id: selected.id,
                        status: "rejected",
                        notes: reviewNotes,
                      })
                    }
                  >
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}
