import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/lib/supabaseBrowser';
import { setCompanySlug } from '@/lib/companyContext';
import { launchPublicDemo } from '@/lib/publicDemo.functions';
import { BrandWordmark } from '@/components/Brand';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/demo')({ head: () => ({ meta: [{ title: 'Full app demo — NEMT Solutions' }, { name: 'description', content: 'Explore every NEMT app with fictional demo data. No account or password required.' }] }), component: FullPublicDemo });
const apps = [['Admin dashboard','dashboard'],['Dispatch','live-ops'],['Driver app','driver'],['Passenger app','passenger'],['EDI billing','billing/edi']] as const;
function FullPublicDemo() {
  const launch = useServerFn(launchPublicDemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open(path: string) {
    setBusy(true); setError(null);
    try {
      const existing = await supabase.auth.getSession();
      const meta = existing.data.session?.user.app_metadata;
      let slug = meta?.public_demo === true && meta?.is_demo === true ? meta.demo_company_slug : null;
      if (typeof slug !== 'string' || !/^demo-[a-f0-9]{16}$/.test(slug)) {
        const result = await launch();
        const verified = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: result.token_hash });
        if (verified.error) throw new Error('Could not start the demo session. Please try again.');
        slug = result.slug;
      }
      setCompanySlug(slug);
      window.location.href = `/${slug}/${path}`;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open demo.'); setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground"><section className="w-full max-w-2xl rounded-3xl border border-border bg-surface p-6 shadow-soft sm:p-10"><BrandWordmark className="h-9" /><p className="mt-7 text-xs font-semibold uppercase tracking-widest text-primary">Full product demo · Public access</p><h1 className="mt-2 text-3xl font-semibold">One demo. Every app.</h1><p className="mt-4 text-muted-foreground">Explore the complete dashboard, dispatch, driver, passenger and EDI billing apps with saved fictional records. No account or password needed.</p><p className="my-5 text-sm text-muted-foreground">This is a shared sample company. Use sample information only. External submissions, camera connections and notifications are disabled.</p>{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={busy} onClick={() => void open('dashboard')}>{busy ? 'Opening the full demo…' : 'Open full demo'}</Button><nav aria-label="Demo apps" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{apps.map(([label,path]) => <Button key={path} variant="outline" disabled={busy} onClick={() => void open(path)}>{label}</Button>)}</nav><p className="mt-5 text-xs text-muted-foreground">Use “Switch app” inside the demo to move between apps.</p><a href="/access" className="mt-6 inline-block text-sm underline">Sign in to your company</a></section></main>;
}