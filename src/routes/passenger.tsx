import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Home, PlusCircle, Newspaper, Sparkles, UserCircle2, LogOut, Trophy } from "lucide-react";
import { BrandMark, BrandWordmark } from "@/components/Brand";


import { cn } from "@/lib/utils";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";
import { trackVisitor } from "@/lib/passengerPublic.functions";
import { useAuth } from "@/lib/auth";
import { ensurePushSubscribed } from "@/lib/push";
import { AccessDenied } from "@/components/AccessDenied";

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
  const { user, isPassenger, isAdmin, isDriver, loading } = useAuth();

  useEffect(() => {
    // Auto-subscribe signed-in passengers to push (idempotent, one-time prompt).
    if (user) {
      ensurePushSubscribed().catch(() => {});
    }
  }, [user]);



  useEffect(() => {
    if (typeof window === "undefined") return;
    const deviceId = getOrCreateDeviceId();
    // No session expiration — guests can return any time to finish booking.
    track({ data: { device_id: deviceId } })
      .then((r) => {
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

  // The booking flow (pickup → vehicle) uses its own full-height sticky CTAs.
  // The floating tab bar is fixed at z-30 and would sit on top of those CTAs,
  // swallowing the tap that submits the ride, so it is hidden while booking.
  const isBooking = loc.pathname.startsWith("/passenger/book");

  // Strict role isolation — a signed-in admin or driver must NEVER see the
  // passenger app just because their session persists in this browser.
  // Guests (no session) can still browse and book without signing in.
  if (!loading && user && !isPassenger && (isAdmin || isDriver)) {
    return <AccessDenied appName="passenger" signInHref="/passenger/signup" signInLabel="passenger sign in" email={user.email} />;
  }


  return (
    <div
      className={cn(
        "surface-green relative min-h-screen bg-background text-foreground",
        isBooking ? "pb-0" : "pb-24",
      )}
    >
      <AuroraBackdrop />
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl">
        <Link to="/passenger" className="flex items-center">
          <BrandWordmark className="hidden h-7 sm:block" />
          <BrandMark className="h-8 w-8 sm:hidden" />
        </Link>

        {user ? (
          hasSession && (
            <button
              onClick={forget}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="Forget me on this device"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )
        ) : (
          <Link
            to="/passenger/signup"
            className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition hover:bg-primary/90"
          >
            Sign in / Sign up
          </Link>
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
