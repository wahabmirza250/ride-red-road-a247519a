import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Route as RouteIcon,
  Users,
  UserRound,
  Receipt,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  CalendarClock,
  Newspaper,
  Gamepad2,
  LogOut,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/trips", label: "Trips", icon: RouteIcon },
  { to: "/drivers", label: "Drivers", icon: Users },
  { to: "/passengers", label: "Passengers", icon: UserRound },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/messages", label: "Dispatch", icon: MessageSquare },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
] as const;

function AuthenticatedLayout() {
  const { loading, user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-soft">
          <h1 className="text-xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This dashboard is for RedArt LLC administrators. Contact dispatch to have your
            account promoted, or use the driver / passenger app instead.
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
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <span className="text-base font-bold">R</span>
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight leading-tight">RedArt LLC</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              NEMT Dispatch
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active =
              location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-primary/8 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {initials(meta?.first_name, meta?.last_name) === "?"
                ? (user.email ?? "?").slice(0, 2).toUpperCase()
                : initials(meta?.first_name, meta?.last_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {meta?.first_name} {meta?.last_name}
              </div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-bold">R</span>
            </span>
            <span className="text-sm font-semibold">RedArt Dispatch</span>
          </div>
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
