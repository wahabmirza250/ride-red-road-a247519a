import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { PAY_PLANS, PLAN_LABEL, type PayPlan } from "@/lib/payPlans";
import {
  getPayPlanSettings,
  saveCompanyPaySettings,
  saveDriverPayPlan,
} from "@/lib/payPlanAdmin.functions";

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Company pay plan defaults + per-driver overrides.
 *
 * A company chooses how it pays (hourly, commission, per trip, or a hybrid)
 * and any driver can be set to something different. Blank driver fields simply
 * inherit the company value, so onboarding a new driver takes zero setup.
 */
export function PayPlanSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const load = useServerFn(getPayPlanSettings);
  const saveCompany = useServerFn(saveCompanyPaySettings);
  const saveDriver = useServerFn(saveDriverPayPlan);

  const settings = useQuery({
    queryKey: ["pay-plan-settings"],
    queryFn: () => load({ data: {} as never }),
    enabled: open,
  });

  const [plan, setPlan] = useState<PayPlan>("hourly");
  const [rate, setRate] = useState("");
  const [pct, setPct] = useState("");
  const [perTrip, setPerTrip] = useState("");
  const [base, setBase] = useState<string>("unset");
  const [driverId, setDriverId] = useState<string>("");

  const company = settings.data?.company;
  useEffect(() => {
    if (!company) return;
    setPlan(company.default_plan as PayPlan);
    setRate(company.hourly_rate == null ? "" : String(company.hourly_rate));
    setPct(company.commission_percentage == null ? "" : String(company.commission_percentage));
    setPerTrip(company.per_trip_amount == null ? "" : String(company.per_trip_amount));
    setBase(company.commission_base);
  }, [company]);

  const driver = useMemo(
    () => settings.data?.drivers.find((d) => d.driver_id === driverId) ?? null,
    [settings.data, driverId],
  );
  const [dPlan, setDPlan] = useState<string>("inherit");
  const [dRate, setDRate] = useState("");
  const [dPct, setDPct] = useState("");
  const [dPerTrip, setDPerTrip] = useState("");
  useEffect(() => {
    const o = driver?.override as Record<string, unknown> | null | undefined;
    setDPlan((o?.["plan"] as string) ?? "inherit");
    setDRate(o?.["hourly_rate"] == null ? "" : String(o["hourly_rate"]));
    setDPct(o?.["commission_percentage"] == null ? "" : String(o["commission_percentage"]));
    setDPerTrip(o?.["per_trip_amount"] == null ? "" : String(o["per_trip_amount"]));
  }, [driver]);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["pay-plan-settings"] });
    qc.invalidateQueries({ queryKey: ["payroll-period"] });
    qc.invalidateQueries({ queryKey: ["payroll-preview"] });
  };

  const companyMut = useMutation({
    mutationFn: () =>
      saveCompany({
        data: {
          default_plan: plan,
          hourly_rate: numOrNull(rate),
          commission_percentage: numOrNull(pct),
          per_trip_amount: numOrNull(perTrip),
          commission_base: base as never,
          per_trip_source: "completed_trips" as const,
        },
      }),
    onSuccess: () => {
      toast.success("Company pay settings saved");
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const driverMut = useMutation({
    mutationFn: () =>
      saveDriver({
        data: {
          driver_id: driverId,
          plan: dPlan === "inherit" ? null : (dPlan as PayPlan),
          hourly_rate: numOrNull(dRate),
          commission_percentage: numOrNull(dPct),
          per_trip_amount: numOrNull(dPerTrip),
        },
      }),
    onSuccess: () => {
      toast.success("Driver pay plan saved");
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay plans</DialogTitle>
        </DialogHeader>

        {settings.isLoading ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <h3 className="text-sm font-semibold">Company default</h3>
                <p className="text-xs text-muted-foreground">
                  How drivers are paid unless a driver is set up differently.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Pay plan</Label>
                  <Select value={plan} onValueChange={(v) => setPlan(v as PayPlan)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAY_PLANS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLAN_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Hourly rate ($/hr)</Label>
                  <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Commission (%)</Label>
                  <Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Per completed trip ($)</Label>
                  <Input
                    inputMode="decimal"
                    value={perTrip}
                    onChange={(e) => setPerTrip(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Commission is a share of</Label>
                  <Select value={base} onValueChange={setBase}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">Not chosen yet</SelectItem>
                      <SelectItem value="paid_claims">Claims the state actually paid</SelectItem>
                    </SelectContent>
                  </Select>
                  {base === "unset" && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Commission payments stay blocked until this is chosen.
                    </p>
                  )}
                </div>
              </div>
              <Button onClick={() => companyMut.mutate()} disabled={companyMut.isPending}>
                {companyMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save company default
              </Button>
            </section>

            <section className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <h3 className="text-sm font-semibold">Driver override</h3>
                <p className="text-xs text-muted-foreground">
                  Leave a field blank to use the company value.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Driver</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {(settings.data?.drivers ?? []).map((d) => (
                      <SelectItem key={d.driver_id} value={d.driver_id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {driver && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">
                      Currently: {PLAN_LABEL[driver.effective.plan as PayPlan]}
                    </Badge>
                    {driver.issues.map((i) => (
                      <span key={i} className="text-amber-600">
                        {i}
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Pay plan</Label>
                      <Select value={dPlan} onValueChange={setDPlan}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Use company default</SelectItem>
                          {PAY_PLANS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PLAN_LABEL[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Hourly rate ($/hr)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="inherit"
                        value={dRate}
                        onChange={(e) => setDRate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Commission (%)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="inherit"
                        value={dPct}
                        onChange={(e) => setDPct(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Per completed trip ($)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="inherit"
                        value={dPerTrip}
                        onChange={(e) => setDPerTrip(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button onClick={() => driverMut.mutate()} disabled={driverMut.isPending}>
                    {driverMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Save driver plan
                  </Button>
                </>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
