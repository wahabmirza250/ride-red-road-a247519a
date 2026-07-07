import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

// Deterministic password derived from email so the same email always
// resolves to the same account without the user needing to remember one.
// Password-less UX only — not a security boundary.
function derivePassword(email: string) {
  const normalized = email.trim().toLowerCase();
  return `nemt::${normalized}::v1::redart`;
}

async function passwordlessSignIn(
  email: string,
  role: "passenger" | "driver" | "admin",
) {
  const normalized = email.trim().toLowerCase();
  const password = derivePassword(normalized);

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: normalized,
    password,
  });
  if (!signInError) return;

  // Account doesn't exist yet — create it silently.
  const redirectTo =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const { error: signUpError } = await supabase.auth.signUp({
    email: normalized,
    password,
    options: {
      emailRedirectTo: redirectTo,
      data: { role },
    },
  });
  if (signUpError) throw signUpError;

  const { error: retryError } = await supabase.auth.signInWithPassword({
    email: normalized,
    password,
  });
  if (retryError) throw retryError;
}

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, isAdmin, isDriver, isPassenger } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (isAdmin) navigate({ to: "/dashboard", replace: true });
    else if (isDriver) navigate({ to: "/driver", replace: true });
    else if (isPassenger) navigate({ to: "/passenger", replace: true });
    else navigate({ to: "/passenger", replace: true });
  }, [loading, user, isAdmin, isDriver, isPassenger, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await passwordlessSignIn(email, "passenger");
      toast.success("Signed in");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-muted to-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
              <span className="text-lg font-bold">R</span>
            </span>
            <span className="text-lg font-semibold tracking-tight">RedArt LLC</span>
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            NEMT Dispatch — Colorado Medicaid
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-8 shadow-lift">
          <h1 className="text-xl font-semibold tracking-tight">Continue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your email to continue. No password required.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
