import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/claimReview";
import {
  addClaimsToPayroll,
  listPayrollClaims,
  type PayrollClaimRow,
} from "@/lib/payrollItems.functions";
import {
  PAYROLL_STATUS_LABEL,
  summarizeByDriver,
  type PayrollStatus,
} from "@/lib/payrollItems";
import { SAME_DAY_WARNING } from "@/lib/sameDayBilling";
import { ManualPayrollItemDialog } from "@/components/billing/ManualPayrollItemDialog";
import {
  addManualClaimsToPayroll,
  listManualClaimTrips,
  type ManualClaimRow,
} from "@/lib/manualClaims.functions";
import { CLAIM_STATUS_OPTIONS } from "@/lib/claimsHistory.functions";

const ALL = "__all__";

function PayrollBadge({ status }: { status: PayrollStatus }) {
  const variant =
    status === "paid" ? "default" : status === "added" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="whitespace-nowrap">
      {PAYROLL_STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Claim History, organised for payroll preparation.
 * Claim status and payroll status are shown side by side and never inferred
 * from each other.
 */
export function PayrollClaimsTab({ companySlug }: { companySlug?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPayrollClaims);
  const addFn = useServerFn(addClaimsToPayroll);
  const manualListFn = useServerFn(listManualClaimTrips);
  const addManualFn = useServerFn(addManualClaimsToPayroll);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [driver, setDriver] = useState("");
  const [passenger, setPassenger] = useState("");
  const [claimStatus, setClaimStatus] = useState<string>(ALL);
  const [payrollStatus, setPayrollStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const pageSize = 50;

  const query = useQuery({
    queryKey: ["payroll_claims", { from, to, driver, passenger, claimStatus, payrollStatus, page }],
    queryFn: () =>
      listFn({
        data: {
          from: from || undefined,
          to: to || undefined,
          driver: driver || undefined,
          passenger: passenger || undefined,
          claim_status: claimStatus === ALL ? undefined : claimStatus,
          payroll_status: payrollStatus === ALL ? undefined : (payrollStatus as PayrollStatus),
          page,
          page_size: pageSize,
        },
      }) as Promise<{ rows: PayrollClaimRow[]; total: number }>,
    retry: false,
  });

  const manualQuery = useQuery({
    queryKey: ["manual_claims", { from, to }],
    queryFn: () =>
      manualListFn({ data: { from: from || undefined, to: to || undefined } }) as Promise<
        ManualClaimRow[]
      >,
    retry: false,
  });

  /** Manual trips are shown alongside portal claims and use their entered pay. */
  const manualRows = useMemo<PayrollClaimRow[]>(() => {
    const drv = driver.trim().toLowerCase();
    const term = passenger.trim().toLowerCase();
    return (manualQuery.data ?? [])
      .filter((m) => (drv ? m.driver_name.toLowerCase().includes(drv) : true))
      .filter((m) => (term ? m.passenger_name.toLowerCase().includes(term) : true))
      .filter((m) =>
        claimStatus === ALL ? true : (m.claim_status ?? "").toLowerCase() === claimStatus,
      )
      .filter((m) => (payrollStatus === ALL ? true : m.payroll_status === payrollStatus))
      .map((m) => ({
        trip_id: m.id,
        trip_date: m.service_date,
        passenger: m.passenger_name,
        medicaid_id: null,
        driver_id: m.driver_id,
        driver_name: m.driver_name,
        claim_number: m.claim_number,
        claim_status: m.claim_status,
        billed_amount: m.billed_amount,
        driver_pay_amount: m.driver_pay_amount,
        payroll_status: m.payroll_status,
        payroll_item_id: m.payroll_item_id,
        submitted_at: null,
        paid_at: null,
        source: "manual_entry" as const,
        same_day_flag: false,
      }));
  }, [manualQuery.data, driver, passenger, claimStatus, payrollStatus]);

  const manualIds = useMemo(() => new Set(manualRows.map((r) => r.trip_id)), [manualRows]);

  const rows = useMemo(
    () => [...manualRows, ...(query.data?.rows ?? [])],
    [manualRows, query.data],
  );

  const summaries = useMemo(
    () =>
      summarizeByDriver(
        rows.map((r) => ({
          driver_id: r.driver_id,
          driver_name: r.driver_name,
          claim_status: r.claim_status,
          payroll_status: r.payroll_status,
          driver_pay_amount: r.driver_pay_amount,
        })),
      ),
    [rows],
  );

  const groups = useMemo(() => {
    const m = new Map<string, PayrollClaimRow[]>();
    for (const r of rows) m.set(r.driver_name, [...(m.get(r.driver_name) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const eligible = rows.filter((r) => r.payroll_status === "not_added" && r.driver_id);

  const addMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const manual = ids.filter((id) => manualIds.has(id));
      const trips = ids.filter((id) => !manualIds.has(id));
      let added = 0;
      let skipped = 0;
      let duplicates = 0;
      if (trips.length) {
        const res = (await addFn({ data: { trip_ids: trips } })) as {
          added: number;
          skipped: number;
          duplicates: number;
        };
        added += res.added;
        skipped += res.skipped;
        duplicates += res.duplicates;
      }
      if (manual.length) {
        const res = (await addManualFn({ data: { manual_ids: manual } })) as {
          added: number;
          duplicates: number;
        };
        added += res.added;
        duplicates += res.duplicates;
      }
      return { added, skipped, duplicates };
    },
    onSuccess: (res) => {
      toast.success(
        `${res.added} claim${res.added === 1 ? "" : "s"} added to payroll` +
          (res.duplicates ? ` · ${res.duplicates} already on payroll` : "") +
          (res.skipped ? ` · ${res.skipped} skipped (no matching driver)` : ""),
      );
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["payroll_claims"] });
      void qc.invalidateQueries({ queryKey: ["payroll_items"] });
      void qc.invalidateQueries({ queryKey: ["manual_claims"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add to payroll"),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (query.isError)
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Could not load payroll claims:{" "}
        {query.error instanceof Error ? query.error.message : "unknown error"}
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        <Input placeholder="Driver" value={driver} onChange={(e) => { setDriver(e.target.value); setPage(0); }} />
        <Input placeholder="Passenger / Medicaid ID" value={passenger} onChange={(e) => { setPassenger(e.target.value); setPage(0); }} />
        <Select value={claimStatus} onValueChange={(v) => { setClaimStatus(v); setPage(0); }}>
          <SelectTrigger><SelectValue placeholder="Claim status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All claim statuses</SelectItem>
            {CLAIM_STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payrollStatus} onValueChange={(v) => { setPayrollStatus(v); setPage(0); }}>
          <SelectTrigger><SelectValue placeholder="Payroll status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payroll statuses</SelectItem>
            <SelectItem value="not_added">Not Added</SelectItem>
            <SelectItem value="added">Added to Payroll</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!selected.size || addMutation.isPending}
          onClick={() => addMutation.mutate([...selected])}
        >
          {addMutation.isPending ? "Adding…" : `Add to Payroll${selected.size ? ` (${selected.size})` : ""}`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!eligible.length}
          onClick={() => setSelected(new Set(eligible.map((r) => r.trip_id)))}
        >
          Select all eligible ({eligible.length})
        </Button>
        <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Bonus / Adjustment
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {query.data?.total ?? 0} claims · page {page + 1}
        </div>
      </div>

      {/* Per-driver summary */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {summaries.map((s) => (
          <div key={s.driver_id} className="rounded-xl border bg-card p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{s.driver_name}</div>
              {companySlug && s.driver_id && (
                <a
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                  href={`/${companySlug}/payroll-statement/${s.driver_id}?from=${from || ""}&to=${to || ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer className="mr-1 h-3.5 w-3.5" /> Print
                </a>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {s.total_claims} claims · {s.paid} paid · {s.submitted} submitted · {s.denied} denied ·{" "}
              {s.needs_attention} needs attention
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Eligible</div>
                <div className="font-semibold tabular-nums">{formatMoney(s.eligible_amount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">On payroll</div>
                <div className="font-semibold tabular-nums">{formatMoney(s.remaining_amount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Already paid</div>
                <div className="font-semibold tabular-nums">{formatMoney(s.already_paid_amount)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([name, list]) => {
            const open = !collapsed.has(name);
            return (
              <div key={name} className="overflow-hidden rounded-xl border bg-card">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      next.has(name) ? next.delete(name) : next.add(name);
                      return next;
                    })
                  }
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {list.length} claim{list.length === 1 ? "" : "s"}
                  </span>
                </button>
                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-8 p-2" />
                          <th className="p-2 text-left">Trip date</th>
                          <th className="p-2 text-left">Passenger</th>
                          <th className="p-2 text-left">Claim ID</th>
                          <th className="p-2 text-left">Claim status</th>
                          <th className="p-2 text-right">Billed</th>
                          <th className="p-2 text-right">Driver pay</th>
                          <th className="p-2 text-left">Payroll</th>
                          <th className="p-2 text-left">Submitted</th>
                          <th className="p-2 text-left">Paid</th>
                          <th className="p-2 text-left">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.trip_id} className="border-t">
                            <td className="p-2">
                              <Checkbox
                                checked={selected.has(r.trip_id)}
                                disabled={r.payroll_status !== "not_added" || !r.driver_id}
                                onCheckedChange={() => toggle(r.trip_id)}
                              />
                            </td>
                            <td className="whitespace-nowrap p-2">
                              {r.trip_date ? formatDate(r.trip_date) : "—"}
                              {r.same_day_flag && (
                                <span title={SAME_DAY_WARNING}>
                                  <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-500" />
                                </span>
                              )}
                            </td>
                            <td className="p-2">{r.passenger ?? "—"}</td>
                            <td className="p-2 font-mono text-xs">{r.claim_number ?? "—"}</td>
                            <td className="p-2">{r.claim_status ?? "—"}</td>
                            <td className="p-2 text-right tabular-nums">
                              {r.billed_amount == null ? "—" : formatMoney(r.billed_amount)}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {r.driver_pay_amount == null ? "—" : formatMoney(r.driver_pay_amount)}
                            </td>
                            <td className="p-2">
                              <PayrollBadge status={r.payroll_status} />
                            </td>
                            <td className="whitespace-nowrap p-2">
                              {r.submitted_at ? formatDate(r.submitted_at) : "—"}
                            </td>
                            <td className="whitespace-nowrap p-2">
                              {r.paid_at ? formatDate(r.paid_at) : "—"}
                            </td>
                            <td className="p-2">
                              {r.source === "manual_entry" ? (
                                <Badge variant="outline">MANUAL</Badge>
                              ) : r.source === "manual" ? (
                                <Badge variant="secondary">PAPER</Badge>
                              ) : r.source === "resubmission" ? (
                                <Badge variant="secondary">RESUBMISSION</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">System</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {!groups.length && (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No claims match these filters.
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * pageSize >= (query.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      <ManualPayrollItemDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}
