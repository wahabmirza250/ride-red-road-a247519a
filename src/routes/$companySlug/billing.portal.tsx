import { createFileRoute } from "@tanstack/react-router";
import { BillingWorkspace } from "@/components/billing/BillingWorkspace";
export const Route = createFileRoute("/$companySlug/billing/portal")({
  head: () => ({ meta: [{ title: "Robot billing — NEMT Solutions" }] }),
  component: () => (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Robot billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review trips and let the robot enter claims in the state portal.
        </p>
      </header>
      <BillingWorkspace />
    </div>
  ),
});
