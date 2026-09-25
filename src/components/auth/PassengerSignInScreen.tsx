import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { signInAsRole } from "@/lib/roleGuardedSignIn";
import { resolveOwnCompanySlug, NO_COMPANY_MESSAGE } from "@/lib/ownCompanyRedirect";
import { CompanyEntry, CompanySignInHeader } from "./CompanyEntry";
import { AppBrand } from "@/components/mobile/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
export function PassengerSignInScreen({ companySlug }: { companySlug?: string }) {
  return companySlug ? <PassengerCompanySignIn companySlug={companySlug} /> : <CompanyEntry app="passenger" />;
}
function PassengerCompanySignIn({ companySlug }: { companySlug: string }) {
  const { user, loading, isPassenger } = useAuth();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (loading || !user || !isPassenger || busy) return;
    let cancelled = false;
    resolveOwnCompanySlug().then(slug => {
      if (cancelled) return;
      if (slug) window.location.replace(`/${slug}/passenger`);
      else setError(NO_COMPANY_MESSAGE);
    }).catch(() => !cancelled && setError("Unable to open your company. Please try again."));
    return () => { cancelled = true; };
  }, [loading, user, isPassenger, busy]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await signInAsRole(email, password, "passenger", companySlug);
      if (!result.companySlug) throw new Error(NO_COMPANY_MESSAGE);
      window.location.replace(`/${result.companySlug}/passenger`);
    } catch (err) { setError(err instanceof Error ? err.message : "Sign in failed"); setBusy(false); }
  }
  return <div className="mobile-auth-screen flex min-h-dvh items-center justify-center px-4 py-8">
    <div className="w-full max-w-md"><div className="mb-6 flex justify-center"><AppBrand subtitle="Passenger app" /></div>
      <div className="rounded-3xl border bg-surface p-6 shadow-lift">
        <CompanySignInHeader code={companySlug} /><h1 className="text-2xl font-semibold">Passenger sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Use the account your administrator created for you.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2"><Label htmlFor="passenger-email">Email</Label><Input id="passenger-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required className="h-12 text-base" /></div>
          <div className="space-y-2"><Label htmlFor="passenger-password">Password</Label><Input id="passenger-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required className="h-12 text-base" /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="h-12 w-full">{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </div>
    </div>
  </div>;
}
