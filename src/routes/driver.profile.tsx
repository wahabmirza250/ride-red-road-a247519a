import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/Avatar";
import { toast } from "sonner";
import { Camera, Loader2, LogOut } from "lucide-react";

export const Route = createFileRoute("/driver/profile")({
  component: DriverProfile,
});

function DriverProfile() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<{
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    avatar_url: string | null;
  } | null>(null);
  const [driver, setDriver] = useState<{
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    vehicle_plate: string | null;
    rating: number;
    total_trips: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name,last_name,phone,email,avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setProfile({
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          avatar_url: data.avatar_url ?? null,
        });
      });
    supabase
      .from("drivers")
      .select("vehicle_make,vehicle_model,vehicle_year,vehicle_plate,rating,total_trips")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data && setDriver(data));
  }, [user]);

  async function save() {
    if (!user || !profile) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  async function uploadAvatar(file: File) {
    if (!user) return;
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (error) {
      setUploading(false);
      return toast.error(error.message);
    }
    await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
    setProfile((p) => (p ? { ...p, avatar_url: path } : p));
    setUploading(false);
    toast.success("Photo updated");
  }

  if (!profile)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 shadow-soft">
        <div className="relative">
          <Avatar path={profile.avatar_url} name={`${profile.first_name} ${profile.last_name}`} size={96} />
          <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
            />
          </label>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {profile.first_name} {profile.last_name}
          </div>
          <div className="text-xs text-muted-foreground">{profile.email}</div>
        </div>
        {driver && (
          <div className="grid grid-cols-2 gap-3 pt-2 text-center text-xs">
            <div>
              <div className="text-muted-foreground">Rating</div>
              <div className="font-semibold">★ {Number(driver.rating).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Trips</div>
              <div className="font-semibold">{driver.total_trips}</div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Personal info
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>First name</Label>
            <Input
              value={profile.first_name}
              onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Last name</Label>
            <Input
              value={profile.last_name}
              onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input
            value={profile.phone ?? ""}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
        </div>
        <Button onClick={save} disabled={saving} className="w-full rounded-full">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
        </Button>
      </div>

      {driver && (
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-4 text-sm">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Vehicle
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Make / model</span>
            <span className="font-medium">
              {driver.vehicle_year} {driver.vehicle_make} {driver.vehicle_model}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Plate</span>
            <span className="font-medium">{driver.vehicle_plate ?? "—"}</span>
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full rounded-full"
        onClick={async () => {
          await signOut();
          window.location.href = "/driver/signin";
        }}
      >
        <LogOut className="mr-2 h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}
