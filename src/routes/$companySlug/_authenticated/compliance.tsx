import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/nemt/PageHeader";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/claimReview";
import {
  ALERT_THRESHOLDS,
  EXPENSE_CATEGORIES,
  INSURANCE_STATE_LABEL,
  alertThreshold,
  daysUntil,
  expenseCategoryLabel,
  expenseTotal,
  insuranceState,
  totalsBy,
} from "@/lib/compliance";
import {
  listInsuranceDocs,
  listVehicleExpenses,
  verifyInsuranceDoc,
} from "@/lib/compliance.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/compliance")({
  head: () => ({
    meta: [
      { title: "Fleet Compliance & Vehicle Expenses" },
      {
        name: "description",
        content:
          "Track driver insurance expirations with 30/14/7 day alerts and review vehicle maintenance expenses by vehicle, driver and category.",
      },
      { property: "og:title", content: "Fleet Compliance & Vehicle Expenses" },
      {
        property: "og:description",
        content: "Driver insurance status and vehicle maintenance spend for your NEMT fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompliancePage,
});

const ALL = "__all__";

function CompliancePage() {
  const qc = useQueryClient();
  const insFn = useServerFn(listInsuranceDocs);
  const verifyFn = useServerFn(verifyInsuranceDoc);
  const expFn = useServerFn(listVehicleExpenses);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState(ALL);
  const [vehicle, setVehicle] = useState("");

  const docs = useQuery({
    queryKey: ["insurance_docs", "company"],
    queryFn: () => insFn({ data: {} }) as Promise<any[]>,
  });

  const expenses = useQuery({
    queryKey: ["vehicle_expenses", "company", { from, to, category, vehicle }],
    queryFn: () =>
      expFn({
        data: {
          from: from || undefined,
          to: to || undefined,
          category: category === ALL ? undefined : (category as never),
          vehicle: vehicle || undefined,
          page: 0,
          page_size: 200,
        },
      }) as Promise<{ rows: any[]; total: number }>,
  });

  const verify = useMutation({
    mutationFn: (vars: { id: string; status: "verified" | "rejected" }) =>
      verifyFn({ data: vars }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      toast.success("Document updated");
      void qc.invalidateQueries({ queryKey: ["insurance_docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const rows = expenses.data?.rows ?? [];
  const alerts = (docs.data ?? []).filter((d) => {
    const s = insuranceState(d.expiration_date);
    return s === "expired" || s === "expiring_soon";
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance & Vehicle Expenses"
        description={`Insurance alerts at ${ALERT_THRESHOLDS.join(", ")} days before expiration`}
      />

      {alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="font-medium text-amber-600">
            {alerts.length} insurance document{alerts.length === 1 ? "" : "s"} need attention
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {alerts.slice(0, 8).map((d) => {
              const t = alertThreshold(d.expiration_date);
              const days = daysUntil(d.expiration_date);
              return (
                <li key={d.id}>
                  {d.insurer} · {d.vehicle_label ?? "vehicle"} —{" "}
                  {days !== null && days < 0
                    ? "expired"
                    : `expires in ${days} day${days === 1 ? "" : "s"}${t ? ` (${t}-day alert)` : ""}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <section className="rounded-2xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Driver insurance</h2>
        </div>
        {docs.isLoading ? (
          <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Insurer</th>
                  <th className="p-2 text-left">Policy</th>
                  <th className="p-2 text-left">Vehicle</th>
                  <th className="p-2 text-left">Expires</th>
                  <th className="p-2 text-left">State</th>
                  <th className="p-2 text-left">Verification</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(docs.data ?? []).map((d) => {
                  const s = insuranceState(d.expiration_date);
                  return (
                    <tr key={d.id} className="border-t">
                      <td className="p-2">{d.insurer}</td>
                      <td className="p-2 font-mono text-xs">{d.policy_number}</td>
                      <td className="p-2">{d.vehicle_label ?? "—"}</td>
                      <td className="p-2">{formatDate(d.expiration_date)}</td>
                      <td className="p-2">
                        <Badge
                          variant={
                            s === "valid" ? "default" : s === "expiring_soon" ? "secondary" : "destructive"
                          }
                        >
                          {INSURANCE_STATE_LABEL[s]}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline">{d.status}</Badge>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="mr-1"
                          onClick={() => verify.mutate({ id: d.id, status: "verified" })}
                        >
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => verify.mutate({ id: d.id, status: "rejected" })}
                        >
                          Reject
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!(docs.data ?? []).length && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      No insurance documents yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Vehicle expenses</h2>
          <div className="ml-auto text-xs text-muted-foreground">
            Total {formatMoney(expenseTotal(rows.map((r) => ({ category: r.category, amount: Number(r.amount) }))))}
          </div>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input placeholder="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {totalsBy(
            rows.map((r) => ({ category: r.category, amount: Number(r.amount) })),
            "category",
          ).map((t) => (
            <span key={t.key} className="rounded-full bg-muted px-2.5 py-1">
              {expenseCategoryLabel(t.key)}: {formatMoney(t.total)}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Vehicle</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-left">Vendor</th>
                <th className="p-2 text-right">Odometer</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{formatDate(r.expense_date)}</td>
                  <td className="p-2">{r.vehicle_label ?? "—"}</td>
                  <td className="p-2">{expenseCategoryLabel(r.category)}</td>
                  <td className="p-2">{r.vendor ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{r.odometer ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{formatMoney(Number(r.amount))}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No expenses in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
