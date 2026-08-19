import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDriverPay,
  setDriverHourlyRate,
  setDriverPayType,
  getDriverEarnings,
} from "@/lib/driverPay.functions";
import { getDriverPayoutPeriod, setDriverPayoutPercentage } from "@/lib/driverPayout.functions";
import { resetDriverPassword } from "@/lib/admin.functions";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function dayString(iso: string) {
  return iso.slice(0, 10);
}

/** ADMIN ONLY. Never render this inside any dispatch-accessible surface. */
export function DriverPayPanel({ driverId }: { driverId: string }) {
  const qc = useQueryClient();
  const payFn = useServerFn(getDriverPay);
  const saveFn = useServerFn(setDriverHourlyRate);
  const earnFn = useServerFn(getDriverEarnings);
  const payTypeFn = useServerFn(setDriverPayType);
  const periodFn = useServerFn(getDriverPayoutPeriod);
  const pctFn = useServerFn(setDriverPayoutPercentage);
  const resetFn = useServerFn(resetDriverPassword);
  const [newPassword, setNewPassword] = useState("");
  const [days, setDays] = useState(14);
  const [rate, setRate] = useState<string | null>(null);
  const [pct, setPct] = useState<string | null>(null);

  const pay = useQuery({
    queryKey: ["driver-pay", driverId],
    queryFn: () => payFn({ data: { driver_id: driverId } }),
  });
  const payType = pay.data?.pay_type ?? "per_hour";

  const from = isoDaysAgo(days);
  const to = new Date().toISOString();

  const earnings = useQuery({
    queryKey: ["driver-earnings", driverId, days],
    queryFn: () => earnFn({ data: { driver_id: driverId, from, to } }),
    enabled: payType === "per_hour",
  });

  const claims = useQuery({
    queryKey: ["driver-claim-period", driverId, days],
    queryFn: () =>
      periodFn({ data: { driver_id: driverId, from: dayString(from), to: dayString(to) } }),
    enabled: payType === "commission",
  });

  const save = useMutation({
    mutationFn: async () => {
      const v = rate === null ? null : rate.trim() === "" ? null : Number(rate);
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error("Enter a valid rate");
      return saveFn({ data: { driver_id: driverId, hourly_rate: v } });
    },
    onSuccess: () => {
      toast.success("Hourly rate saved");
      setRate(null);
      qc.invalidateQueries({ queryKey: ["driver-pay", driverId] });
      qc.invalidateQueries({ queryKey: ["driver-earnings", driverId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePct = useMutation({
    mutationFn: async () => {
      const v = pct === null ? null : pct.trim() === "" ? null : Number(pct);
      if (v != null && (!Number.isFinite(v) || v < 0 || v > 100)) {
        throw new Error("Enter a percentage between 0 and 100");
      }
      return pctFn({ data: { driver_id: driverId, payout_percentage: v } });
    },
    onSuccess: () => {
      toast.success("Payout percentage saved");
      setPct(null);
      qc.invalidateQueries({ queryKey: ["driver-claim-period", driverId] });
      qc.invalidateQueries({ queryKey: ["payout-drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePayType = useMutation({
    mutationFn: (pay_type: "per_hour" | "commission") =>
      payTypeFn({ data: { driver_id: driverId, pay_type } }),
    onSuccess: () => {
      toast.success("Pay type updated");
      qc.invalidateQueries({ queryKey: ["driver-pay", driverId] });
      qc.invalidateQueries({ queryKey: ["payroll-period"] });
      qc.invalidateQueries({ queryKey: ["payout-drivers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: () => resetFn({ data: { driver_id: driverId, password: newPassword } }),
    onSuccess: () => {
      toast.success("Password reset — share the new password with the driver");
      setNewPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentRate = pay.data?.hourly_rate ?? null;
  const rateValue = rate ?? (currentRate == null ? "" : String(currentRate));
  const currentPct = claims.data?.default_percentage ?? null;
  const pctValue = pct ?? (currentPct == null ? "" : String(currentPct));
  const e = earnings.data;
  const c = claims.data;
  const estimate =
    c && currentPct != null ? Math.round(((c.total_payable * currentPct) / 100) * 100) / 100 : null;

  const periodPicker = (
    <div className="mt-4 flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Pay period:</span>
      {[7, 14, 30].map((d) => (
        <button
          key={d}
          onClick={() => setDays(d)}
          className={`rounded-full border px-2.5 py-1 ${
            days === d
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          Last {d}d
        </button>
      ))}
    </div>
  );

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <DollarSign className="h-3.5 w-3.5" /> Pay &amp; earnings — admin only
      </div>

      <div className="mb-4 space-y-1.5">
        <Label>Pay type</Label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "per_hour", label: "Hourly" },
              { key: "commission", label: "% of paid claims" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={savePayType.isPending}
              onClick={() => savePayType.mutate(o.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                payType === o.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {payType === "commission"
            ? "This driver is paid a percentage of the Medicaid claims the state actually paid."
            : "This driver is paid for clocked hours at the hourly rate below."}
        </p>
      </div>

      {payType === "per_hour" ? (
        <>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Hourly rate (USD)</Label>
              <Input
                inputMode="decimal"
                placeholder="not set"
                className="w-36"
                value={rateValue}
                onChange={(ev) => setRate(ev.target.value)}
              />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save rate
            </Button>
          </div>
          {currentRate == null && (
            <p className="mt-2 text-xs text-muted-foreground">
              No rate set yet — earnings can&apos;t be calculated until you add one.
            </p>
          )}

          {periodPicker}

          {earnings.isLoading || !e ? (
            <div className="py-6 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Metric label="Hours (period)" value={`${e.period_hours.toFixed(2)}h`} />
                <Metric
                  label="Earnings (period)"
                  value={e.period_earnings == null ? "—" : formatCurrency(e.period_earnings)}
                />
                <Metric
                  label="Running total"
                  value={e.all_time_earnings == null ? "—" : formatCurrency(e.all_time_earnings)}
                  hint={`${e.all_time_hours.toFixed(2)}h all time`}
                />
              </div>

              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Day</th>
                      <th className="px-3 py-2">Shifts</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2 text-right">Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.by_day.map((d) => (
                      <tr key={d.day} className="border-t border-border">
                        <td className="px-3 py-2">{formatDate(d.day)}</td>
                        <td className="px-3 py-2 tabular-nums">{d.shifts}</td>
                        <td className="px-3 py-2 tabular-nums">{d.hours.toFixed(2)}h</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {d.earnings == null ? "—" : formatCurrency(d.earnings)}
                        </td>
                      </tr>
                    ))}
                    {!e.by_day.length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                          No clocked shifts in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {e.shifts.some((s) => s.open) && (
                <p className="mt-2 text-xs text-emerald-600">
                  Currently clocked in since{" "}
                  {formatDateTime(e.shifts.find((s) => s.open)!.clock_in_at)} — hours still
                  counting.
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Payout percentage (%)</Label>
              <Select
                value={pctValue}
                onValueChange={(value) => setPct(value)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Select %" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Not set</SelectItem>
                  {Array.from({ length: 101 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => savePct.mutate()} disabled={savePct.isPending}>
              {savePct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save percentage
            </Button>
          </div>
          {currentPct == null && !claims.isLoading && (
            <p className="mt-2 text-xs text-muted-foreground">
              No percentage set yet — payouts can&apos;t be calculated until you add one.
            </p>
          )}

          {periodPicker}

          {claims.isLoading || !c ? (
            <div className="py-6 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Metric
                  label="Paid claims (period)"
                  value={String(c.claims.length)}
                  hint={`${c.payable_count} not yet paid out`}
                />
                <Metric label="Payable claim total" value={formatCurrency(c.total_payable)} />
                <Metric
                  label={`Driver share${currentPct == null ? "" : ` (${currentPct}%)`}`}
                  value={estimate == null ? "—" : formatCurrency(estimate)}
                />
              </div>

              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Member</th>
                      <th className="px-3 py-2">Claim</th>
                      <th className="px-3 py-2 text-right">Paid amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.claims.map((cl) => (
                      <tr key={cl.trip_id} className="border-t border-border">
                        <td className="px-3 py-2">{cl.trip_date ? formatDate(cl.trip_date) : "—"}</td>
                        <td className="px-3 py-2">{cl.member_name ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {cl.claim_id ?? "—"}
                          {cl.already_paid_out && (
                            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                              paid out
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(cl.amount)}
                        </td>
                      </tr>
                    ))}
                    {!c.claims.length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                          No state-paid claims in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                Finalize and record this payout from Salary → % of paid claims.
              </p>
            </>
          )}
        </>
      )}

      <div className="mt-5 space-y-1.5 border-t border-border pt-4">
        <Label>Reset password</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            className="w-56"
            placeholder="New password (min 6 chars)"
            value={newPassword}
            onChange={(ev) => setNewPassword(ev.target.value)}
          />
          <Button
            variant="outline"
            disabled={resetPassword.isPending || newPassword.length < 6}
            onClick={() => resetPassword.mutate()}
          >
            {resetPassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset password
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sets the driver&apos;s sign-in password immediately. Share it with them directly.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
