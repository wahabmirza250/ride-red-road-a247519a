import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/Brand";
import { signInAsRole } from "@/lib/roleGuardedSignIn";
import { resolveOwnCompanySlug, NO_COMPANY_MESSAGE } from "@/lib/ownCompanyRedirect";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const BLOCK_KEY = "signin_blocked_message";

/**
 * Admin / owner sign in. Rendered at `/{slug}/login` and at the legacy bare
 * `/auth`. The platform owner always wins over any company role.
 */
export function AdminSignInScreen({ companySlug }: { companySlug?: string }) {
  const { user, loading, isAdmin, isOwner } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(BLOCK_KEY);
    if (stored) {
      window.sessionStorage.removeItem(BLOCK_KEY);
      setErrorMsg(stored);
    }
  }, []);

  useEffect(() => {
    if (loading || !user || submitting) return;
    if (isOwner) {
      window.location.replace("/owner");
      return;
    }
    // NEVER route from the URL slug: an account signed in on another
    // company's /login must land on its OWN company dashboard.
    if (isAdmin) {
      resolveOwnCompanySlug().then((slug) => {
        if (slug) window.location.replace(`/${slug}/dashboard`);
        else setErrorMsg(NO_COMPANY_MESSAGE);
      });
    }
  }, [loading, user, isAdmin, isOwner, submitting]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await signInAsRole(email, password, "admin");
      if (result.isOwner) {
        window.location.replace("/owner");
        return;
      }
      toast.success("Signed in");
      if (!result.companySlug) throw new Error(NO_COMPANY_MESSAGE);
      window.location.replace(`/${result.companySlug}/dashboard`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      window.sessionStorage.setItem(BLOCK_KEY, msg);
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-blue flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-muted to-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/" className="inline-flex items-center">
            <BrandWordmark className="h-10" />
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">Dispatch &amp; admin sign in</p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift">
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signin-password">Password</Label>
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {errorMsg && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {errorMsg}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Driver and dispatch accounts are created by the platform owner. Contact your
              administrator for access.
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Passenger?{" "}
          <a
            href={companySlug ? `/${companySlug}/passenger/signup` : "/passenger/signup"}
            className="font-medium text-foreground hover:underline"
          >
            Create a passenger account
          </a>
          {" · "}
          Driver?{" "}
          <a
            href={companySlug ? `/${companySlug}/driver/signin` : "/driver/signin"}
            className="font-medium text-foreground hover:underline"
          >
            Driver sign in
          </a>
        </p>
      </div>
    </div>
  );
}
