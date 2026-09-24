import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AppLink, useAppNavigate } from "@/lib/appLink";
import { useEffect, useState } from "react";
import { Menu, LogOut, Sun, Moon } from "lucide-react";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "@/lib/adminNav";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseBrowser";
import { useTheme } from "@/lib/theme";
import { isAppNavActive, tenantRelativePath } from "@/lib/appNavigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/admin/NotificationBell";
import { ensurePushSubscribed } from "@/lib/push";
import { BrandMark } from "@/components/Brand";
import { CompanyLogo } from "@/components/CompanyLogo";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDenied } from "@/components/AccessDenied";
import { ViewAsBanner } from "@/components/owner/ViewAsBanner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/$companySlug/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { companySlug } = Route.useParams();
  const signInHref = `/${companySlug}/login`;
  const { loading, user, isAdmin, signOut, refresh } = useAuth();
  const navigate = useAppNavigate();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const relativePath = tenantRelativePath(location.pathname, companySlug);
  useEffect(() => setMenuOpen(false), [location.pathname, location.searchStr]);

  // Never bounce straight back to the login screen on a transient read. A
  // newly created or refreshing session can take longer to hydrate on a slow
  // device, so require several definitive empty reads before redirecting.
  useEffect(() => {
    if (loading || user) return;
    let cancelled = false;
    let timer: number | undefined;

    const verifySession = async (attempt: number) => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) {
        await refresh();
        return;
      }
      if (attempt < 3) {
        timer = window.setTimeout(() => void verifySession(attempt + 1), 1500);
        return;
      }
      window.location.replace(signInHref);
    };

    timer = window.setTimeout(() => void verifySession(0), 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loading, user, signInHref, refresh]);

  // Admins get browser push for new ride requests and events.
  useEffect(() => {
    if (user && isAdmin) {
      ensurePushSubscribed().catch(() => {});
    }
  }, [user, isAdmin]);

  if (loading || !user) {
    return <LoadingScreen label="Loading your dashboard" />;
  }

  // Strict role isolation — only admins may see the dispatch app. Being
  // signed in as a driver or passenger must NEVER grant access here.
  if (!isAdmin) {
    return (
      <AccessDenied
        appName="dispatch / admin"
        signInHref={signInHref}
        signInLabel="admin sign in"
        email={user.email}
      />
    );
  }

  const NAV = ADMIN_NAV;
  const meta = user.user_metadata as { first_name?: string; last_name?: string } | undefined;

  const activeItem = NAV.find((i) => isAppNavActive(relativePath, i.to));

  return (
    <div className="app-theme-controls surface-blue fleet-shell flex min-h-screen flex-col">
      <ViewAsBanner />
      <div className="flex flex-1">
        {/* Sidebar — premium floating rail */}
        <aside className="hidden shrink-0 flex-col items-center p-3 md:flex">
          <div className="rail sticky top-4 flex h-[calc(100vh-2rem)] w-[200px] flex-col items-center px-4 py-6">
            {/* Logo */}
            <div className="rail-logo mb-8 flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px]">
              <BrandMark className="h-10 w-10" />
            </div>

            <TooltipProvider delayDuration={0}>
              <nav className="rail-scroll flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto pb-2">
                {ADMIN_NAV_GROUPS.map((group, gi) => (
                  <div key={gi} className="flex w-full flex-col items-center gap-1">
                    {group.map((item) => {
                      const active = isAppNavActive(relativePath, item.to);
                      const Icon = item.icon;
                      return (
                        <Tooltip key={item.to}>
                          <TooltipTrigger asChild>
                            <AppLink
                              to={item.to}
                              aria-label={item.label}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "rail-item flex h-11 w-full shrink-0 cursor-pointer items-center gap-3 px-3 rounded-[20px] outline-none",
                                active && "rail-item-active",
                              )}
                            >
                              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                              <span className="text-xs">{item.label}</span>
                            </AppLink>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* Bottom cluster */}
              <div className="mt-6 flex w-full shrink-0 flex-col items-center gap-[18px]">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="rail-profile relative flex h-16 w-16 cursor-default flex-col items-center justify-center rounded-[20px]">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {initials(meta?.first_name, meta?.last_name) === "?"
                          ? (user.email ?? "?").slice(0, 2).toUpperCase()
                          : initials(meta?.first_name, meta?.last_name)}
                      </span>
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#18C98A] shadow-[0_0_8px_rgba(24,201,138,0.8)]" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {meta?.first_name
                      ? `${meta.first_name} ${meta.last_name ?? ""} — online`
                      : `${user.email} — online`}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={async () => {
                        await signOut();
                        window.location.replace(signInHref);
                      }}
                      aria-label="Sign out"
                      className="rail-item mt-2 flex h-12 w-12 cursor-pointer items-center justify-center rounded-[18px]"
                    >
                      <LogOut className="h-[20px] w-[20px]" strokeWidth={1.75} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign out ({user.email})</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-x-hidden">
          {/* Mobile top bar */}
          <div className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border px-4 md:hidden">
            <div className="flex items-center gap-2">
              <BrandMark className="h-8 w-8" />
              <span className="max-w-24 truncate text-sm font-semibold">
                {activeItem?.label ?? "Today"}
              </span>
              <CompanyLogo className="h-6" />
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Open all admin tools"
                onClick={() => setMenuOpen(true)}
                className="rounded-lg p-2"
              >
                <Menu className="h-4 w-4" />
              </button>
              {isAdmin && <NotificationBell />}
              <button
                onClick={toggleTheme}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                title="Toggle theme"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                aria-label="Sign out"
                onClick={async () => {
                  await signOut();
                  window.location.replace(signInHref);
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Desktop top bar */}
          <div className="sticky top-0 z-30 hidden items-center justify-between gap-4 px-6 py-4 md:flex">
            <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium fleet-text-muted">
              <span className="fleet-text-dim">NEMT Solutions</span>
              <span className="fleet-text-dim opacity-50">/</span>
              <span className="truncate font-semibold text-[color:var(--fleet-text)]">
                {activeItem?.label ?? "Dashboard"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && <NotificationBell />}
              <button
                onClick={toggleTheme}
                title="Toggle theme"
                className="fleet-row flex h-9 w-9 items-center justify-center rounded-xl fleet-text-muted"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div className="fleet-row flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {initials(meta?.first_name, meta?.last_name) === "?"
                    ? (user.email ?? "?").slice(0, 2).toUpperCase()
                    : initials(meta?.first_name, meta?.last_name)}
                </span>
                <span className="max-w-[160px] truncate text-xs font-medium text-[color:var(--fleet-text)]">
                  {meta?.first_name ? `${meta.first_name} ${meta.last_name ?? ""}` : user.email}
                </span>
              </div>
            </div>
          </div>
          {/* Mobile bottom nav */}

          <nav className="fixed bottom-0 z-30 flex w-full items-center justify-around border-t border-border bg-surface/95 backdrop-blur md:hidden">
            {NAV.filter((i) =>
              ["/dashboard", "/live-ops", "/trips", "/messages"].includes(i.to),
            ).map((item) => {
              const active = isAppNavActive(relativePath, item.to);
              const Icon = item.icon;
              return (
                <AppLink
                  key={item.to}
                  aria-current={active ? "page" : undefined}
                  to={item.to}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </AppLink>
              );
            })}
            <button
              onClick={() => setMenuOpen(true)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]"
            >
              <Menu className="h-5 w-5" />
              More
            </button>
          </nav>
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogTitle>All admin tools</DialogTitle>
              <nav className="grid grid-cols-2 gap-2">
                {NAV.map((item) => (
                  <AppLink
                    key={item.to}
                    to={item.to}
                    aria-current={isAppNavActive(relativePath, item.to) ? "page" : undefined}
                    className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </AppLink>
                ))}
              </nav>
            </DialogContent>
          </Dialog>
          <div className="mx-auto max-w-[1600px] px-4 pb-24 pt-6 sm:px-6 lg:px-6 lg:pb-8 lg:pt-2">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
