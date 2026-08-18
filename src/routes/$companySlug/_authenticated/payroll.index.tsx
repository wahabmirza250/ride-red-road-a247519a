import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Banknote, CheckCircle2, Loader2, Undo2, Wallet } from "lucide-react";
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
import {
  clearDriverPay,
  deletePayout,
  getPayrollPeriod,
  listPayouts,
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

export function PayrollPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState(defaultPeriod);
  const [paying, setPaying] = useState<PayrollRow | null>(null);

  const periodFn = useServerFn(getPayrollPeriod);
  const payoutsFn = useServerFn(listPayouts);
  const delFn = useServerFn(deletePayout);

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
      toast.success("Payment entry removed");
      qc.invalidateQueries({ queryKey: ["payouts"] });
      qc.invalidateQueries({ queryKey: ["payroll-period"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = period.data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Admin only — review clocked hours and fuel, then clear driver payments."
      />

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
            {period.data?.rows.map((r) => (
              <tr key={r.driver_id} className="border-t border-border">
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
                <td className="px-4 py-3 text-right">
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
            {period.data && !period.data.rows.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No drivers yet.
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
                  <Button size="sm" variant="ghost" onClick={() => undo.mutate(p.id)}>
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
  const [amount, setAmount] = useState<string | null>(null);
  const [includeFuel, setIncludeFuel] = useState(true);
  const [method, setMethod] = useState("manual");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const suggested = useMemo(() => {
    if (!row) return 0;
    const gross = (row.gross_earnings ?? 0) - row.paid_in_period;
    return Math.max(0, Math.round((gross + (includeFuel ? row.fuel_pending : 0)) * 100) / 100);
  }, [row, includeFuel]);

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const total = amount === null || amount.trim() === "" ? suggested : Number(amount);
      if (!Number.isFinite(total) || total < 0) throw new Error("Enter a valid amount");
      return clearFn({
        data: {
          driver_id: row.driver_id,
          from,
          to,
          hours: row.hours,
          hourly_rate: row.hourly_rate,
          gross_earnings: row.gross_earnings ?? 0,
          fuel_reimbursed: includeFuel ? row.fuel_pending : 0,
          total_paid: total,
          method,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Payment cleared");
      setAmount(null);
      setReference("");
      setNotes("");
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
            <div className="rounded-xl border border-border bg-surface-muted p-3 text-sm">
              <Line label="Period" value={`${formatDate(from)} – ${formatDate(to)}`} />
              <Line label="Hours" value={`${row.hours.toFixed(2)}h`} />
              <Line
                label="Rate"
                value={row.hourly_rate == null ? "not set" : `${formatCurrency(row.hourly_rate)}/hr`}
              />
              <Line
                label="Gross"
                value={row.gross_earnings == null ? "—" : formatCurrency(row.gross_earnings)}
              />
              <Line label="Already paid" value={formatCurrency(row.paid_in_period)} />
              <Line label="Fuel receipts pending" value={formatCurrency(row.fuel_pending)} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeFuel}
                onChange={(e) => setIncludeFuel(e.target.checked)}
              />
              Include fuel reimbursement (marks those receipts reimbursed)
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount to pay (USD)</Label>
                <Input
                  inputMode="decimal"
                  value={amount ?? String(suggested)}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
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
            </div>

            <div className="space-y-1.5">
              <Label>Reference (optional)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="check # / confirmation" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
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
