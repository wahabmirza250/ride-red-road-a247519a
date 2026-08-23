import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Clock,
  Gift,
  Loader2,
  Percent,
  Search,
  Undo2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/nemt/PageHeader";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { setDriverHourlyRate, setDriverPayType } from "@/lib/driverPay.functions";
import {
  addManualHours,
  clearDriverPay,
  getPayrollPeriod,
  listPayouts,
  previewDriverPay,
  voidPayout,
  type PayrollRow,
} from "@/lib/payroll.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/payroll/")({
  head: () => ({
    meta: [
      { title: "Driver Payroll — RedArt NEMT" },
      { name: "description", content: "Admin-only payroll: review clocked hours, earnings and fuel, then clear driver payments per pay period." },
      { property: "og:title", content: "Driver Payroll — RedArt NEMT" },
      { property: "og:description", content: "Review hours, earnings and fuel, then clear driver payments per pay period." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayrollPage,
});

/** Biweekly window ending today (14 days), the default pay cycle. */
function defaultPeriod() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 13);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

export function PayrollPage({ embedded }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [range, setRange] = useState(defaultPeriod);
  const [paying, setPaying] = useState<PayrollRow | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDriver, setManualDriver] = useState<string>("");
  const [detail, setDetail] = useState<PayrollRow | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const periodFn = useServerFn(getPayrollPeriod);
  const payoutsFn = useServerFn(listPayouts);
  const delFn = useServerFn(voidPayout);

  const from = startOfDay(range.from);
  const to = endOfDay(range.to);

  const period = useQuery({
    queryKey: ["payroll-period", from, to],
    queryFn: () => periodFn({ data: { from, to } }),
  });
  const history = useQuery({
    queryKey: ["payouts"],
    queryFn: () => payoutsFn({ data: { limit: 50 } }),
  });

  const undo = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Payment voided — its hours are payable again");
      qc.invalidateQueries({ queryKey: ["payouts"] });
      qc.invalidateQueries({ queryKey: ["payroll-period"] });
      qc.invalidateQueries({ queryKey: ["payroll-preview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Every pay plan is calculated here — hourly, commission, per trip and the
  // hybrids all resolve to one payment per driver per period.
  const allRows = useMemo(() => period.data?.rows ?? [], [period.data]);
  /** A driver is "active" when something actually happened in this period. */
  const hasActivity = (r: PayrollRow) =>
    r.hours > 0 ||
    r.claim_count > 0 ||
    r.trip_count > 0 ||
    r.fuel_pending > 0 ||
    r.paid_in_period > 0 ||
    (r.outstanding ?? 0) > 0;
  const activeCount = allRows.filter(hasActivity).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allRows;
    if (!showAll && !q) list = list.filter(hasActivity);
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    return list;
  }, [allRows, search, showAll]);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const t = period.data
    ? {
        hours: round2(rows.reduce((n, r) => n + r.hours, 0)),
        gross: round2(rows.reduce((n, r) => n + (r.gross_earnings ?? 0), 0)),
        fuel: round2(rows.reduce((n, r) => n + r.fuel_pending, 0)),
        paid: round2(rows.reduce((n, r) => n + r.paid_in_period, 0)),
        outstanding: round2(rows.reduce((n, r) => n + (r.outstanding ?? 0), 0)),
      }
    : null;

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Payroll"
          description="Admin only — review clocked hours and fuel, then clear driver payments."
        />
      )}

      {/* Pay period picker */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Period start</Label>
            <Input
              type="date"
              className="w-44"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Period end</Label>
            <Input
              type="date"
              className="w-44"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
          <Button variant="outline" onClick={() => setRange(defaultPeriod())}>
            Last 2 weeks
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const to = new Date();
              const f = new Date();
              f.setDate(f.getDate() - 6);
              setRange({ from: f.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
            }}
          >
            Last week
          </Button>
          <div className="ml-auto flex items-end gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-56 pl-9"
                placeholder="Search driver"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setManualDriver("");
                setManualOpen(true);
              }}
            >
              <Clock className="mr-1.5 h-4 w-4" /> Add hours
            </Button>
          </div>
        </div>

        {t && (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Metric label="Hours" value={`${t.hours.toFixed(2)}h`} />
            <Metric label="Gross pay" value={formatCurrency(t.gross)} />
            <Metric label="Fuel pending" value={formatCurrency(t.fuel)} />
            <Metric label="Already paid" value={formatCurrency(t.paid)} />
            <Metric label="Outstanding" value={formatCurrency(t.outstanding)} highlight />
          </div>
        )}
      </div>

      {/* Driver table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Drivers in this period</h2>
            <p className="text-xs text-muted-foreground">
              Click a driver to open their pay details. Showing {rows.length} of {allRows.length}{" "}
              hourly drivers
              {!showAll && !search.trim() ? ` with activity (${activeCount})` : ""}.
            </p>
          </div>
          {!search.trim() && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show only active drivers" : `Show all ${allRows.length} drivers`}
            </Button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">Fuel</th>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Outstanding</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {period.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.driver_id}
                onClick={() => setDetail(r)}
                className="cursor-pointer border-t border-border transition-colors hover:bg-accent/50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.last_paid_at ? `Last paid ${formatDate(r.last_paid_at)}` : "Never paid"}
                    {r.open_shift && " · clocked in"}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.hourly_rate == null ? (
                    <span className="text-xs text-muted-foreground">no rate set</span>
                  ) : (
                    `${formatCurrency(r.hourly_rate)}/hr`
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{r.hours.toFixed(2)}h</td>
                <td className="px-4 py-3 tabular-nums">
                  {r.gross_earnings == null ? "—" : formatCurrency(r.gross_earnings)}
                </td>
                <td className="px-4 py-3 tabular-nums">{formatCurrency(r.fuel_pending)}</td>
                <td className="px-4 py-3 tabular-nums">{formatCurrency(r.paid_in_period)}</td>
                <td className="px-4 py-3 font-semibold tabular-nums">
                  {r.outstanding == null ? "—" : formatCurrency(r.outstanding)}
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    disabled={r.outstanding == null || r.outstanding <= 0}
                    onClick={() => setPaying(r)}
                  >
                    <Banknote className="mr-1.5 h-4 w-4" /> Clear pay
                  </Button>
                </td>
              </tr>
            ))}
            {period.data && !rows.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {search.trim()
                    ? "No driver matches that search."
                    : allRows.length
                      ? "No hourly driver recorded time in this period — use “Show all drivers”."
                      : "No hourly-paid drivers yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Payment history */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
          <Wallet className="h-4 w-4 text-primary" /> Payment history
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Method / ref</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {history.data?.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-4 py-3">{formatDateTime(p.paid_at)}</td>
                <td className="px-4 py-3">{p.driver_name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </td>
                <td className="px-4 py-3 tabular-nums">{Number(p.hours).toFixed(2)}h</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.method}
                  {p.reference ? ` · ${p.reference}` : ""}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatCurrency(Number(p.total_paid))}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={undo.isPending}
                    title="Void this payment and release its hours"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Void the ${formatCurrency(Number(p.total_paid))} payment to ${p.driver_name}? The hours and receipts it covered become payable again.`,
                        )
                      ) {
                        undo.mutate(p.id);
                      }
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {history.data && !history.data.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No payments cleared yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DriverDetailDialog
        row={detail}
        payments={(history.data ?? []).filter((p) => p.driver_id === detail?.driver_id)}
        onClose={() => setDetail(null)}
        onClearPay={(r) => {
          setDetail(null);
          setPaying(r);
        }}
        onAddHours={(r) => {
          setDetail(null);
          setManualDriver(r.driver_id);
          setManualOpen(true);
        }}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["payroll-period"] });
          qc.invalidateQueries({ queryKey: ["payout-drivers"] });
        }}
      />

      <ManualHoursDialog
        open={manualOpen}
        drivers={allRows}
        initialDriverId={manualDriver}
        onClose={() => setManualOpen(false)}
        onDone={() => {
          setManualOpen(false);
          qc.invalidateQueries({ queryKey: ["payroll-period"] });
        }}
      />

      <ClearPayDialog
        row={paying}
        from={from}
        to={to}
        onClose={() => setPaying(null)}
        onDone={() => {
          setPaying(null);
          qc.invalidateQueries({ queryKey: ["payroll-period"] });
          qc.invalidateQueries({ queryKey: ["payouts"] });
        }}
      />
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border bg-surface-muted"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ClearPayDialog({
  row,
  from,
  to,
  onClose,
  onDone,
}: {
  row: PayrollRow | null;
  from: string;
  to: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const clearFn = useServerFn(clearDriverPay);
  const previewFn = useServerFn(previewDriverPay);
  const [includeFuel, setIncludeFuel] = useState(true);
  const [method, setMethod] = useState("manual");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [bonus, setBonus] = useState("");
  const [bonusNote, setBonusNote] = useState("");

  const preview = useQuery({
    enabled: !!row,
    queryKey: ["payroll-preview", row?.driver_id, from, to],
    queryFn: () => previewFn({ data: { driver_id: row!.driver_id, from, to } }),
  });

  const bonusAmount = Number(bonus) || 0;
  const p = preview.data;
  const total =
    p?.gross_earnings == null
      ? null
      : Math.round((p.gross_earnings + (includeFuel ? p.fuel : 0) + bonusAmount) * 100) / 100;
  const blocked = (p?.already_paid?.length ?? 0) > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return;
      return clearFn({
        data: {
          driver_id: row.driver_id,
          from,
          to,
          include_fuel: includeFuel,
          bonus_amount: bonusAmount,
          bonus_note: bonusNote.trim() || null,
          method,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Payment recorded — these hours can't be paid again");
      setReference("");
      setNotes("");
      setBonus("");
      setBonusNote("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear pay — {row?.name}</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            {preview.isLoading && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculating this driver's pay…
              </div>
            )}
            {preview.error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {(preview.error as Error).message}
              </div>
            )}
            {p && (
              <>
                <div className="rounded-xl border border-border bg-surface-muted p-3 text-sm">
                  <Line label="Period" value={`${formatDate(from)} – ${formatDate(to)}`} />
                  <Line label="Unpaid hours" value={`${p.hours.toFixed(2)}h (${p.shift_count} shifts)`} />
                  <Line
                    label="Rate"
                    value={p.hourly_rate == null ? "not set" : `${formatCurrency(p.hourly_rate)}/hr`}
                  />
                  <Line label="Gross" value={p.gross_earnings == null ? "—" : formatCurrency(p.gross_earnings)} />
                  <Line
                    label="Fuel receipts pending"
                    value={`${formatCurrency(p.fuel)} (${p.receipt_count})`}
                  />
                </div>

                {p.open_shifts > 0 && (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
                    {p.open_shifts} shift{p.open_shifts > 1 ? "s are" : " is"} still running and will be paid
                    in a later period.
                  </p>
                )}
                {blocked && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                    This driver already has a payment covering this period. Void it first to pay again.
                  </p>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeFuel}
                    onChange={(e) => setIncludeFuel(e.target.checked)}
                  />
                  Include fuel reimbursement (marks those receipts reimbursed)
                </label>

                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Gift className="h-4 w-4 text-primary" /> Adjustment (bonus, or negative to deduct)
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Amount (USD)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={bonus}
                        onChange={(e) => setBonus(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Reason (optional)</Label>
                      <Input
                        value={bonusNote}
                        onChange={(e) => setBonusNote(e.target.value)}
                        placeholder="e.g. holiday bonus"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
                  <span className="text-sm text-muted-foreground">Total to pay</span>
                  <span className="text-xl font-semibold tabular-nums">
                    {total == null ? "Set an hourly rate first" : formatCurrency(total)}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Method</Label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option value="manual">Cash / manual</option>
                      <option value="zelle">Zelle</option>
                      <option value="ach">ACH / direct deposit</option>
                      <option value="check">Check</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reference (optional)</Label>
                    <Input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="check # / confirmation"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || preview.isLoading || blocked || total == null || total <= 0}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Mark as paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Manual time / overtime entry. Records real worked time that never came from
 * a clock-in (paper timesheet, approved overtime) so it counts in this
 * driver's hourly payroll exactly like a clocked shift.
 */
function ManualHoursDialog({
  open,
  drivers,
  initialDriverId,
  onClose,
  onDone,
}: {
  open: boolean;
  drivers: PayrollRow[];
  initialDriverId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const addFn = useServerFn(addManualHours);
  const [driverId, setDriverId] = useState(initialDriverId ?? "");
  useEffect(() => {
    if (open) setDriverId(initialDriverId ?? "");
  }, [open, initialDriverId]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addFn({ data: { driver_id: driverId, date, hours: Number(hours) } }),
    onSuccess: () => {
      toast.success("Hours added to this driver's payroll");
      setHours("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add manual hours / overtime</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Driver</Label>
            <select
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">Select a driver…</option>
              {drivers.map((d) => (
                <option key={d.driver_id} value={d.driver_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date worked</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hours</Label>
              <Input
                inputMode="decimal"
                placeholder="e.g. 2.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Added at the driver&apos;s current hourly rate and included in any pay period
            containing this date.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!driverId || !hours || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add hours
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-driver detail. Opens when an admin clicks a driver row: shows this
 * period's numbers, lets them fix the rate or pay type, and jumps straight
 * into adding hours or clearing pay for that one driver.
 */
function DriverDetailDialog({
  row,
  payments,
  onClose,
  onClearPay,
  onAddHours,
  onChanged,
}: {
  row: PayrollRow | null;
  payments: { id: string; paid_at: string; total_paid: number; method: string }[];
  onClose: () => void;
  onClearPay: (r: PayrollRow) => void;
  onAddHours: (r: PayrollRow) => void;
  onChanged: () => void;
}) {
  const rateFn = useServerFn(setDriverHourlyRate);
  const typeFn = useServerFn(setDriverPayType);
  const [rate, setRate] = useState("");

  useEffect(() => {
    setRate(row?.hourly_rate == null ? "" : String(row.hourly_rate));
  }, [row]);

  const saveRate = useMutation({
    mutationFn: () =>
      rateFn({ data: { driver_id: row!.driver_id, hourly_rate: Number(rate) } }),
    onSuccess: () => {
      toast.success("Hourly rate updated");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchType = useMutation({
    mutationFn: () =>
      typeFn({ data: { driver_id: row!.driver_id, pay_type: "commission" } }),
    onSuccess: () => {
      toast.success("Moved to % of paid claims");
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row?.name}</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Hours" value={`${row.hours.toFixed(2)}h`} />
              <Metric
                label="Gross"
                value={row.gross_earnings == null ? "—" : formatCurrency(row.gross_earnings)}
              />
              <Metric label="Fuel pending" value={formatCurrency(row.fuel_pending)} />
              <Metric
                label="Outstanding"
                value={row.outstanding == null ? "—" : formatCurrency(row.outstanding)}
                highlight
              />
            </div>

            <div className="rounded-xl border border-border bg-surface-muted p-3 text-sm">
              <Line label="Paid in this period" value={formatCurrency(row.paid_in_period)} />
              <Line
                label="Last payment"
                value={row.last_paid_at ? formatDate(row.last_paid_at) : "never"}
              />
              <Line label="Status" value={row.open_shift ? "Clocked in now" : row.status} />
            </div>

            <div className="space-y-1.5">
              <Label>Hourly rate (USD)</Label>
              <div className="flex gap-2">
                <Input
                  inputMode="decimal"
                  placeholder="not set"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!rate || saveRate.isPending}
                  onClick={() => saveRate.mutate()}
                >
                  {saveRate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
                </Button>
              </div>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-medium">Recent payments</h3>
              {payments.length ? (
                <ul className="space-y-1 text-sm">
                  {payments.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span className="text-muted-foreground">
                        {formatDate(p.paid_at)} · {p.method}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(p.total_paid)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No payments cleared yet.</p>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={switchType.isPending}
              onClick={() => switchType.mutate()}
            >
              <Percent className="mr-1.5 h-4 w-4" /> Switch to % of paid claims
            </Button>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => row && onAddHours(row)}>
            <Clock className="mr-1.5 h-4 w-4" /> Add hours
          </Button>
          <Button
            disabled={!row || row.outstanding == null || row.outstanding <= 0}
            onClick={() => row && onClearPay(row)}
          >
            <Wallet className="mr-1.5 h-4 w-4" /> Clear pay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
