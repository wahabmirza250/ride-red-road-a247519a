import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2, Plus, Receipt, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteSubscriptionPayment,
  getSubscriptionOverview,
  recordSubscriptionPayment,
  upsertCompanySubscription,
} from "@/lib/owner.functions";

type Overview = Awaited<ReturnType<typeof getSubscriptionOverview>>;
type Row = Overview["rows"][number];

const STATUS_LABEL: Record<string, string> = {
  none: "No plan",
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  trial: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  past_due: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  cancelled: "bg-destructive/15 text-destructive",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Owner-only view of what every company pays the platform: plan, monthly
 * price, renewal date and the log of payments actually collected.
 */
export function SubscriptionsPanel() {
  const load = useServerFn(getSubscriptionOverview);
  const savePlan = useServerFn(upsertCompanySubscription);
  const addPayment = useServerFn(recordSubscriptionPayment);
  const delPayment = useServerFn(deleteSubscriptionPayment);

  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [planFor, setPlanFor] = useState<Row | null>(null);
  const [payFor, setPayFor] = useState<Row | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [plan, setPlan] = useState({
    plan_name: "Standard",
    monthly_price: "0",
    status: "active",
    renews_on: "",
    notes: "",
  });
  const [payment, setPayment] = useState({
    amount: "",
    paid_on: new Date().toISOString().slice(0, 10),
    method: "bank_transfer",
    reference: "",
  });

  const reload = useCallback(async () => {
    const res = await load({ data: {} });
    setData(res);
  }, [load]);

  useEffect(() => {
    void reload().catch((err) =>
      toast.error(err instanceof Error ? err.message : "Could not load subscriptions"),
    );
  }, [reload]);

  const totals = data?.totals;
  const rows = useMemo(() => data?.rows ?? [], [data]);

  function openPlan(row: Row) {
    setPlan({
      plan_name: row.plan_name ?? "Standard",
      monthly_price: String(row.monthly_price ?? 0),
      status: row.status === "none" ? "active" : row.status,
      renews_on: row.renews_on ?? "",
      notes: row.notes ?? "",
    });
    setPlanFor(row);
  }

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!planFor) return;
    setBusy(true);
    try {
      await savePlan({
        data: {
          company_id: planFor.company_id,
          plan_name: plan.plan_name,
          monthly_price: plan.monthly_price,
          status: plan.status,
          renews_on: plan.renews_on || null,
          notes: plan.notes || null,
        },
      });
      toast.success(`Plan saved for ${planFor.company_name}`);
      setPlanFor(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the plan");
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    setBusy(true);
    try {
      await addPayment({
        data: {
          company_id: payFor.company_id,
          amount: payment.amount,
          paid_on: payment.paid_on,
          method: payment.method,
          reference: payment.reference || null,
        },
      });
      toast.success(`Payment recorded for ${payFor.company_name}`);
      setPayFor(null);
      setPayment({
        amount: "",
        paid_on: new Date().toISOString().slice(0, 10),
        method: "bank_transfer",
        reference: "",
      });
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  }

  async function removePayment(id: string) {
    if (!window.confirm("Delete this payment record?")) return;
    setBusy(true);
    try {
      await delPayment({ data: { payment_id: id } });
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete that payment");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Monthly recurring", value: money(totals?.mrr ?? 0), icon: TrendingUp },
          { label: "Annual run rate", value: money(totals?.arr ?? 0), icon: TrendingUp },
          { label: "Collected this month", value: money(totals?.collected_this_month ?? 0), icon: Receipt },
          { label: "Paying companies", value: String(totals?.paying_companies ?? 0), icon: CreditCard },
        ].map((c) => (
          <div key={c.label} className="rounded-3xl border border-border bg-surface p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" /> {c.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.company_id} className="rounded-3xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{row.company_name}</p>
                <p className="text-xs text-muted-foreground">
                  /{row.url_slug} · {row.plan_name ?? "No plan set"} ·{" "}
                  {row.monthly_price ? `${money(row.monthly_price)}/mo` : "—"}
                  {row.renews_on ? ` · renews ${row.renews_on}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    STATUS_STYLE[row.status] ?? STATUS_STYLE.none
                  }`}
                >
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  collected {money(row.collected)}
                </span>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => openPlan(row)}>
                  Edit plan
                </Button>
                <Button size="sm" className="rounded-full" onClick={() => setPayFor(row)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Payment
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setExpanded(expanded === row.company_id ? null : row.company_id)}
                >
                  {row.payments.length} payment{row.payments.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>

            {expanded === row.company_id && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                {row.payments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
                ) : (
                  row.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{money(p.amount)}</span>
                      <span className="text-muted-foreground">
                        {p.paid_on} · {p.method.replace(/_/g, " ")}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-full text-destructive"
                        disabled={busy}
                        onClick={() => removePayment(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={Boolean(planFor)} onOpenChange={(v) => !v && setPlanFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Subscription — {planFor?.company_name}</DialogTitle>
            <DialogDescription>What this company pays you for the platform.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPlan} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pl-name">Plan name</Label>
                <Input
                  id="pl-name"
                  value={plan.plan_name}
                  onChange={(e) => setPlan({ ...plan, plan_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-price">Monthly price (USD)</Label>
                <Input
                  id="pl-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={plan.monthly_price}
                  onChange={(e) => setPlan({ ...plan, monthly_price: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={plan.status} onValueChange={(v) => setPlan({ ...plan, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["trial", "active", "past_due", "cancelled"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-renew">Renews on</Label>
                <Input
                  id="pl-renew"
                  type="date"
                  value={plan.renews_on}
                  onChange={(e) => setPlan({ ...plan, renews_on: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-notes">Notes</Label>
              <Textarea
                id="pl-notes"
                rows={2}
                value={plan.notes}
                onChange={(e) => setPlan({ ...plan, notes: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="rounded-full" disabled={busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payFor)} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment — {payFor?.company_name}</DialogTitle>
            <DialogDescription>Log a subscription payment you have received.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPayment} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amt">Amount (USD)</Label>
                <Input
                  id="pay-amt"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payment.amount}
                  onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-date">Paid on</Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={payment.paid_on}
                  onChange={(e) => setPayment({ ...payment, paid_on: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={payment.method} onValueChange={(v) => setPayment({ ...payment, method: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["bank_transfer", "card", "cash", "check", "other"].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Reference</Label>
                <Input
                  id="pay-ref"
                  value={payment.reference}
                  onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="rounded-full" disabled={busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Record payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
