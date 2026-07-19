import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandMark, BrandWordmark } from "@/components/Brand";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { signInAsRole } from "@/lib/roleGuardedSignIn";

export const Route = createFileRoute("/passenger/signup")({
  ssr: false,
  component: PassengerAuthPage,
});

function PassengerAuthPage() {
  const navigate = useNavigate();
  const { user, loading, isPassenger } = useAuth();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [medicaidId, setMedicaidId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Only auto-navigate if the signed-in account is actually a passenger.
  useEffect(() => {
    if (loading || !user) return;
    if (isPassenger) navigate({ to: "/passenger", replace: true });
  }, [loading, user, isPassenger, navigate]);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo:
            typeof window !== "undefined" ? `${window.location.origin}/passenger` : undefined,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone.trim(),
            medicaid_id: medicaidId.trim() || null,
            role: "passenger",
          },
        },
      });
      if (error) throw error;
      // Auto-confirm on; sign in immediately.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) throw signInErr;
      toast.success("Welcome to RedArt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInAsRole(email, password, "passenger");
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
        <Link
          to="/passenger"
          className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex items-center gap-2">
            <BrandMark className="h-10 w-10 rounded-2xl shadow-soft ring-1 ring-border/50" />
            <BrandWordmark className="h-6" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Book a ride, track your driver, and earn rewards.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signup">Create account</TabsTrigger>
              <TabsTrigger value="signin">Sign in</TabsTrigger>
            </TabsList>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={handleSignUp} className="space-y-4">
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
                    placeholder="(555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Medicaid ID <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    value={medicaidId}
                    onChange={(e) => setMedicaidId(e.target.value)}
                    placeholder="Enter if you have one"
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
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">At least 6 characters.</p>
                </div>
                <Button type="submit" disabled={submitting} className="w-full rounded-full">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create passenger account"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signin" className="mt-5">
              <form onSubmit={handleSignIn} className="space-y-4">
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
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Driver?{" "}
          <Link to="/driver/signin" className="font-medium text-foreground hover:underline">
            Driver sign in
          </Link>
          {" · "}
          Dispatch?{" "}
          <Link to="/auth" className="font-medium text-foreground hover:underline">
            Staff sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
