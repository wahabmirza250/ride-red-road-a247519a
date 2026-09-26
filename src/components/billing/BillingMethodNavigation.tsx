import { useLocation } from "@tanstack/react-router";
import { Bot, Radio } from "lucide-react";
import { AppLink } from "@/lib/appLink";
import { cn } from "@/lib/utils";

/** Keep both submission methods visible on desktop, tablets, and phones. */
export function BillingMethodNavigation({ billingApp = false }: { billingApp?: boolean }) {
  const pathname = useLocation({ select: (location) => location.pathname }).replace(/\/$/, "");
  const robot = pathname.endsWith("/portal") || pathname.endsWith("/hcpf");
  const edi =
    pathname.endsWith("/billing") ||
    pathname.endsWith("/edi") ||
    pathname.endsWith("/medicaid-billing") ||
    pathname.endsWith("/super-edi");
  const methods = [
    {
      label: "EDI billing",
      detail: "Send electronic claim batches",
      to: billingApp ? "/billing/edi" : "/medicaid-billing/super-edi",
      active: edi,
      icon: Radio,
    },
    {
      label: "Robot billing",
      detail: "Submit through the state portal",
      to: billingApp ? "/billing/portal" : "/medicaid-billing/hcpf",
      active: robot,
      icon: Bot,
    },
  ];
  return (
    <nav aria-label="Billing method" className="mb-5 grid grid-cols-2 gap-2">
      {methods.map(({ label, detail, to, active, icon: Icon }) => (
        <AppLink
          key={to}
          to={to}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-xl border p-3 sm:p-4 transition",
            active
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-surface text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-5 w-5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{label}</span>
            <span className="mt-0.5 hidden text-xs sm:block">{detail}</span>
          </span>
        </AppLink>
      ))}
    </nav>
  );
}
