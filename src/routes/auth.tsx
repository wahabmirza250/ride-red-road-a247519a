import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/Brand";
import { signInAsRole } from "@/lib/roleGuardedSignIn";
import { supabase } from "@/lib/supabaseBrowser";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const BLOCK_KEY = "signin_blocked_message";

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, isAdmin, isOwner } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // A blocked sign-in (e.g. suspended provider) can tear the session down after
  // a redirect has already started; the reason is stashed so it survives.
  useEffect(() => {
    const stored = window.sessionStorage.getItem(BLOCK_KEY);
    if (stored) {
      window.sessionStorage.removeItem(BLOCK_KEY);
      setErrorMsg(stored);
    }
  }, []);

  // Platform owner takes absolute priority over every other role: that account
  // always lands on the owner console, never on a company dashboard.
  useEffect(() => {
    if (loading || !user || submitting) return;
    if (isOwner) {
      window.location.replace("/owner");
      return;
    }
    if (isAdmin) window.location.replace("/dashboard");
  }, [loading, user, isAdmin, isOwner, submitting, navigate]);

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
      window.location.replace(result.companySlug ? `/${result.companySlug}/dashboard` : "/dashboard");
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

          <p className="mt-3 text-sm text-muted-foreground">
            Dispatch &amp; admin sign in
          </p>
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
              Driver and dispatch accounts are created by the platform owner.
              Contact your administrator for access.
            </p>

          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Passenger?{" "}
          <a href="/passenger/signup" className="font-medium text-foreground hover:underline">
            Create a passenger account
          </a>
          {" · "}
          Driver?{" "}
          <Link to="/driver/signin" className="font-medium text-foreground hover:underline">
            Driver sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
