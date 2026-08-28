import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Printer } from "lucide-react";
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
      { title: "Driver Pay Stub — RedArt NEMT" },
      {
        name: "description",
        content:
          "Printable driver pay stub with trip and claim rows, manual items, adjustments and the final payable amount for the pay period.",
      },
      { property: "og:title", content: "Driver Pay Stub — RedArt NEMT" },
      {
        property: "og:description",
        content: "Printable NEMT driver pay stub for a pay period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayrollStatementPage,
});

const KIND_LABEL: Record<string, string> = {
  claim: "Trip / claim",
  adjustment: "Adjustment",
  manual: "Manual",
};

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
  const companyName = company || companySlug;
  const driverLabel = driver_name || driverId;
  const paidCount = rows.filter((r) => r.payroll_status === "paid").length;
  const stubNo = `${driverId.slice(0, 8).toUpperCase()}-${(from || "").replace(/-/g, "") || "ALL"}`;

  return (
    <div className="min-h-screen bg-white p-6 text-black sm:p-10 print:p-0">
      <div className="mx-auto max-w-3xl">
        {/* Screen-only action bar — hidden on paper. */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pay stub</h1>
            <p className="text-sm text-black/55">
              {companyName} · {driverLabel}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center rounded-full border border-black/15 px-4 py-2 text-sm font-medium text-black hover:bg-black/5"
            >
              <Printer className="mr-2 h-4 w-4" /> Print
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85"
            >
              <Download className="mr-2 h-4 w-4" /> Export PDF
            </button>
          </div>
        </div>

        {/* Document header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-black text-lg font-bold text-white">
              {companyName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-lg font-semibold leading-tight">{companyName}</div>
              <div className="text-xs uppercase tracking-widest text-black/50">
                Non-emergency medical transportation
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-black/50">Pay stub</div>
            <div className="font-mono text-sm">{stubNo}</div>
          </div>
        </header>

        {/* Facts */}
        <section className="mt-6 grid grid-cols-2 gap-6 text-sm sm:grid-cols-4">
          <Fact label="Driver" value={driverLabel} />
          <Fact
            label="Pay period"
            value={`${from ? formatDate(from) : "—"} – ${to ? formatDate(to) : "—"}`}
          />
          <Fact label="Lines" value={String(rows.length)} />
          <Fact label="Marked paid" value={`${paidCount} of ${rows.length}`} />
        </section>

        {/* Detail */}
        <h2 className="mt-9 text-xs font-semibold uppercase tracking-widest text-black/50">
          Earnings detail
        </h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black/20 text-left text-xs uppercase tracking-wide text-black/60">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Passenger / description</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Payroll status</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-black/10 align-top">
                <td className="py-2 whitespace-nowrap">
                  {r.service_date ? formatDate(r.service_date) : "—"}
                </td>
                <td className="py-2">
                  <span className="font-medium">
                    {r.passenger_name ? `${r.passenger_name}` : (r.description ?? "—")}
                  </span>
                  {r.passenger_name && r.description ? (
                    <span className="text-black/60"> — {r.description}</span>
                  ) : null}
                  {r.claim_number ? (
                    <span className="ml-1 font-mono text-xs text-black/45">#{r.claim_number}</span>
                  ) : null}
                </td>
                <td className="py-2 whitespace-nowrap text-black/70">
                  {KIND_LABEL[String(r.kind)] ?? "Manual"}
                </td>
                <td className="py-2 whitespace-nowrap text-black/70">
                  {PAYROLL_STATUS_LABEL[(r.payroll_status as PayrollStatus) ?? "added"]}
                </td>
                <td className="py-2 text-right tabular-nums">{formatMoney(Number(r.amount ?? 0))}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-black/50">
                  No payroll lines in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <section className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <Line label="Gross earnings" value={formatMoney(totals.earnings)} />
            <Line label="Adjustments / deductions" value={formatMoney(totals.adjustments)} />
            <div className="mt-3 flex items-center justify-between border-t-2 border-black pt-3">
              <span className="text-xs font-semibold uppercase tracking-widest">Net payable</span>
              <span className="text-2xl font-semibold tabular-nums">{formatMoney(totals.total)}</span>
            </div>
          </div>
        </section>

        <footer className="mt-14 border-t border-black/10 pt-4 text-center text-[11px] leading-relaxed text-black/50">
          Generated {formatDateTime(new Date())} for {companyName}. Payroll status is recorded
          separately from Medicaid claim status; a paid claim is not a paid driver.
          <br />
          This statement reflects payroll lines already recorded for this driver — it does not
          create or duplicate a payment.
        </footer>
      </div>

      <style>{`@media print {
        @page { margin: 1.4cm; size: auto; }
        html, body { background: #fff !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 12px; }
        nav, header.app-header, aside, [data-app-nav], .print\\:hidden { display: none !important; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
        thead { display: table-header-group; }
        footer { page-break-inside: avoid; }
      }`}</style>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-black/45">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-black/65">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
