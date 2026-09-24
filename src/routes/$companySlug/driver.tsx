import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/mobile/AppShell";
import { useEffect } from "react";
import { Car, DollarSign, LogOut, Sun, Moon, Loader2, MessageSquare, User, History } from "lucide-react";
import { useAuth } from "@/lib/auth";


import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { AccessDenied } from "@/components/AccessDenied";


import { DriverCamera } from "@/components/driver/DriverCamera";

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


  const exitDriver = async () => { await signOut(); window.location.replace(signInHref); };
  const cameraKey = `${companySlug}:${user.id}`;
  return (
    <DriverCamera key={cameraKey} consentKey={cameraKey} onExit={exitDriver}>
    <AppShell kind="Driver" companySlug={companySlug} navigation={NAV} actions={
      <button type="button" aria-label="Sign out" className="mobile-app-icon-button" onClick={exitDriver}><LogOut aria-hidden="true" /></button>
    }>
      <Outlet />
      <InstallPrompt />
    </AppShell>
    </DriverCamera>
  );
}
