import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLink } from "@/lib/appLink";
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  Layers,
  ListChecks,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDenied } from "@/components/AccessDenied";
import { BrandMark } from "@/components/Brand";
import { CompanyLogo } from "@/components/CompanyLogo";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/$companySlug/billing")({
  ssr: false,
  component: BillingLayout,
});

/** Top-level destinations. Claims lives in its own collapsible group below. */
const NAV = [
  { to: "/billing", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/billing/chat", label: "Paper bills", icon: MessageSquare, exact: false },
  { to: "/billing/batch", label: "Batch", icon: Layers, exact: false },
  { to: "/billing/messages", label: "Team", icon: Users, exact: false },
  { to: "/billing/settings", label: "Settings", icon: Settings, exact: false },
] as const;

/**
 * The Claims stages, grouped instead of spread across a long status bar.
 * Each entry deep-links the dashboard's stage filter through the hash so the
 * workspace keeps owning all of its data logic.
 */
const CLAIM_STAGES = [
  { hash: "ready_to_submit", label: "Ready" },
  { hash: "awaiting_portal", label: "Processing" },
  { hash: "submitted", label: "Submitted" },
  { hash: "needs_attention", label: "Needs Attention" },
  { hash: "denied", label: "Rejected / Denied" },
  { hash: "claims_history", label: "Paid" },
] as const;

function BillingLayout() {
  const { companySlug } = Route.useParams();
  const { loading, user, isBilling, isAdmin, signOut } = useAuth();
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const signInHref = `/${companySlug}/billing/signin`;
  const isPublicAuthRoute = loc.pathname.replace(/\/$/, "").endsWith("/billing/signin");
  const [claimsOpen, setClaimsOpen] = useState(true);

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

  const isActive = (to: string, exact: boolean) =>
    exact ? loc.pathname.replace(/\/$/, "").endsWith("/billing") : loc.pathname.includes(to);

  const initials = (user.email ?? "A").slice(0, 2).toUpperCase();

  return (
    <div className="app-theme-controls surface-red min-h-screen bg-background pb-24 lg:pb-0">
      {/* ---------------- Sidebar: slim, deep navy, lots of breathing room --------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[210px] flex-col bg-navy px-3 py-5 text-white/70 lg:flex">
        <div className="flex items-center gap-2 px-2 pb-8">
          <BrandMark className="h-8 w-8 shrink-0" />
          <span className="truncate text-sm font-semibold tracking-tight text-white">
            NEMT Solutions
          </span>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.slice(0, 1).map((item) => (
            <SideLink key={item.to} {...item} active={isActive(item.to, item.exact)} />
          ))}

          <button
            type="button"
            onClick={() => setClaimsOpen((v) => !v)}
            className="mt-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
            aria-expanded={claimsOpen}
          >
            <ListChecks className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
            <span className="truncate">Claims</span>
            <ChevronDown
              className={cn("ml-auto h-3.5 w-3.5 transition-transform", claimsOpen && "rotate-180")}
            />
          </button>
          {claimsOpen && (
            <div className="ml-4 flex flex-col gap-0.5 border-l border-white/10 pl-3">
              {CLAIM_STAGES.map((s) => (
                <AppLink
                  key={s.hash}
                  to="/billing"
                  hash={s.hash}
                  className="truncate rounded-lg px-2.5 py-1.5 text-[13px] text-white/60 transition hover:bg-white/5 hover:text-white"
                >
                  {s.label}
                </AppLink>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-1">
            {NAV.slice(1).map((item) => (
              <SideLink key={item.to} {...item} active={isActive(item.to, item.exact)} />
            ))}
          </div>
        </nav>

        <button
          onClick={async () => {
            await signOut();
            window.location.replace(signInHref);
          }}
          className="mt-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Sign out
        </button>
      </aside>

      {/* ---------------- Content column --------------- */}
      <div className="lg:pl-[210px]">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark className="h-8 w-8 shrink-0 lg:hidden" />
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  Medicaid Billing
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  Review, submit and track state claims
                </p>
              </div>
              <CompanyLogo />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="relative hidden xl:block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search claims"
                  className="h-9 w-56 rounded-full pl-9"
                  onChange={(e) => {
                    window.dispatchEvent(
                      new CustomEvent("billing:search", { detail: e.target.value }),
                    );
                  }}
                />
              </div>
              <button
                onClick={toggle}
                aria-label="Toggle theme"
                className="rounded-full p-2 text-muted-foreground transition hover:bg-accent"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                aria-label="Notifications"
                className="rounded-full p-2 text-muted-foreground transition hover:bg-accent"
              >
                <Bell className="h-4 w-4" />
              </button>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-plum-soft text-xs font-semibold text-foreground">
                {initials}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] overflow-x-hidden px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile chrome stays exactly as before. */}
      <nav className="fixed bottom-0 z-30 flex w-full items-center justify-around border-t border-border bg-surface/95 backdrop-blur lg:hidden">
        {NAV.map((item) => {
          const active = isActive(item.to, item.exact);
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

function SideLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <AppLink
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        active ? "bill-pill-active" : "text-white/70 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
      <span className="truncate">{label}</span>
    </AppLink>
  );
}
