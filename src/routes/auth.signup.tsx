import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { staffSignupWithCode } from "@/lib/staffSignup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandWordmark } from "@/components/Brand";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/signup")({
  ssr: false,
  component: StaffSignupPage,
});

function StaffSignupPage() {
  const navigate = useNavigate();
  const { user, loading, isAdmin, isDriver, isPassenger } = useAuth();
  const signup = useServerFn(staffSignupWithCode);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (isAdmin) navigate({ to: "/dashboard", replace: true });
    else if (isDriver) navigate({ to: "/driver", replace: true });
    else if (isPassenger) navigate({ to: "/passenger", replace: true });
  }, [loading, user, isAdmin, isDriver, isPassenger, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await signup({
        data: {
          email: email.trim().toLowerCase(),
          password,
          first_name: firstName,
          last_name: lastName,
          phone,
          invite_code: inviteCode,
        },
      });
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) throw signInErr;
      toast.success("Account created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-blue flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-muted to-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/auth"
          className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>

        <div className="mb-6 flex flex-col items-center text-center">
          <BrandWordmark className="h-10" />
          <p className="mt-3 text-sm text-muted-foreground">
            Create a dispatch or admin account
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Invite code</Label>
              <Input
                type="password"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Provided by your organization"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Required — accounts cannot be created without a valid invite code.
              </p>
            </div>

            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
