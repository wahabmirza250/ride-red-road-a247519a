import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AppLink, useAppNavigate } from "@/lib/appLink";
import { useEffect } from "react";
import { Radio, LogOut, Sun, Moon, Loader2, Waypoints, CalendarClock, History } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { AccessDenied } from "@/components/AccessDenied";
import { BrandMark } from "@/components/Brand";

export const Route = createFileRoute("/$companySlug/dispatch")({
  ssr: false,
  component: DispatchLayout,
});

const NAV = [
  { to: "/dispatch", label: "Board", icon: Radio, exact: true },
  { to: "/dispatch/routes", label: "Routes", icon: Waypoints, exact: false },
  { to: "/dispatch/schedule", label: "Schedule", icon: CalendarClock, exact: false },
  { to: "/dispatch/history", label: "History", icon: History, exact: false },
] as const;


function DispatchLayout() {
  const { loading, user, isDispatch, signOut } = useAuth();
  const nav = useAppNavigate();
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const pathname = typeof window !== "undefined" ? window.location.pathname : loc.pathname;
  const isPublicAuthRoute = pathname === "/dispatch/signin";

  useEffect(() => {
    if (isPublicAuthRoute) return;
    if (loading) return;
    if (!user) nav({ to: "/dispatch/signin", replace: true });
  }, [isPublicAuthRoute, loading, user, nav]);

  if (isPublicAuthRoute) return <Outlet />;

  if (loading || !user)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  // Strict role isolation — only accounts carrying the dispatch role may see
  // this app. Being signed in as an admin, driver or passenger must NEVER
  // grant access here.
  if (!isDispatch) {
    return (
      <AccessDenied
        appName="dispatch"
        signInHref="/dispatch/signin"
        signInLabel="dispatch sign in"
        email={user.email}
      />
    );
  }

  return (
    <div className="fleet-shell surface-blue min-h-screen pb-24">
      <header className="fleet-topbar sticky top-0 z-30 flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-sm font-semibold tracking-tight">RedArt Dispatch</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-accent">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={async () => {
              await signOut();
              nav({ to: "/dispatch/signin", replace: true });
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            title={`Sign out (${user.email})`}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        <Outlet />
      </main>

      <nav className="fleet-bottom-nav fixed bottom-3 left-1/2 z-30 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center justify-around p-1.5">
        {NAV.map((item) => {
          const active = item.exact ? loc.pathname === item.to : loc.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <AppLink
              key={item.to}
              to={item.to}
              className={cn(
                "fleet-nav-item flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                active && "fleet-nav-item-active",
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
