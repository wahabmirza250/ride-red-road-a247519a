import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/nemt/PageHeader";
import { PayrollPage } from "./payroll.index";

export const Route = createFileRoute("/$companySlug/_authenticated/salary")({
  validateSearch: (s: Record<string, unknown>) => ({
    method: ["hourly", "percentage"].includes(String(s.method)) ? String(s.method) : "hourly",
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Driver Salary — RedArt NEMT" },
      {
        name: "description",
        content:
          "One place to pay drivers: hourly payroll from clocked shifts, or a percentage of the Medicaid claims the state actually paid.",
      },
      { property: "og:title", content: "Driver Salary — RedArt NEMT" },
      {
        property: "og:description",
        content: "All pay plans and percentage-of-paid-claims payouts in a single workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalaryPage,
});

function SalaryPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Salary"
        description="Review unpaid work using each driver’s hourly, commission or per-trip plan. Payment history is shown separately."
      />

      <PayrollPage embedded />
    </div>
  );
}
