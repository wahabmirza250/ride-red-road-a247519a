import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert } from "lucide-react";

type Props = {
  /** Human name of the app the visitor tried to access. */
  appName: string;
  /** Sign-in route for the correct app for this account. */
  signInHref: string;
  /** Label for the sign-in link button. */
  signInLabel?: string;
  /** Email of the currently signed-in account, for clarity. */
  email?: string | null;
};

/**
 * Full-screen "wrong account" screen shown when a signed-in user reaches an
 * app surface they don't have the role for. We never silently redirect the
 * user into another app — they must explicitly sign out first.
 */
export function AccessDenied({ appName, signInHref, signInLabel = "Sign in", email }: Props) {
  const [busy, setBusy] = useState(false);

  async function signOutAndGo() {
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } finally {
      // Hard nav so every in-memory app-scoped state (queries, subscriptions)
      // is dropped along with the session.
      window.location.replace(signInHref);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {email ? <><span className="font-medium text-foreground">{email}</span> isn't </> : "This account isn't "}
          authorized to use the {appName} app. Sign out and use the correct sign-in page for your account.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={signOutAndGo} disabled={busy} className="w-full rounded-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Sign out & go to ${signInLabel}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
