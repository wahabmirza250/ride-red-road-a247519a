import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { BillingWorkspace } from "@/components/billing/BillingWorkspace";
export const Route = createFileRoute("/$companySlug/billing/portal")({
  head: () => ({ meta: [{ title: "Robot billing — NEMT Solutions" }] }),
  component: PortalPage,
});
function PortalPage() {
  const { companySlug } = Route.useParams();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.app_metadata?.is_demo === true) return <Navigate to="/$companySlug/billing/edi" params={{ companySlug }} />;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Robot billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review trips and let the robot enter claims in the state portal.
        </p>
      </header>
      <BillingWorkspace />
    </div>
  );
}
