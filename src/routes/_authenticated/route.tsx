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
  Loader2,
  ClipboardList,
  FileSignature,
  Sun,
  Moon,
  Radio,
  Megaphone,
  Shield,
  Sparkles,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const ADMIN_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/live-ops", label: "Live Ops", icon: Radio },
  { to: "/trips", label: "Trips", icon: RouteIcon },
  { to: "/medicaid-billing", label: "Medicaid Billing", icon: FileSignature },
  { to: "/drivers", label: "Drivers", icon: Users },
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

const DRIVER_NAV = [
  { to: "/medicaid-trips", label: "My Trips", icon: ClipboardList },
  { to: "/medicaid-trips/new", label: "New Trip", icon: FileSignature },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/games", label: "Games", icon: Gamepad2 },
] as const;

function AuthenticatedLayout() {
  const { loading, user, isAdmin, isDriver, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();

  useDriverLocationPing();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  // Admins get browser push for new ride requests and events.
  useEffect(() => {
    if (user) {
      ensurePushSubscribed().catch(() => {});
    }
  }, [user]);



  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const NAV = isAdmin ? ADMIN_NAV : isDriver ? DRIVER_NAV : [];

  if (!isAdmin && !isDriver) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-soft">
          <h1 className="text-xl font-semibold">No access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account has no role assigned. Contact dispatch to be added as a driver or admin.
          </p>
          <Button
            className="mt-6 rounded-full"
            variant="secondary"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth", replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const meta = user.user_metadata as { first_name?: string; last_name?: string } | undefined;

  return (
    <div className="flex min-h-screen bg-surface-muted">
      {/* Sidebar */}
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 w-full items-center justify-center">
          <BrandMark className="h-8 w-8" />
        </div>

        <TooltipProvider delayDuration={0}>
          <nav className="flex flex-1 flex-col items-center gap-1 py-2">
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
                        "flex h-10 w-10 items-center justify-center rounded-lg outline-none",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>

          <div className="flex w-full flex-col items-center gap-1 border-t border-border py-3">
            {isAdmin && <NotificationBell />}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
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
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out ({user.email})</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
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
        <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pb-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
