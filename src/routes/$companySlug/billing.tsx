import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppLink } from "@/lib/appLink";
import { LogOut, Moon, Sun, MessageSquare, ListChecks, Settings, Layers, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDenied } from "@/components/AccessDenied";
import { BrandMark } from "@/components/Brand";
import { CompanyLogo } from "@/components/CompanyLogo";

export const Route = createFileRoute("/$companySlug/billing")({
  ssr: false,
  component: BillingLayout,
});

const NAV = [
  { to: "/billing", label: "Workflow", icon: ListChecks, exact: true },
  { to: "/billing/chat", label: "Paper bills", icon: MessageSquare, exact: false },
  { to: "/billing/batch", label: "Batch", icon: Layers, exact: false },
  { to: "/billing/messages", label: "Team", icon: Users, exact: false },
  { to: "/billing/settings", label: "Settings", icon: Settings, exact: false },
] as const;


function BillingLayout() {
  const { companySlug } = Route.useParams();
  const { loading, user, isBilling, isAdmin, signOut } = useAuth();
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const signInHref = `/${companySlug}/billing/signin`;
  const isPublicAuthRoute = loc.pathname.replace(/\/$/, "").endsWith("/billing/signin");

  useEffect(() => {
    if (isPublicAuthRoute || loading) return;
    if (!user) window.location.replace(signInHref);
  }, [isPublicAuthRoute, loading, user, signInHref]);

  if (isPublicAuthRoute) return <Outlet />;
  if (loading || !user) return <LoadingScreen label="Loading billing" />;

  // Strict role isolation — a driver, dispatcher or passenger session must
  // never reach the billing workspace.
  if (!isBilling && !isAdmin) {
    return (
      <AccessDenied
        appName="billing"
        signInHref={signInHref}
        signInLabel="billing sign in"
        email={user.email}
      />
    );
  }

  return (
    <div className="surface-red fleet-shell min-h-screen pb-24 lg:pb-0">
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ReceiptText className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold">RedArt Billing</span>
          <CompanyLogo />
        </div>
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = item.exact
              ? loc.pathname.replace(/\/$/, "").endsWith("/billing")
              : loc.pathname.includes(item.to);
            const Icon = item.icon;
            return (
              <AppLink
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </AppLink>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-accent">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={async () => {
              await signOut();
              window.location.replace(signInHref);
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] overflow-x-hidden px-3 py-5 sm:px-4 sm:py-6">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 z-30 flex w-full items-center justify-around border-t border-border bg-surface/95 backdrop-blur lg:hidden">
        {NAV.map((item) => {
          const active = item.exact
            ? loc.pathname.replace(/\/$/, "").endsWith("/billing")
            : loc.pathname.includes(item.to);
          const Icon = item.icon;
          return (
            <AppLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </AppLink>
          );
        })}
      </nav>
    </div>
  );
}
