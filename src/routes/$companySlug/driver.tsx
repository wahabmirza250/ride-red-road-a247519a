import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useEffect } from "react";
import { Car, DollarSign, LogOut, Sun, Moon, Loader2, MessageSquare, User, History } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { AccessDenied } from "@/components/AccessDenied";

export const Route = createFileRoute("/$companySlug/driver")({
  ssr: false,
  component: DriverLayout,
});

const NAV = [
  { to: "/driver", label: "Drive", icon: Car, exact: true },
  { to: "/driver/history", label: "History", icon: History, exact: false },
  { to: "/driver/messages", label: "Chat", icon: MessageSquare, exact: false },
  { to: "/driver/earnings", label: "Earnings", icon: DollarSign, exact: false },
  { to: "/driver/profile", label: "Profile", icon: User, exact: false },
] as const;

function DriverLayout() {
  const { companySlug } = Route.useParams();
  const { loading, user, isDriver, signOut } = useAuth();
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const pathname = typeof window !== "undefined" ? window.location.pathname : loc.pathname;
  const signInHref = `/${companySlug}/driver/signin`;
  const isPublicAuthRoute = pathname.replace(/\/$/, "").endsWith("/driver/signin");

  useEffect(() => {
    if (isPublicAuthRoute) return;
    if (loading) return;
    if (!user) window.location.replace(signInHref);
  }, [isPublicAuthRoute, loading, user, signInHref]);

  if (isPublicAuthRoute) return <Outlet />;

  if (loading || !user)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  // Strict role isolation — only accounts with the driver role may see the
  // driver app. Being signed in as an admin or passenger must NEVER grant
  // access here.
  if (!isDriver) {
    return <AccessDenied appName="driver" signInHref={signInHref} signInLabel="driver sign in" email={user.email} />;
  }


  return (
    <div className="fleet-shell surface-yellow min-h-screen pb-24">
      <header className="fleet-topbar sticky top-0 z-30 flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            R
          </span>
          <span className="text-sm font-semibold">Driver</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-accent">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={async () => {
              await signOut();
               window.location.replace("/driver/signin");
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl p-4">
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
      <InstallPrompt />
    </div>
  );
}
