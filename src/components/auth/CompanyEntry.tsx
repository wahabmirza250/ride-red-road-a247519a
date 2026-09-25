import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/Brand";
import { resolveCompanySlug } from "@/lib/companyPublic.functions";
import { COMPANY_APPS, companyAppHref, normalizeCompanyCode, type CompanyApp } from "@/lib/companyAccess";
export function CompanyEntry({ app, title, message }: { app?: CompanyApp; title?: string; message?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = COMPANY_APPS.find(item => item.key === app)?.label;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const slug = normalizeCompanyCode(code);
      const company = await resolveCompanySlug({ data: { slug } });
      if (!company.found) throw new Error("Company code not found. Check the code with your administrator.");
      if (!company.active) throw new Error("This company is unavailable. Contact your administrator.");
      window.location.assign(companyAppHref(company.url_slug, app));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check your company. Please try again."); setBusy(false);
    }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
    <div className="w-full max-w-md space-y-6">
      <a href="/" className="flex justify-center"><BrandWordmark className="h-10" /></a>
      <form onSubmit={submit} className="space-y-5 rounded-3xl border bg-surface p-6 shadow-lift sm:p-8">
        <Building2 className="h-8 w-8 text-primary" />
        <div><h1 className="text-2xl font-semibold">{title ?? label ?? "Open your company"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message ?? "Enter the company code your transportation provider gave you. The same code works in every app."}</p></div>
        <div className="space-y-2"><Label htmlFor="company-code">Company code</Label><Input id="company-code" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={40} placeholder="e.g. walla" required className="h-12 text-base" /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="h-12 w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Checking company" /> : "Continue"}</Button>
        <p className="text-xs text-muted-foreground">Accounts are created by your administrator. Ask them for your code and login details.</p>
      </form>
    </div>
  </main>;
}
export function CompanySignInHeader({ code }: { code: string }) {
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-sm">
    <a href={`/${encodeURIComponent(code)}`} className="font-medium hover:underline">Company: {code}</a>
    <a href="/access" className="text-muted-foreground hover:underline">Change company</a>
  </div>;
}
