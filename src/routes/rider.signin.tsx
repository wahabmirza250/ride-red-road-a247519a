import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Car } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/rider/signin")({
  component: RiderSignIn,
});

function RiderSignIn() {
  const nav = useNavigate();
  const { user, loading, isDriver, isAdmin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (isDriver) nav({ to: "/driver", replace: true });
    else if (isAdmin) nav({ to: "/dashboard", replace: true });
    else nav({ to: "/rider", replace: true });
  }, [loading, user, isDriver, isAdmin, nav]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary/5 to-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
              <Car className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">RedArt Rider</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Book rides. Track your driver live.</p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-8 shadow-lift">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/rider/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Driver?{" "}
            <Link to="/driver/signin" className="hover:underline">
              Open driver app
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
