import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/Brand";
import { signInAsRole } from "@/lib/roleGuardedSignIn";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, isAdmin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Only auto-redirect if the already-signed-in user actually is an admin.
  // A signed-in non-admin viewing this page can sign out and try again;
  // we never bounce them into another app's surface from here.
  useEffect(() => {
    if (loading || !user) return;
    if (isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [loading, user, isAdmin, navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInAsRole(email, password, "admin");
      toast.success("Signed in");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-muted to-background px-4 py-10">
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
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Need a dispatch or admin account?{" "}
              <Link to="/auth/signup" className="font-medium text-foreground hover:underline">
                Create one with an invite code
              </Link>
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Passenger?{" "}
          <Link to="/passenger/signup" className="font-medium text-foreground hover:underline">
            Create a passenger account
          </Link>
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
