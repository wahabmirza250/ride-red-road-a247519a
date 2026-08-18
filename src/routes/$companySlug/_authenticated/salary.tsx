import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Banknote, Percent } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/nemt/PageHeader";
import { PayrollPage } from "./payroll.index";
import { DriverPayPage } from "./driver-pay";

export const Route = createFileRoute("/$companySlug/_authenticated/salary")({
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
        content: "Hourly payroll and percentage-of-paid-claims payouts in a single workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalaryPage,
});

type Method = "hourly" | "percentage";

function SalaryPage() {
  const [method, setMethod] = useState<Method>("hourly");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Salary"
        description="Pay drivers by clocked hours or by a percentage of paid Medicaid claims — pick the method for this payout."
      />

      <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap sm:flex-wrap">
          <TabsTrigger value="hourly" className="shrink-0 whitespace-nowrap">
            <Banknote className="mr-1.5 h-4 w-4" />
            Hourly payroll
          </TabsTrigger>
          <TabsTrigger value="percentage" className="shrink-0 whitespace-nowrap">
            <Percent className="mr-1.5 h-4 w-4" />
            % of paid claims
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {method === "hourly" ? <PayrollPage /> : <DriverPayPage />}
    </div>
  );
}
