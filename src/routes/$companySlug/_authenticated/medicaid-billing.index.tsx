import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Bot, CheckCircle2, Cpu, FileCheck2, Layers, Zap } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { AppLink } from "@/lib/appLink";
import { useAuth } from "@/lib/auth";
import { getBillingCounts } from "@/lib/billing.functions";
import { getBillingCountsClient } from "@/lib/billingClient";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$companySlug/_authenticated/medicaid-billing/")({
  head: () => ({
    meta: [
      { title: "Medical Billing — Choose a method | RedArt NEMT" },
      {
        name: "description",
        content:
          "Pick how this trip batch gets billed: electronic 837P claims through Super EDI, or the existing HCPF portal workflow with claim tracking.",
      },
      { property: "og:title", content: "Medical Billing — Choose a method" },
      {
        property: "og:description",
        content: "Super EDI electronic claims or the existing HCPF portal billing workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingMethodChoice,
});

function BillingMethodChoice() {
  const { isAdmin, isOwner } = useAuth();
  const countsFn = useServerFn(getBillingCounts);

  const counts = useQuery({
    queryKey: ["billing_counts"],
    queryFn: async () => {
      try {
        return await countsFn();
      } catch {
        return await getBillingCountsClient();
      }
    },
    refetchInterval: 60_000,
  });

  if (!isAdmin && !isOwner) {
    return <div className="p-6 text-sm text-muted-foreground">Admins only.</div>;
  }

  const pending = (counts.data?.pending_review ?? 0) + (counts.data?.approved ?? 0);

  return (
    <div className="surface-red space-y-8">
      <PageHeader
        title="Medical Billing"
        description="Two ways to get paid. Choose the workflow for this batch — both read the same trips and both keep their own claim history."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <MethodCard
          to="/medicaid-billing/super-edi"
          eyebrow="Electronic clearing"
          title="Super EDI"
          tagline="Bulk 837P claims straight to the payer"
          icon={Zap}
          accent="primary"
          points={[
            { icon: Layers, text: "Import 20, 100+ trip PDFs at once — one queue, one review" },
            { icon: FileCheck2, text: "Payer-side validation decides readiness, not guesswork" },
            { icon: Cpu, text: "One submission batch, one 837P file, real 999/277/835 tracking" },
          ]}
          cta="Open Super EDI"
          badge="TEST by default"
        />

        <MethodCard
          to="/medicaid-billing/hcpf"
          eyebrow="Portal automation"
          title="HCPF Billing"
          tagline="The existing portal workflow, unchanged"
          icon={Bot}
          accent="neutral"
          points={[
            { icon: CheckCircle2, text: "Paper bill review, Ready to Submit and Auto Pilot waves" },
            { icon: Bot, text: "Portal automation with verification holds and reconciliation" },
            { icon: FileCheck2, text: "Claim history, payroll links and resubmission editor" },
          ]}
          cta="Open HCPF Billing"
          badge={pending > 0 ? `${pending} bill${pending === 1 ? "" : "s"} waiting` : null}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Nothing is submitted by choosing a method. Super EDI stays in TEST until a company is
        explicitly cleared for production, and the HCPF workflow behaves exactly as before.
      </p>
    </div>
  );
}

function MethodCard({
  to,
  eyebrow,
  title,
  tagline,
  icon: Icon,
  accent,
  points,
  cta,
  badge,
}: {
  to: string;
  eyebrow: string;
  title: string;
  tagline: string;
  icon: typeof Zap;
  accent: "primary" | "neutral";
  points: { icon: typeof Zap; text: string }[];
  cta: string;
  badge: string | null;
}) {
  return (
    <AppLink
      to={to}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border bg-surface p-6 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg",
        accent === "primary"
          ? "border-primary/30 hover:border-primary"
          : "border-border hover:border-foreground/25",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full blur-3xl transition",
          accent === "primary" ? "bg-primary/20" : "bg-muted-foreground/10",
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "grid h-12 w-12 place-items-center rounded-2xl",
            accent === "primary"
              ? "bg-primary text-primary-foreground"
              : "bg-surface-muted text-foreground",
          )}
        >
          <Icon className="h-6 w-6" />
        </span>
        {badge && (
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tagline}</p>
      </div>

      <ul className="mt-5 space-y-2.5">
        {points.map((p) => {
          const PointIcon = p.icon;
          return (
            <li key={p.text} className="flex items-start gap-2.5 text-sm text-foreground/90">
              <PointIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {p.text}
            </li>
          );
        })}
      </ul>

      <div
        className={cn(
          "mt-6 inline-flex items-center gap-1.5 text-sm font-semibold",
          accent === "primary" ? "text-primary" : "text-foreground",
        )}
      >
        {cta}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </AppLink>
  );
}
