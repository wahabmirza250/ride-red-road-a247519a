import { useState, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Menu, Moon, Sun, type LucideIcon } from 'lucide-react';
import { AppLink } from '@/lib/appLink';
import { useTheme } from '@/lib/theme';
import { isAppNavActive, tenantRelativePath } from '@/lib/appNavigation';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export type AppNavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean };

/** A vector mark stays crisp at every tablet density; the wordmark is real text. */
export function AppBrand({ subtitle }: { subtitle: string }) {
  return <span className="mobile-app-brand">
    <svg viewBox="0 0 48 48" aria-hidden="true" className="mobile-app-mark">
      <rect width="48" height="48" rx="14" fill="currentColor" />
      <path d="M13 34V14h6l10 12V14h6v20h-6L19 22v12z" fill="white" />
    </svg>
    <span className="min-w-0"><span className="mobile-app-wordmark">NEMT<span>Solutions</span></span><span className="mobile-app-subtitle">{subtitle}</span></span>
  </span>;
}

export function AppShell({ children, companySlug, kind, navigation, actions, hideMobileNavigation = false }: {
  children: ReactNode;
  companySlug: string;
  kind: 'Driver' | 'Passenger';
  navigation: readonly AppNavItem[];
  actions?: ReactNode;
  hideMobileNavigation?: boolean;
}) {
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const path = tenantRelativePath(pathname, companySlug);
  const hasMore = navigation.length > 5;
  const primary = hasMore ? navigation.slice(0, 4) : navigation;
  const extra = hasMore ? navigation.slice(4) : [];
  const moreActive = extra.some(item => isAppNavActive(path, item.to, item.exact));
  const provider = companySlug === 'walla' ? 'Walla Investment LLC' : companySlug.replace(/-/g, ' ');

  function navItem(item: AppNavItem, close = false) {
    const active = isAppNavActive(path, item.to, item.exact);
    const Icon = item.icon;
    return <AppLink key={item.to} to={item.to} aria-current={active ? 'page' : undefined}
      className={cn('mobile-app-nav-item', active && 'is-active')} onClick={() => close && setMoreOpen(false)}>
      <Icon aria-hidden="true" /><span>{item.label}</span>
    </AppLink>;
  }

  return <div className={cn('mobile-app-shell app-theme-controls', kind === 'Driver' && 'driver-nav-pad', hideMobileNavigation && 'mobile-app-booking')}>
    <a href="#app-content" className="mobile-app-skip">Skip to content</a>
    <header className="mobile-app-header">
      <AppLink to={kind === 'Driver' ? '/driver' : '/passenger'} aria-label={`${kind} home`} className="min-w-0">
        <AppBrand subtitle={`${provider} · ${kind}`} />
      </AppLink>
      <div className="mobile-app-header-actions">
        <button type="button" className="mobile-app-icon-button" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        {actions}
      </div>
    </header>
    <aside className="mobile-app-sidebar">
      <p className="mobile-app-nav-caption">{kind} workspace</p>
      <nav aria-label={`${kind} navigation`}>{primary.map(item => navItem(item))}{hasMore && <details open={moreActive}><summary className="mobile-app-nav-item">More</summary>{extra.map(item => navItem(item))}</details>}</nav>
      <p className="mobile-app-sidebar-footer">Your ride. Our care.</p>
    </aside>
    <main id="app-content" className="mobile-app-content" tabIndex={-1}>{children}</main>
    {!hideMobileNavigation && <nav className="mobile-app-bottom-nav" aria-label={`${kind} mobile navigation`}
      style={{ bottom: 'calc(var(--driver-safe-bottom) + var(--driver-nav-gap))' }}>
      {primary.map(item => navItem(item))}
      {hasMore && <button type="button" className={cn('mobile-app-nav-item', moreActive && 'is-active')} aria-label="More passenger options" onClick={() => setMoreOpen(true)}><Menu aria-hidden="true" /><span>More</span></button>}
    </nav>}
    <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader><SheetTitle>More passenger options</SheetTitle></SheetHeader>
        <nav className="mobile-app-more-grid" aria-label="More passenger navigation">{extra.map(item => navItem(item, true))}</nav>
      </SheetContent>
    </Sheet>
  </div>;
}
