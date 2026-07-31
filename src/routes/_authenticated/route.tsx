import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Route as RouteIcon,
  Users,
  UserRound,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  CalendarClock,
  Newspaper,
  Gamepad2,
  Trophy,
  LogOut,
  FileSignature,
  Sun,
  Moon,
  Radio,
  Megaphone,
  Shield,
  Sparkles,
  Banknote,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useDriverLocationPing } from "@/lib/useDriverLocationPing";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/admin/NotificationBell";
import { ensurePushSubscribed } from "@/lib/push";
import { BrandMark } from "@/components/Brand";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDenied } from "@/components/AccessDenied";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const ADMIN_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/live-ops", label: "Live Ops", icon: Radio },
  { to: "/planner", label: "Planner", icon: CalendarClock },

  { to: "/trips", label: "Trips", icon: RouteIcon },
  { to: "/medicaid-billing", label: "Medicaid Billing", icon: FileSignature },
  { to: "/drivers", label: "Drivers", icon: Users },
  { to: "/payroll", label: "Payroll", icon: Banknote },
  { to: "/passengers", label: "Passengers", icon: UserRound },
  { to: "/events", label: "Events", icon: Sparkles },
  { to: "/team", label: "Team & apps", icon: Shield },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
  { to: "/news-feed", label: "News Feed", icon: Megaphone },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/games", label: "Games", icon: Gamepad2 },
  { to: "/rewards-settings", label: "Rewards", icon: Trophy },
] as const;

function AuthenticatedLayout() {
  const { loading, user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();

  useDriverLocationPing();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  // Admins get browser push for new ride requests and events.
  useEffect(() => {
    if (user && isAdmin) {
      ensurePushSubscribed().catch(() => {});
    }
  }, [user, isAdmin]);

  if (loading || !user) {
    return <LoadingScreen label="Loading your dashboard" />;
  }

  // Strict role isolation — only admins may see the dispatch app. Being
  // signed in as a driver or passenger must NEVER grant access here.
  if (!isAdmin) {
    return <AccessDenied appName="dispatch / admin" signInHref="/auth" signInLabel="admin sign in" email={user.email} />;
  }

  const NAV = ADMIN_NAV;
  const meta = user.user_metadata as { first_name?: string; last_name?: string } | undefined;

  const activeItem = NAV.find(
    (i) => location.pathname === i.to || location.pathname.startsWith(i.to + "/"),
  );

  return (
    <div className="surface-blue fleet-shell flex min-h-screen">
      {/* Sidebar — floating matte rail */}
      <aside className="hidden shrink-0 flex-col items-center p-3 lg:flex">
        <div className="fleet-sidebar sticky top-3 flex w-[88px] flex-col items-center gap-1 px-3 py-4">
        <div className="mb-2 flex h-12 w-full items-center justify-center">
          <BrandMark className="h-9 w-9" />
        </div>

        <TooltipProvider delayDuration={0}>
          <nav className="flex max-h-[calc(100vh-19rem)] flex-1 flex-col items-center gap-1.5 overflow-y-auto py-1">
            {NAV.map((item) => {
              const active =
                location.pathname === item.to || location.pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.to}
                      aria-label={item.label}
                      className={cn(
                        "group relative flex h-11 w-11 items-center justify-center rounded-2xl outline-none transition-all duration-200",
                        active
                          ? "nav-active-gradient scale-[1.04]"
                          : "fleet-text-muted hover:-translate-y-0.5 hover:bg-[color:var(--fleet-panel-hover)] hover:text-[color:var(--fleet-text)]",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute -left-3 h-6 w-1 rounded-full transition-all duration-200"
                          style={{ background: "#E53958" }}
                        />
                      )}
                      <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
                    </Link>

                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>


          <div className="fleet-border-token mt-1 flex w-full flex-col items-center gap-1 border-t pt-3">
            {isAdmin && <NotificationBell />}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                  className="flex h-10 w-10 items-center justify-center rounded-xl fleet-text-muted transition hover:bg-[color:var(--fleet-panel-hover)] hover:text-[color:var(--fleet-text)]"
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={async () => {
                    await signOut();
                    navigate({ to: "/auth", replace: true });
                  }}
                  aria-label="Sign out"
                  className="flex h-10 w-10 items-center justify-center rounded-xl fleet-text-muted transition hover:bg-[color:var(--fleet-panel-hover)] hover:text-[color:var(--fleet-text)]"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out ({user.email})</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials(meta?.first_name, meta?.last_name) === "?"
                    ? (user.email ?? "?").slice(0, 2).toUpperCase()
                    : initials(meta?.first_name, meta?.last_name)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {meta?.first_name} {meta?.last_name}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
        </div>
      </aside>




      {/* Main */}
      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <BrandMark className="h-8 w-8" />
            <span className="font-display text-sm font-semibold tracking-tight">RedArt Dispatch</span>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && <NotificationBell />}
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Desktop top bar */}
        <div className="sticky top-0 z-30 hidden items-center justify-between gap-4 px-6 py-4 lg:flex">
          <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium fleet-text-muted">
            <span className="fleet-text-dim">RedArt</span>
            <span className="fleet-text-dim opacity-50">/</span>
            <span className="truncate font-semibold text-[color:var(--fleet-text)]">
              {activeItem?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && <NotificationBell />}
            <button
              onClick={toggleTheme}
              title="Toggle theme"
              className="fleet-row flex h-9 w-9 items-center justify-center rounded-xl fleet-text-muted"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="fleet-row flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {initials(meta?.first_name, meta?.last_name) === "?"
                  ? (user.email ?? "?").slice(0, 2).toUpperCase()
                  : initials(meta?.first_name, meta?.last_name)}
              </span>
              <span className="max-w-[160px] truncate text-xs font-medium text-[color:var(--fleet-text)]">
                {meta?.first_name ? `${meta.first_name} ${meta.last_name ?? ""}` : user.email}
              </span>
            </div>
          </div>
        </div>
        {/* Mobile bottom nav */}

        <nav className="fixed bottom-0 z-30 flex w-full items-center justify-around border-t border-border bg-surface/95 backdrop-blur lg:hidden">
          {NAV.slice(0, 5).map((item) => {
            const active =
              location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mx-auto max-w-[1600px] px-4 pb-24 pt-6 sm:px-6 lg:px-6 lg:pb-8 lg:pt-2">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
