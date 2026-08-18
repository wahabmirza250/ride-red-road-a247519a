import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Percent, Trash2, Wallet } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  confirmDriverPayout,
  deleteDriverPayout,
  getDriverPayoutPeriod,
  listDriverPayouts,
  listPayoutDrivers,
  setDriverPayoutPercentage,
  type PayoutDriver,
} from "@/lib/driverPayout.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/driver-pay")({
  head: () => ({
    meta: [
      { title: "Driver Pay — RedArt NEMT" },
      {
        name: "description",
        content:
          "Pay drivers a percentage of the claims the state actually paid. Pick a driver and date range, review every paid bill, then lock the payout.",
      },
      { property: "og:title", content: "Driver Pay — RedArt NEMT" },
      {
        property: "og:description",
        content: "Percentage payouts calculated from real paid Medicaid claims.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverPayPage,
});

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 13);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function DriverPayPage() {
  const qc = useQueryClient();
  const driversFn = useServerFn(listPayoutDrivers);
  const pctFn = useServerFn(setDriverPayoutPercentage);
  const periodFn = useServerFn(getDriverPayoutPeriod);
  const confirmFn = useServerFn(confirmDriverPayout);
  const historyFn = useServerFn(listDriverPayouts);
  const deleteFn = useServerFn(deleteDriverPayout);

  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState(defaultRange);
  const [overridePct, setOverridePct] = useState<string>("");
  const [confirming, setConfirming] = useState(false);

  const drivers = useQuery({ queryKey: ["payout-drivers"], queryFn: () => driversFn({}) });

  const period = useQuery({
    queryKey: ["payout-period", selected, range.from, range.to],
    enabled: !!selected,
    queryFn: () =>
      periodFn({ data: { driver_id: selected!, from: range.from, to: range.to } }),
  });

  const history = useQuery({
    queryKey: ["payout-history", selected],
    queryFn: () => historyFn({ data: selected ? { driver_id: selected } : {} }),
  });

  // Reset the per-payout override whenever the driver or range changes.
  useEffect(() => {
    setOverridePct("");
  }, [selected, range.from, range.to]);

  const savePct = useMutation({
    mutationFn: (v: { driver_id: string; payout_percentage: number | null }) =>
      pctFn({ data: v }),
    onSuccess: () => {
      toast.success("Payout percentage saved");
      qc.invalidateQueries({ queryKey: ["payout-drivers"] });
      qc.invalidateQueries({ queryKey: ["payout-period"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmPayout = useMutation({
    mutationFn: (v: { percentage: number }) =>
      confirmFn({
        data: { driver_id: selected!, from: range.from, to: range.to, percentage: v.percentage },
      }),
    onSuccess: (r) => {
      setConfirming(false);
      toast.success(`Payout of ${formatCurrency(r.payout_amount)} recorded`);
      qc.invalidateQueries({ queryKey: ["payout-period"] });
      qc.invalidateQueries({ queryKey: ["payout-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePayout = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Payout removed — its bills are payable again");
      qc.invalidateQueries({ queryKey: ["payout-period"] });
      qc.invalidateQueries({ queryKey: ["payout-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeDriver = drivers.data?.find((d) => d.driver_id === selected) ?? null;
  const effectivePct = useMemo(() => {
    if (overridePct.trim() !== "") return Number(overridePct);
    return period.data?.default_percentage ?? null;
  }, [overridePct, period.data?.default_percentage]);

  const payable = period.data?.total_payable ?? 0;
  const payout =
    effectivePct == null ? null : Math.round(((payable * effectivePct) / 100) * 100) / 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Pay"
        description="Pay drivers a percentage of the claims the state actually paid."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Driver profiles + default percentage */}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Drivers</h2>
          {drivers.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !drivers.data?.length ? (
            <p className="text-sm text-muted-foreground">No drivers yet.</p>
          ) : (
            <ul className="space-y-2">
              {drivers.data.map((d) => (
                <DriverCard
                  key={d.driver_id}
                  driver={d}
                  active={d.driver_id === selected}
                  onSelect={() => setSelected(d.driver_id)}
                  onSave={(pct) =>
                    savePct.mutate({ driver_id: d.driver_id, payout_percentage: pct })
                  }
                  saving={savePct.isPending}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          {/* Pay period calculator */}
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
              <Button variant="outline" onClick={() => setRange(defaultRange())}>
                Last 2 weeks
              </Button>
            </div>

            {!selected ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Select a driver to calculate a payout.
              </p>
            ) : period.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading paid claims…
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {/* Overlap warning */}
                {!!period.data?.overlaps.length && (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-1">
                        {period.data.overlaps.map((o) => (
                          <p key={o.id}>
                            Bills from {formatDate(o.period_start)} – {formatDate(o.period_end)}{" "}
                            were already paid out on {formatDate(o.paid_at)} (
                            {formatCurrency(o.payout_amount)}). Adjust your date range to avoid
                            double payment.
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Paid claims table */}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Member</th>
                        <th className="px-3 py-2">Claim #</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2 text-right">Paid amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!period.data?.claims.length && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                            No claims marked “Paid” for this driver in this range.
                          </td>
                        </tr>
                      )}
                      {period.data?.claims.map((c) => (
                        <tr
                          key={c.trip_id}
                          className={cn(
                            "border-t border-border",
                            c.already_paid_out && "opacity-50",
                          )}
                        >
                          <td className="px-3 py-2">{formatDate(c.trip_date ?? "")}</td>
                          <td className="px-3 py-2">{c.member_name ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.claim_id ?? "—"}</td>
                          <td className="px-3 py-2 capitalize">
                            {c.source}
                            {c.already_paid_out && " · already paid out"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(c.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals + payout math */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Paid bills in range" value={formatCurrency(period.data?.total_all ?? 0)} />
                  <Stat
                    label={`Payable now (${period.data?.payable_count ?? 0})`}
                    value={formatCurrency(payable)}
                  />
                  <Stat
                    label="Driver payout"
                    value={payout == null ? "Set a %" : formatCurrency(payout)}
                    highlight
                  />
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>Percentage for this payout</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        className="w-40 pr-8"
                        placeholder={
                          period.data?.default_percentage != null
                            ? String(period.data.default_percentage)
                            : "e.g. 40"
                        }
                        value={overridePct}
                        onChange={(e) => setOverridePct(e.target.value)}
                      />
                      <Percent className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Overrides the stored default for this payment only.
                    </p>
                  </div>
                  <Button
                    disabled={!payable || effectivePct == null}
                    onClick={() => setConfirming(true)}
                  >
                    <Wallet className="mr-1 h-4 w-4" /> Mark as paid
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Payout history{activeDriver ? ` — ${activeDriver.name}` : ""}
            </h2>
            {history.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : !history.data?.length ? (
              <p className="text-sm text-muted-foreground">No payouts recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Driver</th>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2 text-right">Billed</th>
                      <th className="px-3 py-2 text-right">%</th>
                      <th className="px-3 py-2 text-right">Paid out</th>
                      <th className="px-3 py-2">When / by</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.map((h) => (
                      <tr key={h.id} className="border-t border-border">
                        <td className="px-3 py-2">{h.driver_name}</td>
                        <td className="px-3 py-2">
                          {formatDate(h.period_start)} – {formatDate(h.period_end)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(h.total_billed)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{h.percentage_used}%</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(h.payout_amount)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(h.paid_at)}
                          {h.paid_by_name ? ` · ${h.paid_by_name}` : ""}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove payout"
                            onClick={() => removePayout.mutate(h.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm driver payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              {activeDriver?.name} · {formatDate(range.from)} – {formatDate(range.to)}
            </p>
            <p>
              {period.data?.payable_count ?? 0} paid bills · {formatCurrency(payable)} ×{" "}
              {effectivePct}% ={" "}
              <span className="font-semibold">{payout == null ? "—" : formatCurrency(payout)}</span>
            </p>
            {!!period.data?.overlaps.length && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                This range overlaps an earlier payout. Bills already paid out are excluded
                automatically, but double-check the dates.
              </p>
            )}
            <p className="text-muted-foreground">
              Every included bill is locked to this payout and can never be paid twice.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={confirmPayout.isPending || effectivePct == null}
              onClick={() => confirmPayout.mutate({ percentage: effectivePct! })}
            >
              {confirmPayout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="mr-1 h-4 w-4" /> Confirm payout
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border p-3",
        highlight && "border-primary/40 bg-primary/5",
      )}
    >
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DriverCard({
  driver,
  active,
  onSelect,
  onSave,
  saving,
}: {
  driver: PayoutDriver;
  active: boolean;
  onSelect: () => void;
  onSave: (pct: number | null) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(
    driver.payout_percentage == null ? "" : String(driver.payout_percentage),
  );
  useEffect(() => {
    setValue(driver.payout_percentage == null ? "" : String(driver.payout_percentage));
  }, [driver.payout_percentage]);

  const dirty = value !== (driver.payout_percentage == null ? "" : String(driver.payout_percentage));

  return (
    <li
      className={cn(
        "rounded-xl border p-3 transition-colors",
        active ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <p className="text-sm font-medium">{driver.name}</p>
        {driver.phone && <p className="text-xs text-muted-foreground">{driver.phone}</p>}
      </button>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            aria-label={`Payout percentage for ${driver.name}`}
            className="h-9 w-24 pr-7"
            placeholder="—"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Percent className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => onSave(value.trim() === "" ? null : Number(value))}
        >
          Save
        </Button>
      </div>
    </li>
  );
}
