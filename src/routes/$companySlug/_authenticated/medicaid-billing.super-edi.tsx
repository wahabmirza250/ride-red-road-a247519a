import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { SuperEdiWorkspace } from "@/components/billing/superedi/SuperEdiWorkspace";

export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing/super-edi")({
  head: () => ({
    meta: [
      { title: "Super EDI — Electronic 837P billing | RedArt NEMT" },
      {
        name: "description",
        content:
          "Bulk electronic Medicaid billing: import trip forms, validate claims against the payer rules, build one 837P submission batch and track 999/277/835 responses.",
      },
      { property: "og:title", content: "Super EDI — Electronic 837P billing" },
      {
        property: "og:description",
        content:
          "High-volume EDI workspace: bulk import, payer validation, one 837P file per batch, real acknowledgement and remittance tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperEdiPage,
});

function SuperEdiPage() {
  const { isAdmin, isOwner, isBilling, isAdminBiller } = useAuth();
  const allowed = isAdmin || isOwner || isBilling || isAdminBiller;

  if (!allowed) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Billing staff only. Ask an admin for billing access.
      </div>
    );
  }

  return (
    <div className="surface-red">
      <SuperEdiWorkspace />
    </div>
  );
}
