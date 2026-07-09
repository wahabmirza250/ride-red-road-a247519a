import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  UserCircle2,
  Save,
  ShieldCheck,
  Pencil,
  Phone,
  Mail,
  MapPin,
  Calendar,
  IdCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"medicaid" | "alt">("medicaid");
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    address: "",
    medicaid_id: "",
    ssn_last4: "",
    date_of_birth: "",
  });
  const [saving, setSaving] = useState(false);

  const hasSavedProfile = !!(
    me.data &&
    me.data.first_name &&
    me.data.first_name !== "Guest" &&
    (me.data.medicaid_id || (me.data.ssn_last4 && me.data.date_of_birth))
  );

  useEffect(() => {
    if (!me.data) return;
    setF({
      first_name: me.data.first_name === "Guest" ? "" : me.data.first_name ?? "",
      last_name: me.data.last_name ?? "",
      phone: me.data.phone ?? "",
      email: me.data.email ?? "",
      address: (me.data as { address?: string | null }).address ?? "",
      medicaid_id: me.data.medicaid_id ?? "",
      ssn_last4: me.data.ssn_last4 ?? "",
      date_of_birth: me.data.date_of_birth ?? "",
    });
    if (me.data.ssn_last4 && !me.data.medicaid_id) setMode("alt");
  }, [me.data]);

  // Show the form automatically when there is no saved profile yet.
  useEffect(() => {
    if (!me.isLoading) setEditing(!hasSavedProfile);
  }, [me.isLoading, hasSavedProfile]);

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
          address: f.address || undefined,
          medicaid_id: mode === "medicaid" ? f.medicaid_id : undefined,
          ssn_last4: mode === "alt" ? f.ssn_last4 : undefined,
          date_of_birth: mode === "alt" ? f.date_of_birth : undefined,
        },
      });
      toast.success("Profile saved");
      await me.refetch();
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (me.isLoading) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // ---- Saved profile summary view ----
  if (!editing && hasSavedProfile && me.data) {
    const p = me.data as typeof me.data & { address?: string | null };
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-border/60 bg-surface/80 p-6 shadow-soft backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserCircle2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  {p.first_name} {p.last_name}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Your saved profile
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setEditing(true)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          </div>

          <div className="mt-5 space-y-3 text-sm">
            <Row icon={<Phone className="h-4 w-4" />} label="Phone" value={p.phone} />
            <Row icon={<Mail className="h-4 w-4" />} label="Email" value={p.email} />
            <Row
              icon={<MapPin className="h-4 w-4" />}
              label="Address"
              value={p.address}
            />
            <Row
              icon={<IdCard className="h-4 w-4" />}
              label="Medicaid ID"
              value={p.medicaid_id}
            />
            {!p.medicaid_id && p.ssn_last4 && (
              <Row
                icon={<IdCard className="h-4 w-4" />}
                label="SSN (last 4)"
                value={`•••• ${p.ssn_last4}`}
              />
            )}
            {p.date_of_birth && (
              <Row
                icon={<Calendar className="h-4 w-4" />}
                label="Date of birth"
                value={new Date(p.date_of_birth).toLocaleDateString()}
              />
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
            Your details are shared with the RedArt dispatch team so bookings
            get pre-filled and drivers can reach you.
          </div>
        </div>
      </div>
    );
  }

  // ---- Editable form ----
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-6 shadow-soft backdrop-blur">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">
            {hasSavedProfile ? "Edit your profile" : "Your profile"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your details so booking a ride is one tap.
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
          <div className="space-y-1.5">
            <Label>Home address</Label>
            <Textarea
              rows={2}
              value={f.address}
              onChange={(e) => upd("address", e.target.value)}
              placeholder="Street, City, State ZIP"
            />
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

          <div className="flex gap-2 pt-2">
            {hasSavedProfile && (
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-full"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving} className="flex-1 rounded-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" /> Save profile
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">
          {value}
        </div>
      </div>
    </div>
  );
}
