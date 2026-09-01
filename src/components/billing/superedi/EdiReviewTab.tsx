/**
 * Review Billing — everything a biller must confirm before an 837P exists.
 * Readiness comes from the EDI backend's `ready` field, never from local guesses.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEdiTripDetail, saveEdiClaimState } from "@/lib/ediBilling.functions";
import { createEdiClaim, validateEdiClaim } from "@/lib/edi.functions";
import { ediIsValid, ediValidationIssues } from "@/lib/edi";
import { buildEdiClaimPayload, localClaimBlockers } from "@/lib/ediPayload";
import type { EdiEnvironment } from "@/lib/ediSetup";

export function EdiReviewTab({
  recordId,
  environment,
  onValidated,
}: {
  recordId: string | null;
  environment: EdiEnvironment;
  onValidated?: () => void;
}) {
  const detailFn = useServerFn(getEdiTripDetail);
  const saveFn = useServerFn(saveEdiClaimState);
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["edi_trip_detail", recordId],
    queryFn: () => detailFn({ data: { record_id: recordId! } }),
    enabled: !!recordId,
  });

  const validate = useMutation({
    mutationFn: async () => {
      const d = detail.data!;
      let claimId = d.edi.edi_claim_id;
      if (!claimId) {
        const created = await createEdiClaim(
          buildEdiClaimPayload(d, environment) as unknown as Record<string, unknown>,
        );
        if (!created.ok) throw new Error(created.error);
        claimId = Number(created.data?.id ?? 0) || null;
        if (!claimId) throw new Error("EDI backend did not return a claim id");
      }
      const res = await validateEdiClaim(claimId);
      if (!res.ok) {
        await saveFn({
          data: { record_id: d.record_id, edi_claim_id: claimId, edi_last_error: res.error },
        });
        throw new Error(res.error);
      }
      await saveFn({
        data: {
          record_id: d.record_id,
          edi_claim_id: claimId,
          edi_status: ediIsValid(res.data) ? "validated" : "validation_failed",
          edi_validation: res.data as Record<string, unknown>,
          edi_last_error: null,
        },
      });
      return res.data;
    },
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ["edi_trip_detail", recordId] });
      if (ediIsValid(v)) {
        toast.success("Validated — ready for 837P generation");
        onValidated?.();
      } else {
        toast.warning("Backend says this claim is not ready yet");
      }
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "EDI validation failed"),
  });

  if (!recordId) {
    return <Empty>Select a trip in Upload / Import to review it here.</Empty>;
  }
  if (detail.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Empty>
        {detail.error instanceof Error ? detail.error.message : "Could not load this trip."}
      </Empty>
    );
  }

  const d = detail.data;
  const blockers = localClaimBlockers(d);
  const validation = d.edi.edi_validation_json
    ? (JSON.parse(d.edi.edi_validation_json) as Record<string, unknown>)
    : null;
  const ready = validation ? ediIsValid(validation) === true : false;
  const messages = validation ? ediValidationIssues(validation).map((i) => i.message) : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Member">
          <Row label="Name" value={d.member.name} />
          <Row label="Medicaid ID" value={d.member.medicaid_id} />
          <Row label="Date of birth" value={d.member.dob} />
          <Row label="Address" value={d.member.address} />
          <Row label="Phone" value={d.member.phone} />
        </Panel>

        <Panel title="Trip">
          <Row
            label="Service date"
            value={
              d.trip.service_date ? new Date(d.trip.service_date).toLocaleDateString() : null
            }
          />
          <Row label="Trip kind" value={d.trip.trip_kind} />
          <Row label="Vehicle" value={d.trip.vehicle_type} />
          <Row label="Pickup" value={d.trip.pickup_address} />
          <Row label="Drop-off" value={d.trip.dropoff_address} />
          <Row label="Miles" value={String(d.trip.miles)} />
          <Row label="Long distance" value={d.trip.long_distance ? "Yes (>50 mi)" : "No"} />
          <Row label="Signed form on file" value={d.trip.has_signed_form ? "Yes" : "No"} />
        </Panel>

        <Panel title="Provider">
          <Row label="Billing name" value={d.provider.billing_name} />
          <Row label="NPI" value={d.provider.npi} />
          <Row label="Taxonomy" value={d.provider.taxonomy_code} />
          <Row label="Diagnosis" value={d.diagnosis_code} />
        </Panel>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Service lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2">Line</th>
                <th className="pb-2">Procedure</th>
                <th className="pb-2">Modifiers</th>
                <th className="pb-2 text-right">Units</th>
                <th className="pb-2 text-right">Rate</th>
                <th className="pb-2 text-right">Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2">{l.label}</td>
                  <td className="py-2 font-mono text-xs">{l.procedure_code ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">
                    {l.modifiers.length ? l.modifiers.join(", ") : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.units}</td>
                  <td className="py-2 text-right tabular-nums">${l.rate.toFixed(2)}</td>
                  <td className="py-2 text-right tabular-nums">${l.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-3 text-right text-xs uppercase text-muted-foreground">
                  Total charge
                </td>
                <td className="pt-3 text-right text-base font-semibold tabular-nums">
                  ${d.total_charge.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {(blockers.length > 0 || messages.length > 0) && (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Validation issues
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
            {messages.map((m: string, i: number) => (
              <li key={`v${i}`}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="rounded-full"
          onClick={() => validate.mutate()}
          disabled={validate.isPending || blockers.length > 0}
        >
          {validate.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileCheck2 className="mr-2 h-4 w-4" />
          )}
          {d.edi.edi_claim_id ? "Validate EDI claim" : "Create EDI claim & validate"}
        </Button>
        {ready ? (
          <Badge className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Ready for 837P generation
          </Badge>
        ) : (
          <Badge variant="outline">Not ready — backend validation required</Badge>
        )}
        {d.edi.edi_claim_id && (
          <span className="text-xs text-muted-foreground">EDI claim #{d.edi.edi_claim_id}</span>
        )}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value || "—"}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
