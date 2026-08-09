import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  ShieldAlert,
  Stethoscope,
  Trash2,
  UserPlus,
  Users,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandWordmark } from "@/components/Brand";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDenied } from "@/components/AccessDenied";
import {
  createCompany,
  createCompanyAdmin,
  deleteCompany,
  getOwnerOverview,
  isPlatformOwnerFn,
  runPortalHealthCheck,
  setCompanyStatus,
  setCompanyTwilioPhone,
  startViewAsCompany,

  type OwnerCompany,
} from "@/lib/owner.functions";

export const Route = createFileRoute("/owner/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Owner Console — RedArt Digital" },
      { name: "description", content: "Platform owner console for managing RedArt transportation companies." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Owner Console — RedArt Digital" },
      { property: "og:description", content: "Platform owner console for managing RedArt transportation companies." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OwnerConsole,
});

type Overview = Awaited<ReturnType<typeof getOwnerOverview>>;

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function OwnerConsole() {
  const { user, loading } = useAuth();
  const checkOwner = useServerFn(isPlatformOwnerFn);
  const fetchOverview = useServerFn(getOwnerOverview);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetchOverview({});
    setData(res);
  }, [fetchOverview]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setAllowed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { owner } = await checkOwner({});
        if (cancelled) return;
        setAllowed(owner);
        if (owner) await reload();
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, checkOwner, reload]);

  if (loading || (user && allowed === null)) return <LoadingScreen />;

  // Signed out → this isn't "access denied", they just need to sign in.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-soft">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The owner console is private. Sign in with your platform owner account to continue.
          </p>
          <Button asChild className="mt-6 w-full rounded-full">
            <a href="/owner/signin">Go to owner sign in</a>
          </Button>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <AccessDenied
        appName="RedArt owner console"
        signInHref="/owner/signin"
        signInLabel="owner sign in"
        email={user?.email ?? null}
      />
    );
  }


  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandWordmark className="h-7" />
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              Owner console
            </span>
          </div>
          <NewCompanyDialog onDone={reload} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        {!data ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Stat icon={Building2} label="Companies" value={data.totals.companies} />
              <Stat icon={Users} label="Drivers" value={data.totals.drivers} />
              <Stat icon={Users} label="Passengers" value={data.totals.passengers} />
              <Stat icon={Users} label="Dispatchers" value={data.totals.dispatchers} />
              <Stat icon={Activity} label="Trips" value={data.totals.trips} />
              <Stat icon={FileText} label="Claims" value={data.totals.claims} />
            </section>

            <section className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Companies</h2>
              {data.companies.map((c) => (
                <CompanyCard key={c.id} company={c} onChanged={reload} busy={busy} setBusy={setBusy} />
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function CompanyCard({
  company: c,
  onChanged,
  busy,
  setBusy,
}: {
  company: OwnerCompany;
  onChanged: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const toggleStatus = useServerFn(setCompanyStatus);
  const healthCheck = useServerFn(runPortalHealthCheck);
  const removeCompany = useServerFn(deleteCompany);
  const viewAs = useServerFn(startViewAsCompany);
  const [health, setHealth] = useState<{ ok: boolean; active: boolean; detail: string; at?: string } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const suspended = c.status !== "active";

  async function onToggle() {
    setBusy(true);
    try {
      await toggleStatus({ data: { company_id: c.id, status: suspended ? "active" : "suspended" } });
      toast.success(suspended ? `${c.name} reactivated` : `${c.name} suspended`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusy(false);
    }
  }

  async function onHealthCheck() {
    setChecking(true);
    setHealth(null);
    try {
      const r = await healthCheck({ data: { company_id: c.id } });
      setHealth({
        ok: r.ok,
        active: r.account_active,
        detail: typeof r.detail === "string" ? r.detail : "",
        at: "checked_at" in r ? (r.checked_at as string) : undefined,
      });
    } catch (e) {
      setHealth({ ok: false, active: false, detail: e instanceof Error ? e.message : "Health check failed" });
    } finally {
      setChecking(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Permanently delete ${c.name}? This only works for companies with no trips.`)) return;
    setBusy(true);
    try {
      await removeCompany({ data: { company_id: c.id } });
      toast.success(`${c.name} deleted`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete company");
    } finally {
      setBusy(false);
    }
  }

  async function onViewAs() {
    setBusy(true);
    try {
      const r = await viewAs({ data: { company_id: c.id } });
      window.location.assign(`/${r.slug}/dashboard`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that company");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {c.logo_signed_url ? (
            <img
              src={c.logo_signed_url}
              alt={`${c.name} logo`}
              className="h-11 w-11 rounded-xl object-contain"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold">{c.name}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  suspended ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"
                }`}
              >
                {suspended ? "Suspended" : "Active"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              redartdigital.com/{c.url_slug} · last activity {fmtDate(c.last_activity)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="rounded-full" onClick={onViewAs} disabled={busy || suspended}>
            <Eye className="mr-1 h-3.5 w-3.5" />
            View as company
          </Button>
          <StaffManagerDialog companyId={c.id} companyName={c.name} onChanged={onChanged} />
          <Button variant="outline" size="sm" className="rounded-full" onClick={onHealthCheck} disabled={checking}>
            {checking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="mr-1 h-3.5 w-3.5" />}
            Health check
          </Button>
          <Button
            variant={suspended ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={onToggle}
            disabled={busy}
          >
            {suspended ? <Play className="mr-1 h-3.5 w-3.5" /> : <Pause className="mr-1 h-3.5 w-3.5" />}
            {suspended ? "Reactivate" : "Suspend"}
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full text-destructive" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-7">
        <Mini label="Drivers" value={c.drivers} />
        <Mini label="Passengers" value={c.passengers} />
        <Mini label="Dispatchers" value={c.dispatchers} />
        <Mini label="Admins" value={c.admins} />
        <Mini label="Trips" value={c.trips} />
        <Mini label="Claims" value={c.claims} />
        <Mini
          label="Earnings"
          value={c.earnings.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        />
      </div>


      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {c.has_portal_credentials ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          )}
          Portal credentials {c.has_portal_credentials ? "configured" : "missing"}
          {c.has_portal_credentials && ` · last used ${fmtDate(c.portal_last_verified)}`}
        </span>
        <span className="inline-flex items-center gap-1">
          {c.has_billing_rates ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          )}
          Billing rates {c.has_billing_rates ? "configured" : "missing"}
        </span>
      </div>

      <TwilioNumberField companyId={c.id} current={c.twilio_phone} />



      {health && (
        <div
          className={`mt-4 rounded-2xl border p-3 text-xs ${
            health.active
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
          }`}
        >
          <p className="font-semibold">
            {health.active ? "Portal account active" : "Portal account not confirmed"}
            {health.at && ` · ${fmtDate(health.at)}`}
          </p>
          {health.detail && <p className="mt-1 opacity-90">{health.detail}</p>}
        </div>
      )}
    </div>
  );
}

/** Maps the company's Twilio number so inbound booking texts route to it. */
function TwilioNumberField({ companyId, current }: { companyId: string; current: string | null }) {
  const save = useServerFn(setCompanyTwilioPhone);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2">
      <div className="min-w-[220px] flex-1">
        <Label className="text-[11px] text-muted-foreground">SMS booking number (Twilio)</Label>
        <Input
          value={value}
          placeholder="+1 555 123 4567"
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        disabled={busy || value === (current ?? "")}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await save({ data: { company_id: companyId, twilio_phone: value || null } });
            setValue(res.twilio_phone ?? "");
            toast.success("SMS number saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save number");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}


function Mini({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function NewCompanyDialog({ onDone }: { onDone: () => Promise<void> }) {
  const create = useServerFn(createCompany);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const autoSlug = useMemo(() => slugify(name), [name]);
  const effectiveSlug = slug || autoSlug;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let logo_base64: string | null = null;
      let logo_ext: string | null = null;
      if (file) {
        const buf = await file.arrayBuffer();
        let bin = "";
        new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
        logo_base64 = window.btoa(bin);
        logo_ext = (file.name.split(".").pop() ?? "png").toLowerCase();
      }
      await create({ data: { name, url_slug: effectiveSlug, logo_base64, logo_ext } });
      toast.success(`${name} created at /${effectiveSlug}`);
      setOpen(false);
      setName("");
      setSlug("");
      setFile(null);
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create company");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New company
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a company</DialogTitle>
          <DialogDescription>
            Each company gets its own URL prefix and fully isolated data.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="co-name">Company name</Label>
            <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-slug">URL slug</Label>
            <Input
              id="co-slug"
              value={slug}
              placeholder={autoSlug || "company-name"}
              onChange={(e) => setSlug(slugify(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">redartdigital.com/{effectiveSlug || "…"}/driver</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-logo">Logo (optional)</Label>
            <Input
              id="co-logo"
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="rounded-full" disabled={saving || !name || !effectiveSlug}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create company
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewAdminDialog({ companyId, companyName }: { companyId: string; companyName: string }) {
  const create = useServerFn(createCompanyAdmin);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await create({
        data: { company_id: companyId, email, password, first_name: firstName, last_name: lastName },
      });
      toast.success(`Admin created for ${companyName}`);
      setOpen(false);
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create admin");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="rounded-full" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-3.5 w-3.5" /> Add admin
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New admin for {companyName}</DialogTitle>
          <DialogDescription>
            This account can manage only {companyName}'s drivers, trips and billing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ad-first">First name</Label>
              <Input id="ad-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-last">Last name</Label>
              <Input id="ad-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-email">Email</Label>
            <Input id="ad-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ad-pass">Temporary password</Label>
            <Input
              id="ad-pass"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="rounded-full" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create admin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
