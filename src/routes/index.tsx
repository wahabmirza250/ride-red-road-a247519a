import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Loader2, Car, User, Shield } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, user, isAdmin, isDriver } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user && isAdmin) return <Navigate to="/dashboard" />;
  if (user && isDriver) return <Navigate to="/driver" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-900 to-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
            <span className="text-lg font-bold">R</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">RedArt Rides</h1>
          <p className="mt-1 text-sm text-muted-foreground">Non-emergency medical transport</p>
        </div>

        <div className="space-y-3">
          <Link
            to="/passenger"
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft transition hover:bg-accent"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
              <User className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="font-semibold">I'm a passenger</div>
              <div className="text-xs text-muted-foreground">Track your ride — no sign-up needed</div>
            </div>
          </Link>

          <Link
            to="/driver/signin"
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft transition hover:bg-accent"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Car className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="font-semibold">I'm a driver</div>
              <div className="text-xs text-muted-foreground">Sign in with dispatch credentials</div>
            </div>
          </Link>

          <Link
            to="/auth"
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft transition hover:bg-accent"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
              <Shield className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="font-semibold">Admin / Dispatch</div>
              <div className="text-xs text-muted-foreground">Manage fleet and trips</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
