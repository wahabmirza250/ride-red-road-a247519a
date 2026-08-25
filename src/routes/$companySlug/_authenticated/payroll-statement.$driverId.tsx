import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Printer } from "lucide-react";
import { z } from "zod";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/claimReview";
import { listPayrollItems } from "@/lib/payrollItems.functions";
import { PAYROLL_STATUS_LABEL, statementTotals, type PayrollStatus } from "@/lib/payrollItems";

const searchSchema = z.object({
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  driver_name: z.string().optional().default(""),
  company: z.string().optional().default(""),
});

export const Route = createFileRoute("/$companySlug/_authenticated/payroll-statement/$driverId")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Payroll Statement — RedArt NEMT" },
      {
        name: "description",
        content:
          "Printable driver payroll statement with claim rows, manual items, adjustments and the final payable amount.",
      },
      { property: "og:title", content: "Payroll Statement — RedArt NEMT" },
      {
        property: "og:description",
        content: "Printable NEMT driver payroll statement for a pay period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayrollStatementPage,
});

function PayrollStatementPage() {
  const { driverId, companySlug } = Route.useParams();
  const { from, to, driver_name, company } = Route.useSearch();
  const listFn = useServerFn(listPayrollItems);

  const q = useQuery({
    queryKey: ["payroll_items", driverId, from, to],
    queryFn: () =>
      listFn({
        data: {
          driver_id: driverId,
          from: from || undefined,
          to: to || undefined,
          page: 0,
          page_size: 500,
        },
      }) as Promise<{ rows: any[]; total: number }>,
  });

  if (q.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  const rows = q.data?.rows ?? [];
  const totals = statementTotals(rows);

  return (
    <div className="min-h-screen bg-white p-8 text-black print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-start justify-between border-b border-black/10 pb-6 print:hidden">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Statement</h1>
            <p className="text-sm text-black/60">{company || companySlug}</p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
          >
            <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-black/50">Driver</div>
            <div className="font-medium">{driver_name || driverId}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-black/50">Pay period</div>
            <div className="font-medium">
              {from ? formatDate(from) : "—"} – {to ? formatDate(to) : "—"}
            </div>
          </div>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase text-black/60">Payroll lines</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/20 text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Passenger / description</th>
              <th className="py-2">Type</th>
              <th className="py-2">Payroll status</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-black/10">
                <td className="py-2">{r.service_date ? formatDate(r.service_date) : "—"}</td>
                <td className="py-2">
                  {r.passenger_name ? `${r.passenger_name} — ` : ""}
                  {r.description ?? "—"}
                  {r.claim_number ? (
                    <span className="ml-1 text-xs text-black/50">#{r.claim_number}</span>
                  ) : null}
                </td>
                <td className="py-2">
                  {r.kind === "claim" ? "Claim" : r.kind === "adjustment" ? "Adjustment" : "MANUAL"}
                </td>
                <td className="py-2">
                  {PAYROLL_STATUS_LABEL[(r.payroll_status as PayrollStatus) ?? "added"]}
                </td>
                <td className="py-2 text-right tabular-nums">{formatMoney(Number(r.amount ?? 0))}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-black/50">
                  No payroll lines in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-6 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Earnings</span>
            <span className="tabular-nums">{formatMoney(totals.earnings)}</span>
          </div>
          <div className="flex justify-between">
            <span>Adjustments / deductions</span>
            <span className="tabular-nums">{formatMoney(totals.adjustments)}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t-2 border-black pt-4">
          <div className="text-sm font-semibold uppercase">Final payable</div>
          <div className="text-2xl font-semibold tabular-nums">{formatMoney(totals.total)}</div>
        </div>

        <p className="mt-16 text-center text-xs text-black/50">
          Generated {formatDateTime(new Date())} · Payroll status is recorded separately from
          Medicaid claim status.
        </p>
      </div>

      <style>{`@media print {
        @page { margin: 1.5cm; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`}</style>
    </div>
  );
}
