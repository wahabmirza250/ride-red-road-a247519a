import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useEffect, useRef, useState } from "react";
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
  Camera,
  Trophy,
  Shield,
  Bell,
  Gift,
  ChevronRight,
  Car,
  CalendarDays,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Textarea } from "@/components/ui/textarea";
import {
  getMyPassengerProfile,
  upsertPassengerProfile,
} from "@/lib/passengerPublic.functions";

export const Route = createFileRoute("/$companySlug/$companySlug/passenger/profile")({
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

const PHOTO_KEY = "passenger_photo_dataurl";

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
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (typeof window !== "undefined") setPhoto(window.localStorage.getItem(PHOTO_KEY));
  }, []);

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

  useEffect(() => {
    if (!me.isLoading) setEditing(!hasSavedProfile);
  }, [me.isLoading, hasSavedProfile]);

  function upd<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  function pickPhoto(file: File) {
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Please choose an image under 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setPhoto(url);
      try {
        window.localStorage.setItem(PHOTO_KEY, url);
      } catch {
        toast.error("Photo is too large to save on this device.");
      }
    };
    reader.readAsDataURL(file);
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

  /* ---------------- Saved profile view ---------------- */
  if (!editing && hasSavedProfile && me.data) {
    const p = me.data as typeof me.data & {
      address?: string | null;
      created_at?: string | null;
    };
    const ridingSince = p.created_at
      ? new Date(p.created_at).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })
      : null;

    return (
      <div className="space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/15 via-surface to-surface p-6 shadow-soft">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <PhotoAvatar photo={photo} initials={initials(p.first_name, p.last_name)} onPick={() => fileRef.current?.click()} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {p.first_name} {p.last_name}
              </h1>
              {ridingSince && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Riding since {ridingSince}
                </div>
              )}
              <button
                onClick={() => setEditing(true)}
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-foreground backdrop-blur transition hover:bg-background"
              >
                <Pencil className="h-3 w-3" /> Edit profile
              </button>
            </div>
          </div>
        </div>

        {/* Programs */}
        <Section title="Programs">
          <RowLink
            to="/passenger/rewards"
            icon={<Trophy className="h-5 w-5" />}
            title="Rewards"
            body="Earn entries by completing rides."
            tint="amber"
          />
          <RowLink
            to="/passenger/safety"
            icon={<Shield className="h-5 w-5" />}
            title="Safety Hub"
            body="Emergency contacts and safety info."
            tint="emerald"
          />
        </Section>

        {/* Account */}
        <Section title="Account">
          <RowButton
            icon={<Bell className="h-5 w-5" />}
            title="Notifications"
            body="Ride alerts and updates."
            trailing={<span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
            onClick={() => toast.message("Notification preferences coming soon.")}
          />
          <RowButton
            icon={<Gift className="h-5 w-5" />}
            title="Refer a friend"
            body="Share RedArt with someone who needs a ride."
            onClick={async () => {
              const url = window.location.origin + "/passenger";
              try {
                if (navigator.share) await navigator.share({ title: "RedArt Rides", url });
                else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Referral link copied");
                }
              } catch {
                /* user cancelled */
              }
            }}
          />
        </Section>

        {/* Details */}
        <Section title="Your details">
          <DetailRow icon={<Phone className="h-4 w-4" />} label="Phone" value={p.phone} />
          <DetailRow icon={<Mail className="h-4 w-4" />} label="Email" value={p.email} />
          <DetailRow icon={<MapPin className="h-4 w-4" />} label="Address" value={p.address} />
          <DetailRow
            icon={<IdCard className="h-4 w-4" />}
            label="Medicaid ID"
            value={p.medicaid_id}
          />
          {!p.medicaid_id && p.ssn_last4 && (
            <DetailRow
              icon={<IdCard className="h-4 w-4" />}
              label="SSN (last 4)"
              value={`•••• ${p.ssn_last4}`}
            />
          )}
          {p.date_of_birth && (
            <DetailRow
              icon={<Calendar className="h-4 w-4" />}
              label="Date of birth"
              value={new Date(p.date_of_birth).toLocaleDateString()}
            />
          )}
        </Section>

        {/* Bottom icon row (quick jumps) */}
        <div className="grid grid-cols-4 gap-2 rounded-3xl border border-border/60 bg-surface p-3 shadow-soft">
          <QuickTile icon={<Gift className="h-4 w-4" />} label="Refer" />
          <QuickTile icon={<Car className="h-4 w-4" />} label="Rides" to="/passenger" />
          <QuickTile
            icon={<CalendarDays className="h-4 w-4" />}
            label="Schedule"
            to="/passenger/apply"
          />
          <QuickTile
            icon={<Users className="h-4 w-4" />}
            label="Profile"
            to="/passenger/profile"
            active
          />
        </div>
      </div>
    );
  }

  /* ---------------- Editable form ---------------- */
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
            <AddressAutocomplete
              value={f.address}
              onChange={(v) => upd("address", v)}
              onResolve={(p) => upd("address", p.address)}
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

/* ---------------- Building blocks ---------------- */

function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "?")[0] ?? ""}${(last ?? "")[0] ?? ""}`.toUpperCase();
}

function PhotoAvatar({
  photo,
  initials,
  onPick,
}: {
  photo: string | null;
  initials: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-primary/10 text-primary shadow-soft"
      aria-label={photo ? "Change photo" : "Add photo"}
    >
      {photo ? (
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xl font-semibold">
          {initials || "R"}
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 py-1 text-[10px] font-medium uppercase tracking-wide text-white opacity-90">
        <Camera className="h-3 w-3" />
        {photo ? "Change" : "Add photo"}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-surface shadow-soft">
        {children}
      </div>
    </section>
  );
}

const TINTS: Record<string, string> = {
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  primary: "bg-primary/10 text-primary",
};

function RowLink({
  to,
  icon,
  title,
  body,
  tint = "primary",
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  tint?: keyof typeof TINTS;
}) {
  return (
    <AppLink
      to={to}
      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-muted"
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${TINTS[tint]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{body}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </AppLink>
  );
}

function RowButton({
  icon,
  title,
  body,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-muted"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{body}</div>
      </div>
      {trailing ?? <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function DetailRow({
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
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}

function QuickTile({
  icon,
  label,
  to,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  to?: string;
  active?: boolean;
}) {
  const cls = `flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition ${
    active
      ? "bg-primary text-primary-foreground shadow-soft"
      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
  }`;
  if (to) {
    return (
      <AppLink to={to} className={cls}>
        {icon}
        {label}
      </AppLink>
    );
  }
  return (
    <button type="button" className={cls}>
      {icon}
      {label}
    </button>
  );
}
