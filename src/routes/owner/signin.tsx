import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAsRole } from "@/lib/roleGuardedSignIn";

export const Route = createFileRoute("/owner/signin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Platform Owner Sign In — RedArt Digital" },
      {
        name: "description",
        content: "Restricted sign-in for the RedArt Digital platform owner console.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Platform Owner Sign In — RedArt Digital" },
      {
        property: "og:description",
        content: "Restricted sign-in for the RedArt Digital platform owner console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OwnerSignIn,
});

function OwnerSignIn() {
  const { user, loading, isOwner } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    if (isOwner) window.location.replace("/owner");
  }, [loading, user, isOwner]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInAsRole(email, password, "platform_owner");
      toast.success("Owner session started");
      window.location.replace("/owner");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080b14] px-4 py-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[38rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-primary shadow-lift">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-white">
            Platform Owner Access
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Restricted console. This entry point is separate from company sign-in.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="owner-email" className="text-white/70">
                Owner email
              </Label>
              <Input
                id="owner-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-password" className="text-white/70">
                Password
              </Label>
              <Input
                id="owner-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                required
              />
            </div>

            {errorMsg && (
              <p
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                role="alert"
              >
                {errorMsg}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Enter owner console
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-white/35">
          Company admins, dispatchers and drivers sign in at their own provider link.
          All owner sign-in attempts are role-verified server side.
        </p>
      </div>
    </div>
  );
}
