import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPayroll, resetDriverPassword } from "@/lib/admin.functions";
import { PayPlanSettingsDialog } from "@/components/payroll/PayPlanSettingsDialog";
import { QueryNotice } from "./QueryNotice";
import { formatCurrency } from "@/lib/format";
import { AppLink } from "@/lib/appLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
export function DriverPaySummary({ driverId }: { driverId: string }) {
  const [settings, setSettings] = useState(false);
  const [password, setPassword] = useState("");
  const [period] = useState(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 13);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  });
  const load = useServerFn(getPayroll);
  const reset = useServerFn(resetDriverPassword);
  const q = useQuery({
    queryKey: ["payroll", driverId, period.from, period.to],
    queryFn: () => load({ data: { driver_id: driverId, ...period } }),
  });
  const changePassword = useMutation({
    mutationFn: () => reset({ data: { driver_id: driverId, password } }),
    onSuccess: () => {
      setPassword("");
      toast.success("Password reset");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Pay plan and unpaid work</h3>
      <p className="text-xs text-muted-foreground">
        Last 14 days · same calculation as Salary and Reports. Planned shifts are excluded.
      </p>
      <QueryNotice query={q} label="Driver pay" />
      {q.isPending && <p>Loading pay…</p>}
      {q.data && (
        <>
          <p className="text-lg font-semibold">{formatCurrency(q.data.total)}</p>
          {q.data.lines.map((line) => (
            <p key={line.key} className="text-sm">
              {line.detail} · {formatCurrency(line.amount)}
            </p>
          ))}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setSettings(true)}>
          Edit pay plan
        </Button>
        <AppLink to="/salary" className="rounded-lg border px-3 py-2 text-sm">
          Salary and payment history
        </AppLink>
      </div>
      <PayPlanSettingsDialog
        open={settings}
        onOpenChange={(open) => {
          setSettings(open);
          if (!open) void q.refetch();
        }}
      />
      <div className="border-t pt-3">
        <label htmlFor="driver-new-password" className="text-sm">
          Reset driver password
        </label>
        <Input
          id="driver-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />
        <Button
          type="button"
          className="mt-2"
          disabled={password.length < 6 || changePassword.isPending}
          onClick={() => changePassword.mutate()}
        >
          Reset password
        </Button>
      </div>
    </section>
  );
}
