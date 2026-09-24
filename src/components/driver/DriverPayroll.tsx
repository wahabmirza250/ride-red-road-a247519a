import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getMyPayroll } from "@/lib/myPayroll.functions";
import { localDateTimeInput } from "@/lib/operationStatus";
import { QueryNotice } from "@/components/admin/QueryNotice";
import { formatCurrency, formatDateTime } from "@/lib/format";
export function DriverPayroll() {
  const [period, setPeriod] = useState(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 13);
    return { from: localDateTimeInput(from).slice(0, 10), to: localDateTimeInput(to).slice(0, 10) };
  });
  const fn = useServerFn(getMyPayroll);
  const q = useQuery({
    queryKey: ["my-payroll", period],
    queryFn: () =>
      fn({
        data: {
          from: new Date(period.from + "T00:00:00").toISOString(),
          to: new Date(period.to + "T23:59:59.999").toISOString(),
        },
      }),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My pay</h1>
      <p className="text-sm text-muted-foreground">
        Your pay plan and unpaid work use the same calculation as the office. Payments already made
        appear separately below.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(["from", "to"] as const).map((key) => (
          <label key={key} className="text-sm capitalize">
            {key}
            <input
              className="block w-full rounded-lg border bg-background p-2"
              type="date"
              value={period[key]}
              onChange={(e) => setPeriod({ ...period, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <QueryNotice query={q} label="My pay" />
      {q.isPending && <p>Loading pay…</p>}
      {q.data?.issues.map((issue) => (
        <p role="alert" key={issue}>
          {issue}
        </p>
      ))}
      {q.data?.calc && (
        <section className="rounded-xl border p-4">
          <h2 className="font-medium">Unpaid work and fuel</h2>
          {q.data.calc.lines.map((line) => (
            <div key={line.key} className="flex justify-between gap-3 border-b py-3 text-sm">
              <span>
                {line.label}
                <small className="block text-muted-foreground">{line.detail}</small>
              </span>
              <span>{formatCurrency(line.amount)}</span>
            </div>
          ))}
          <p className="mt-3 text-lg font-semibold">{formatCurrency(q.data.calc.total)}</p>
        </section>
      )}
      <section className="rounded-xl border p-4">
        <h2 className="font-medium">Payments received in this period</h2>
        {q.data?.payments.map((p) => (
          <div key={p.id} className="flex justify-between gap-3 py-3 text-sm">
            <span>{formatDateTime(p.paid_at)}</span>
            <span>{formatCurrency(Number(p.total_paid))}</span>
          </div>
        ))}
        {q.data && !q.data.payments.length && (
          <p className="mt-3 text-sm text-muted-foreground">No payments recorded in this period.</p>
        )}
      </section>
    </div>
  );
}
