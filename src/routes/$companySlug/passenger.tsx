import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useEffect, useState } from "react";
import { getCompanySlug } from "@/lib/companyContext";
import { CompanyLinkRequired } from "@/components/CompanyLinkRequired";

import { useServerFn } from "@tanstack/react-start";
import { Home, PlusCircle, Newspaper, Sparkles, UserCircle2, LogOut, Trophy, Gamepad2, MapPin } from "lucide-react";
import { AppShell } from "@/components/mobile/AppShell";
import { tenantRelativePath } from "@/lib/appNavigation";



import { InstallPrompt } from "@/components/pwa/InstallPrompt";

import { trackVisitor } from "@/lib/passengerPublic.functions";
import { useAuth } from "@/lib/auth";
import { ensurePushSubscribed } from "@/lib/push";
import { AccessDenied } from "@/components/AccessDenied";

export const Route = createFileRoute("/$companySlug/passenger")({
  ssr: false,
  component: PassengerLayout,
});

const TABS = [
  { to: "/passenger", label: "Home", icon: Home, exact: true },
  { to: "/passenger/apply", label: "Book", icon: PlusCircle },
  { to: "/passenger/track", label: "Track", icon: MapPin },
  { to: "/passenger/profile", label: "Profile", icon: UserCircle2 },
  { to: "/passenger/rewards", label: "Rewards", icon: Trophy },
  { to: "/passenger/games", label: "Games", icon: Gamepad2 },
  { to: "/passenger/events", label: "Events", icon: Sparkles },
  { to: "/passenger/news", label: "News", icon: Newspaper },
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
  const { companySlug: routeSlug } = Route.useParams();
  const track = useServerFn(trackVisitor);
  const { user, isPassenger, isDriver, loading } = useAuth();
  // Guests must arrive through a company-specific link. Resolved after mount
  // so SSR/hydration stay in sync.
  const [companySlug, setSlug] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setSlug(getCompanySlug());
  }, []);

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
  const isBooking = tenantRelativePath(loc.pathname, routeSlug).startsWith("/passenger/book/");

  // Strict role isolation — a signed-in admin or driver must NEVER see the
  // passenger app just because their session persists in this browser.
  // Guests (no session) can still browse and book without signing in.
  // Drivers stay blocked (their app is /driver). Admin/owner staff may view a
  // tenant's public booking page — it is a guest flow with no passenger data,
  // and the company shown comes strictly from the URL slug.
  if (!loading && user && !isPassenger && isDriver) {
    return <AccessDenied appName="passenger" signInHref="/passenger/signup" signInLabel="passenger sign in" email={user.email} />;
  }

  // Tenant safety — a guest with no company context must never be dropped
  // into some default company's booking flow. Signed-in passengers are scoped
  // by their own account's company, so they pass through.
  if (!loading && !user && companySlug === null) {
    return <CompanyLinkRequired />;
  }




  return (
    <AppShell kind="Passenger" companySlug={routeSlug} navigation={TABS} hideMobileNavigation={isBooking} actions={
      user ? (hasSession && <button type="button" onClick={forget} className="mobile-app-icon-button" aria-label="Forget me on this device"><LogOut aria-hidden="true" /></button>) : (
        <AppLink to="/passenger/signup" className="mobile-app-signin">Sign in</AppLink>
      )
    }>
      <Outlet />
      <InstallPrompt />
    </AppShell>
  );
}
