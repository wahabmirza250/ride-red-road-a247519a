import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Car, DollarSign, LogOut, Sun, Moon, Loader2, MessageSquare } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

export const Route = createFileRoute("/driver")({
  ssr: false,
  component: DriverLayout,
});

const NAV = [
  { to: "/driver", label: "Drive", icon: Car, exact: true },
  { to: "/driver/messages", label: "Messages", icon: MessageSquare, exact: false },
  { to: "/driver/earnings", label: "Earnings", icon: DollarSign, exact: false },
] as const;

function DriverLayout() {
  const { loading, user, isDriver, isAdmin, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (!user) nav({ to: "/driver/signin", replace: true });
    else if (!isDriver && !isAdmin) {
      // Wrong role — bounce to their own app
      nav({ to: "/rider", replace: true });
    }
  }, [loading, user, isDriver, isAdmin, nav]);

  if (loading || !user)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (!isDriver && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        This link is for drivers. Redirecting…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-20">
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4">
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
              nav({ to: "/driver/signin", replace: true });
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
      <nav className="fixed bottom-0 z-30 flex w-full items-center justify-around border-t border-border bg-surface/95 backdrop-blur">
        {NAV.map((item) => {
          const active = item.exact ? loc.pathname === item.to : loc.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-3 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <InstallPrompt />
    </div>
  );
}
