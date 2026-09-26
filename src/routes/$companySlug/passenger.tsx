import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { Home, PlusCircle, Newspaper, Sparkles, UserCircle2, LogOut, Trophy, Gamepad2, MapPin } from "lucide-react";
import { AppShell } from "@/components/mobile/AppShell";
import { tenantRelativePath } from "@/lib/appNavigation";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { useAuth } from "@/lib/auth";
import { AccessDenied } from "@/components/AccessDenied";
export const Route = createFileRoute("/$companySlug/passenger")({ ssr: false, component: PassengerLayout });

const TABS = [
  { to: "/passenger", label: "Home", icon: Home, exact: true },
  { to: "/passenger/apply", label: "Book", icon: PlusCircle },
  { to: "/passenger/track", label: "My rides", icon: MapPin },
  { to: "/passenger/profile", label: "Profile", icon: UserCircle2 },
  { to: "/passenger/rewards", label: "Rewards", icon: Trophy },
  { to: "/passenger/games", label: "Games", icon: Gamepad2 },
  { to: "/passenger/events", label: "Events", icon: Sparkles },
  { to: "/passenger/news", label: "Local news", icon: Newspaper },
] as const;

function PassengerLayout() {
  const loc = useLocation();
  const { companySlug } = Route.useParams();
  const { user, isPassenger, loading, signOut } = useAuth();
  const signInHref = `/${companySlug}/passenger/signin`;
  const authPage = /\/(signin|signup)\/?$/.test(loc.pathname);
  useEffect(() => {
    if (!loading && !user && !authPage) window.location.replace(signInHref);
  }, [loading, user, authPage, signInHref]);
  if (authPage) return <Outlet />;
  if (loading || !user) return <div className="p-8 text-center">Loading your passenger app…</div>;
  if (!isPassenger) return <AccessDenied appName="passenger" signInHref={signInHref} signInLabel="passenger sign in" email={user.email} />;
  const isBooking = tenantRelativePath(loc.pathname, companySlug).startsWith("/passenger/book/");
  return <AppShell kind="Passenger" companySlug={companySlug} navigation={TABS} hideMobileNavigation={isBooking} actions={
    <button type="button" onClick={async () => { await signOut(); window.location.replace(signInHref); }} className="mobile-app-icon-button" aria-label="Sign out"><LogOut aria-hidden="true" /></button>
  }><Outlet /><InstallPrompt /></AppShell>;
}
