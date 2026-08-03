import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPayroll } from "@/lib/admin.functions";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useEffect } from "react";
import { Loader2, Printer } from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const Route = createFileRoute("/$companySlug/$companySlug/_authenticated/payroll/$driverId")({
  validateSearch: (s) => searchSchema.parse(s),
  component: PayrollPrintPage,
});

function PayrollPrintPage() {
  const { driverId } = Route.useParams();
  const { from, to } = Route.useSearch();
  const payrollFn = useServerFn(getPayroll);
  const q = useQuery({
    queryKey: ["payroll-print", driverId, from, to],
    queryFn: () => payrollFn({ data: { driver_id: driverId, from, to } }),
  });

  useEffect(() => {
    if (q.data) {
      // small delay so layout settles
      const t = setTimeout(() => document.title = `Payroll — ${q.data.driver?.first_name ?? ""} ${q.data.driver?.last_name ?? ""}`, 100);
      return () => clearTimeout(t);
    }
  }, [q.data]);

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!q.data) return <div className="p-8">Failed to load.</div>;

  const p = q.data;

  return (
    <div className="min-h-screen bg-white p-8 text-black print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-start justify-between border-b border-black/10 pb-6 print:hidden">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Summary</h1>
            <p className="text-sm text-black/60">RedArt LLC — NEMT</p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
          >
            <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
          </button>
        </div>

        <div className="mb-8 hidden print:block">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black text-white font-bold">R</div>
            <div>
              <div className="text-lg font-semibold">RedArt LLC</div>
              <div className="text-xs text-black/60">NEMT Payroll Summary</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-black/50">Driver</div>
            <div className="font-medium">{p.driver?.first_name} {p.driver?.last_name}</div>
            <div className="text-black/60">{p.driver?.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-black/50">Pay period</div>
            <div className="font-medium">
              {formatDate(p.period.from)} – {formatDate(p.period.to)}
            </div>
          </div>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase text-black/60">Earnings</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-black/10">
              <td className="py-2">Trips completed</td>
              <td className="py-2 text-right tabular-nums">{p.trips_completed}</td>
            </tr>
            <tr className="border-b border-black/10">
              <td className="py-2">Miles driven</td>
              <td className="py-2 text-right tabular-nums">{p.miles}</td>
            </tr>
            <tr className="border-b border-black/10">
              <td className="py-2">
                Hours worked {p.hourly_rate == null ? "(no rate set)" : `× $${p.hourly_rate}/hr`}
              </td>
              <td className="py-2 text-right tabular-nums">{p.hours} → {formatCurrency(p.hourly_pay)}</td>
            </tr>
            <tr className="border-b border-black/10">
              <td className="py-2">Fuel reimbursement</td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(p.fuel_cost)}</td>
            </tr>
          </tbody>
        </table>

        {p.shifts.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase text-black/60">Shifts</h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/20 text-left">
                  <th className="py-2">Start</th>
                  <th className="py-2">End</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.shifts.map((s) => (
                  <tr key={s.id} className="border-b border-black/10">
                    <td className="py-2">{formatDateTime(s.start)}</td>
                    <td className="py-2">{formatDateTime(s.end)}</td>
                    <td className="py-2">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-8 flex items-center justify-between border-t-2 border-black pt-4">
          <div className="text-sm uppercase font-semibold">Grand total</div>
          <div className="text-2xl font-semibold tabular-nums">{formatCurrency(p.total)}</div>
        </div>

        <p className="mt-16 text-center text-xs text-black/50">
          RedArt LLC NEMT Platform — generated {formatDateTime(new Date())}
        </p>
      </div>

      <style>{`@media print {
        @page { margin: 1.5cm; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`}</style>
    </div>
  );
}
