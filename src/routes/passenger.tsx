import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Home, PlusCircle, Newspaper, Sparkles, UserCircle2, LogOut, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";
import { trackVisitor } from "@/lib/passengerPublic.functions";
import { useAuth } from "@/lib/auth";
import { ensurePushSubscribed } from "@/lib/push";

export const Route = createFileRoute("/passenger")({
  ssr: false,
  component: PassengerLayout,
});

const TABS = [
  { to: "/passenger", label: "Rides", icon: Home },
  { to: "/passenger/apply", label: "Book", icon: PlusCircle },
  { to: "/passenger/rewards", label: "Rewards", icon: Trophy },
  { to: "/passenger/events", label: "Events", icon: Sparkles },
  { to: "/passenger/news", label: "News", icon: Newspaper },
  { to: "/passenger/profile", label: "Profile", icon: UserCircle2 },
] as const;

function getOrCreateDeviceId(): string {
  let id = window.localStorage.getItem("passenger_device_id");
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem("passenger_device_id", id);
  }
  return id;
}

function PassengerLayout() {
  const loc = useLocation();
  const track = useServerFn(trackVisitor);
  const { user } = useAuth();

  useEffect(() => {
    // Auto-subscribe signed-in passengers to push (idempotent, one-time prompt).
    if (user) {
      ensurePushSubscribed().catch(() => {});
    }
  }, [user]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    const deviceId = getOrCreateDeviceId();
    // Throttle: only ping once per hour per device.
    const lastPing = Number(window.localStorage.getItem("passenger_last_ping") ?? "0");
    if (Date.now() - lastPing < 60 * 60_000) return;
    track({ data: { device_id: deviceId } })
      .then((r) => {
        window.localStorage.setItem("passenger_last_ping", String(Date.now()));
        if (r.city || r.region) {
          window.localStorage.setItem(
            "passenger_location",
            JSON.stringify({ city: r.city, region: r.region }),
          );
        }
      })
      .catch(() => {
        // Silent — the app works fine without tracking.
      });
  }, [track]);

  function forget() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("passenger_phone");
      window.localStorage.removeItem("passenger_medicaid");
      window.localStorage.removeItem("passenger_device_id");
      window.localStorage.removeItem("passenger_location");
      window.localStorage.removeItem("passenger_last_ping");
      window.location.reload();
    }
  }
  const hasSession =
    typeof window !== "undefined" &&
    !!window.localStorage.getItem("passenger_device_id");

  return (
    <div className="relative min-h-screen bg-background pb-24 text-foreground">
      <AuroraBackdrop />
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl">
        <Link to="/passenger" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-soft">
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">RedArt Rides</span>
        </Link>
        {hasSession && (
          <button
            onClick={forget}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Forget me on this device"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </header>
      <main className="mx-auto max-w-2xl p-4 animate-rise-in">
        <Outlet />
      </main>
      <nav className="fixed bottom-3 left-1/2 z-30 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-border/60 bg-background/80 p-1.5 shadow-lift backdrop-blur-xl">
        {TABS.map((t) => {
          const active = loc.pathname === t.to;
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[11px] font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-soft scale-[1.02]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
      <InstallPrompt />
    </div>
  );
}
