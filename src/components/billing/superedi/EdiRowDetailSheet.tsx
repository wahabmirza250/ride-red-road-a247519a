/**
 * One claim, opened from Batch Review so a biller can fix a bad row without
 * losing the rest of the selection. Read-only apart from a re-validate action.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getEdiTripDetail } from "@/lib/ediRecords.functions";
import { ediValidateSelection } from "@/lib/ediBulk.functions";
import { ediValidationIssues } from "@/lib/edi";
import { readEdiLongDistance } from "@/lib/ediLongDistance";
import { ediFeedSections } from "@/lib/ediStatusFeed";
import type { EdiWorkRow } from "@/lib/ediTypes";
import {
  DetailRow,
  FeedSections,
  LongDistancePill,
  Panel,
  dateText,
  dateTimeText,
  moneyText,
} from "./ediUi";

export function EdiRowDetailSheet({
  companyId,
  recordId,
  onClose,
  onRowsUpdated,
}: {
  companyId: string | null;
  recordId: string | null;
  onClose: () => void;
  onRowsUpdated: (rows: EdiWorkRow[]) => void;
}) {
  const detailFn = useServerFn(getEdiTripDetail);
  const validateFn = useServerFn(ediValidateSelection);

  const detail = useQuery({
    queryKey: ["edi", "detail", companyId, recordId],
    enabled: !!recordId,
    queryFn: () => detailFn({ data: { company_id: companyId, record_id: recordId! } }),
  });

  const revalidate = useMutation({
    mutationFn: () => validateFn({ data: { company_id: companyId, record_ids: [recordId!] } }),
    onSuccess: (res) => {
      onRowsUpdated(res.rows);
      void detail.refetch();
      const outcome = res.results[0];
      if (outcome?.ready) toast.success("Backend says this claim is ready.");
      else toast.message(outcome?.message ?? "Still not ready — see the issues below.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Validation failed"),
  });

  const d = detail.data ?? null;
  const validation = parse(d?.edi.edi_validation_json ?? null);
  const statusPayload = parse(d?.edi.edi_status_detail_json ?? null);
  const issues = validation ? ediValidationIssues(validation) : [];
  const longDistance = readEdiLongDistance(validation, statusPayload);
  const feed = ediFeedSections(statusPayload);

  return (
    <Sheet open={!!recordId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{d?.member.name ?? "Claim detail"}</SheetTitle>
          <SheetDescription>
            {d ? `${d.member.medicaid_id ?? "No Medicaid ID"} · ${dateText(d.trip.service_date)}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading claim…
          </div>
        ) : !d ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            This bill is no longer available.
          </p>
        ) : (
          <div className="mt-4 space-y-4 pb-10">
            <Panel title="Member & trip">
              <dl className="space-y-1.5">
                <DetailRow label="Medicaid ID" value={d.member.medicaid_id} />
                <DetailRow label="Date of birth" value={dateText(d.member.dob)} />
                <DetailRow label="Service date" value={dateText(d.trip.service_date)} />
                <DetailRow label="Vehicle" value={d.trip.vehicle_type} />
                <DetailRow label="Trip type" value={d.trip.trip_kind} />
                <DetailRow label="Miles" value={`${d.trip.miles.toFixed(1)} mi (${d.trip.leg_count} leg(s))`} />
                <DetailRow label="Pickup" value={d.trip.pickup_address} />
                <DetailRow label="Drop-off" value={d.trip.dropoff_address} />
                <DetailRow
                  label="Signed form"
                  value={d.trip.has_signed_form ? "On file" : "Not on file"}
                />
              </dl>
            </Panel>

            <Panel title="Service lines">
              <ul className="divide-y divide-border text-sm">
                {d.lines.map((line, i) => (
                  <li key={`${line.label}-${i}`} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-foreground">{line.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.procedure_code ?? "no code"}
                        {line.modifiers.length ? ` · ${line.modifiers.join(", ")}` : ""} ·{" "}
                        {line.units} {line.unit_word} @ {moneyText(line.rate)}
                      </div>
                    </div>
                    <div className="shrink-0 font-medium tabular-nums text-foreground">
                      {moneyText(line.amount)}
                    </div>
                  </li>
                ))}
                {d.lines.length === 0 && (
                  <li className="py-2 text-muted-foreground">No priced service line yet.</li>
                )}
              </ul>
              <Separator className="my-3" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Diagnosis {d.diagnosis_code ?? "—"}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {moneyText(d.total_charge)}
                </span>
              </div>
              {d.missing_rates.length > 0 && (
                <p className="mt-2 text-xs text-warning">
                  Missing rate for: {d.missing_rates.join(", ")}
                </p>
              )}
            </Panel>

            <Panel
              title="Backend readiness"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={revalidate.isPending}
                  onClick={() => revalidate.mutate()}
                >
                  {revalidate.isPending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  )}
                  Re-validate
                </Button>
              }
            >
              <dl className="space-y-1.5">
                <DetailRow label="EDI claim" value={d.edi.edi_claim_id ? `#${d.edi.edi_claim_id}` : "Not created"} />
                <DetailRow label="Batch" value={d.edi.edi_batch_id ? `#${d.edi.edi_batch_id}` : "—"} />
                <DetailRow label="837P file" value={d.edi.edi_file_id ? `#${d.edi.edi_file_id}` : "—"} />
                <DetailRow label="Backend status" value={d.edi.edi_status} />
                <DetailRow label="Environment" value={(d.edi.edi_environment ?? "test").toUpperCase()} />
                <DetailRow label="Last sync" value={dateTimeText(d.edi.edi_last_sync_at)} />
                <DetailRow label="Documents" value={<LongDistancePill value={longDistance} />} />
              </dl>

              {d.edi.edi_last_error && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{d.edi.edi_last_error}</span>
                </p>
              )}

              {issues.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {issues.map((issue, i) => (
                    <li
                      key={`${issue.message}-${i}`}
                      className={
                        issue.severity === "error"
                          ? "rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-destructive"
                          : "rounded-lg border border-warning/40 bg-warning/10 p-2 text-warning"
                      }
                    >
                      {issue.code ? <strong className="mr-1">{issue.code}</strong> : null}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              {d.missing_rates.length === 0 && issues.length === 0 && !d.edi.edi_last_error && (
                <p className="mt-3 text-xs text-muted-foreground">
                  No backend validation issues on record.
                </p>
              )}
            </Panel>

            <Panel title="Acknowledgements & remittance">
              <FeedSections sections={feed} />
            </Panel>

            <Panel title="Billing provider">
              <dl className="space-y-1.5">
                <DetailRow label="Name" value={d.provider.billing_name} />
                <DetailRow label="NPI" value={d.provider.npi} />
                <DetailRow label="Taxonomy" value={d.provider.taxonomy_code} />
                <DetailRow
                  label="Address"
                  value={[d.provider.address_line1, d.provider.city, d.provider.state, d.provider.postal_code]
                    .filter(Boolean)
                    .join(", ")}
                />
                <DetailRow label="Sender / receiver" value={
                  d.provider.sender_id || d.provider.receiver_id
                    ? `${d.provider.sender_id ?? "—"} → ${d.provider.receiver_id ?? "—"}`
                    : null
                } />
              </dl>
            </Panel>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function parse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
