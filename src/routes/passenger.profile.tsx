import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, UserCircle2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMyPassengerProfile,
  upsertPassengerProfile,
} from "@/lib/passengerPublic.functions";

export const Route = createFileRoute("/passenger/profile")({
  component: ProfilePage,
});

function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem("passenger_device_id");
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem("passenger_device_id", id);
  }
  return id;
}

function ProfilePage() {
  const deviceId = getDeviceId();
  const fetchMe = useServerFn(getMyPassengerProfile);
  const saveFn = useServerFn(upsertPassengerProfile);

  const me = useQuery({
    queryKey: ["passenger-profile", deviceId],
    queryFn: () => fetchMe({ data: { device_id: deviceId } }),
    enabled: !!deviceId,
  });

  const [mode, setMode] = useState<"medicaid" | "alt">("medicaid");
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    medicaid_id: "",
    ssn_last4: "",
    date_of_birth: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setF({
      first_name: me.data.first_name === "Guest" ? "" : me.data.first_name ?? "",
      last_name: me.data.last_name ?? "",
      phone: me.data.phone ?? "",
      email: me.data.email ?? "",
      medicaid_id: me.data.medicaid_id ?? "",
      ssn_last4: me.data.ssn_last4 ?? "",
      date_of_birth: me.data.date_of_birth ?? "",
    });
    if (me.data.ssn_last4 && !me.data.medicaid_id) setMode("alt");
  }, [me.data]);

  function upd<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveFn({
        data: {
          device_id: deviceId,
          first_name: f.first_name,
          last_name: f.last_name,
          phone: f.phone || undefined,
          email: f.email || undefined,
          medicaid_id: mode === "medicaid" ? f.medicaid_id : undefined,
          ssn_last4: mode === "alt" ? f.ssn_last4 : undefined,
          date_of_birth: mode === "alt" ? f.date_of_birth : undefined,
        },
      });
      toast.success("Profile saved");
      me.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-6 shadow-soft backdrop-blur">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Your profile</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional — booking a ride works without an account. Save your details here
          so you don't have to type them again.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input value={f.first_name} onChange={(e) => upd("first_name", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={f.last_name} onChange={(e) => upd("last_name", e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => upd("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={f.email} onChange={(e) => upd("email", e.target.value)} />
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Identification
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Provide a Medicaid ID, or last 4 of your SSN with date of birth.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("medicaid")}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  mode === "medicaid"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                Medicaid ID
              </button>
              <button
                type="button"
                onClick={() => setMode("alt")}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  mode === "alt"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                SSN (last 4) + DOB
              </button>
            </div>

            {mode === "medicaid" ? (
              <div className="mt-3 space-y-1.5">
                <Label>Medicaid ID</Label>
                <Input
                  value={f.medicaid_id}
                  onChange={(e) => upd("medicaid_id", e.target.value)}
                  placeholder="e.g. A1234567890"
                />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Last 4 of SSN</Label>
                  <Input
                    value={f.ssn_last4}
                    onChange={(e) => upd("ssn_last4", e.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="1234"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Date of birth</Label>
                  <Input
                    type="date"
                    value={f.date_of_birth}
                    onChange={(e) => upd("date_of_birth", e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <Button type="submit" disabled={saving} className="mt-2 w-full rounded-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Save className="mr-2 h-4 w-4" /> Save profile</>)}
          </Button>
        </form>
      </div>
    </div>
  );
}
