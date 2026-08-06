import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Radio, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";
import { signInAsRole } from "@/lib/roleGuardedSignIn";

export const Route = createFileRoute("/dispatch/signin")({
  component: DispatchSignIn,
});

function DispatchSignIn() {
  const nav = useNavigate();
  const { user, loading, isDispatch } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    if (isDispatch) window.location.replace("/dispatch");
  }, [loading, user, isDispatch, nav]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInAsRole(email, password, "dispatch");
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
    <div className="surface-blue relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <AuroraBackdrop />
      <div className="w-full max-w-md animate-rise-in">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lift">
              <Radio className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">RedArt Dispatch</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Assign drivers. Build routes. Keep the day on time.
          </p>
        </div>

        <div className="rounded-3xl border border-border/60 bg-surface/70 p-8 shadow-lift backdrop-blur-xl">
          <h1 className="text-xl font-semibold tracking-tight">Dispatcher sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the credentials your administrator gave you.
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
              <p
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
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
        </div>
      </div>
    </div>
  );
}
