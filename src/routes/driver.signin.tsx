import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Car, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";
import { signInAsRole } from "@/lib/roleGuardedSignIn";

export const Route = createFileRoute("/driver/signin")({
  component: DriverSignIn,
});

function DriverSignIn() {
  const nav = useNavigate();
  const { user, loading, isDriver } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Only auto-navigate if the signed-in account is actually a driver.
  useEffect(() => {
    if (loading || !user) return;
    if (isDriver) window.location.replace("/driver");
  }, [loading, user, isDriver, nav]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInAsRole(email, password, "driver");
      toast.success("Welcome");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-yellow relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <AuroraBackdrop />
      <div className="w-full max-w-md animate-rise-in">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift">
              <Car className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">RedArt Driver</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Go online. Get trips. Get paid.</p>
        </div>

        <div className="rounded-3xl border border-border/60 bg-surface/70 p-8 shadow-lift backdrop-blur-xl">
          <h1 className="text-xl font-semibold tracking-tight">Driver sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the credentials your dispatcher gave you.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            {errorMsg && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {errorMsg}
              </p>
            )}
            <Button
              type="submit"
              disabled={submitting}
              className="group h-11 w-full rounded-full text-base"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            Passenger?{" "}
            <a href="/passenger" className="font-medium text-primary hover:underline">
              Open passenger app
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
