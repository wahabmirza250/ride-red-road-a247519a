import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Star, Trash2, Camera, Car, Search } from "lucide-react";
import { toast } from "sonner";
import { createDriver, deleteDriver } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { Avatar } from "@/components/Avatar";
import { useSignedUrl } from "@/lib/signedUrl";
import { DriverPayPanel } from "@/components/admin/DriverPayPanel";
import { DriverActivityPanel } from "@/components/admin/DriverActivityPanel";
import { GasReceiptsPanel } from "@/components/expenses/GasReceiptsPanel";
import { DuplicateDriversPanel } from "@/components/admin/DuplicateDriversPanel";
import { filterDrivers } from "@/lib/canonicalDriver";

export const Route = createFileRoute("/$companySlug/_authenticated/drivers")({
  component: DriversPage,
});

type DriverRow = {
  id: string;
  user_id: string;
  license_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  merged_into: string | null;
  photo_url: string | null;
  vehicle_photo_path: string | null;
  status: "available" | "busy" | "offline";
  rating: number;
  total_ratings: number;
  total_trips: number;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
};

type DriverWithProfile = DriverRow & { profile: ProfileRow | null };

function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: async (): Promise<DriverWithProfile[]> => {
      const { data: drivers, error } = await supabase.from("drivers").select("*");
      if (error) throw error;
      const ids = (drivers ?? []).map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, email, phone, avatar_url")
            .in("id", ids)
        : { data: [] as ProfileRow[] };
      const map = new Map<string, ProfileRow>();
      (profs ?? []).forEach((p) => map.set(p.id, p));
      return (drivers ?? [])
        // A driver merged into another profile is history, not a live driver.
        .filter((d) => !(d as DriverRow).merged_into)
        .map((d) => ({
          ...(d as DriverRow),
          profile: map.get(d.user_id) ?? null,
        }));
    },
  });
}

function DriversPage() {
  const drivers = useDrivers();
  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<DriverWithProfile | null>(null);
  const [search, setSearch] = useState("");

  const visible = filterDrivers(
    (drivers.data ?? []).map((d) => ({
      ...d,
      first_name: d.profile?.first_name ?? null,
      last_name: d.profile?.last_name ?? null,
      email: d.profile?.email ?? null,
      phone: d.profile?.phone ?? null,
    })),
    search,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drivers"
        description="Fleet, status, and vehicle info."
        actions={
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Add driver
              </Button>
            </DialogTrigger>
            <NewDriverDialog onClose={() => setOpenNew(false)} />
          </Dialog>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, email, phone, driver ID, licence, plate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {search.trim() && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Showing {visible.length} of {drivers.data?.length ?? 0} drivers.
        </p>
      )}

      <DuplicateDriversPanel />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {drivers.isLoading && (
          <div className="col-span-full flex justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {visible.map((d) => (
          <button
            key={d.id}
            onClick={() => setEdit(d)}
            className="rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition hover:shadow-lift"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  bucket="driver-photos"
                  path={d.photo_url}
                  fallbackPath={d.profile?.avatar_url}
                  name={`${d.profile?.first_name ?? ""} ${d.profile?.last_name ?? ""}`}
                  size={40}
                  className="bg-muted"
                />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">
                    {d.profile?.first_name} {d.profile?.last_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.profile?.email}
                  </div>
                </div>
              </div>
              <StatusPill status={d.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Vehicle</div>
                <div className="font-medium">
                  {d.vehicle_year} {d.vehicle_make} {d.vehicle_model}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Plate</div>
                <div className="font-medium">{d.vehicle_plate ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Trips</div>
                <div className="font-medium">{d.total_trips}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Rating</div>
                <div className="flex items-center gap-1 font-medium">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                  {Number(d.rating).toFixed(2)}{" "}
                  <span className="text-muted-foreground">({d.total_ratings})</span>
                </div>
              </div>
            </div>
          </button>
        ))}
        {!drivers.isLoading && !visible.length && (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {search.trim()
              ? `No driver matches “${search.trim()}”.`
              : "No drivers yet. Add your first driver above."}
          </div>
        )}
      </div>

      <GasReceiptsPanel />

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && <EditDriverDialog driver={edit} onClose={() => setEdit(null)} />}
      </Dialog>
    </div>
  );
}

function NewDriverDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createDriver);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone: "",
    license_number: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    vehicle_plate: "",
    vehicle_color: "",
  });
  const [driverPhotoFile, setDriverPhotoFile] = useState<File | null>(null);
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const driverPhotoPreview = useObjectUrl(driverPhotoFile);
  const vehiclePhotoPreview = useObjectUrl(vehiclePhotoFile);

  async function submit() {
    const email = form.email.trim().toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!email || !form.password) return toast.error("Email and password are required — these are the driver's login");
    if (!emailRe.test(email)) return toast.error("Enter a valid email address (e.g. driver@example.com)");
    if (form.password.length < 6) return toast.error("Password must be at least 6 characters");
    if (
      !/^[A-Za-z][A-Za-z '\-]{1,}$/.test(form.first_name.trim()) ||
      !/^[A-Za-z][A-Za-z '\-]{1,}$/.test(form.last_name.trim())
    ) {
      return toast.error("First and last name must be at least 2 letters (letters, spaces, hyphens only)");
    }
    if (form.phone && !/^[+\d][\d\s()\-]{6,}$/.test(form.phone.trim())) return toast.error("Phone number looks invalid");
    if (form.vehicle_year) {
      const y = Number(form.vehicle_year);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(y) || y < 1980 || y > currentYear + 1) {
        return toast.error(`Vehicle year must be between 1980 and ${currentYear + 1}`);
      }
    }
    setSubmitting(true);
    try {
      const created = await create({
        data: {
          email,
          password: form.password,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim(),
          license_number: form.license_number || null,
          vehicle_make: form.vehicle_make || null,
          vehicle_model: form.vehicle_model || null,
          vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
          vehicle_plate: form.vehicle_plate || null,
          vehicle_color: form.vehicle_color || null,
        },
      });
      const uploadErrors: string[] = [];
      if (driverPhotoFile) {
        try {
          await uploadDriverPhotoForUser(created.user_id, driverPhotoFile);
        } catch (error) {
          uploadErrors.push(error instanceof Error ? error.message : "Driver photo upload failed");
        }
      }
      if (vehiclePhotoFile) {
        try {
          await uploadVehiclePhotoForUser(created.user_id, vehiclePhotoFile);
        } catch (error) {
          uploadErrors.push(error instanceof Error ? error.message : "Vehicle photo upload failed");
        }
      }
      toast.success(`Driver account created. They can sign in at /driver/signin with ${form.email}`, {
        duration: 8000,
      });
      if (uploadErrors.length) toast.error(`Driver created, but ${uploadErrors.join("; ")}`);
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-drivers-v2"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Create driver account</DialogTitle>
        <p className="text-xs text-muted-foreground">
          This creates a login for the driver. Share the email and password with them so they can
          sign in at <code className="rounded bg-muted px-1">/driver/signin</code>.
        </p>
      </DialogHeader>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Login credentials (required)
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email *">
            <Input
              type="email"
              placeholder="driver@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Password *">
            <Input
              type="text"
              placeholder="min 6 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
        </div>
        <button
          type="button"
          className="mt-2 text-[11px] font-medium text-primary hover:underline"
          onClick={() => {
            const p = Math.random().toString(36).slice(-10) + "A1!";
            setForm({ ...form, password: p });
            toast.success("Password generated — copy it before saving");
          }}
        >
          Generate random password
        </button>
      </div>

      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Driver info
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name *">
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name *">
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="License #">
          <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
        </Field>
        <PhotoUploadField
          label="Driver photo"
          description="PNG, JPG, or WebP. Transparent PNG is supported."
          previewUrl={driverPhotoPreview}
          kind="driver"
          onChange={setDriverPhotoFile}
        />
      </div>

      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Vehicle info
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vehicle year">
          <Input value={form.vehicle_year} onChange={(e) => setForm({ ...form, vehicle_year: e.target.value })} />
        </Field>
        <Field label="Vehicle make">
          <Input value={form.vehicle_make} onChange={(e) => setForm({ ...form, vehicle_make: e.target.value })} />
        </Field>
        <Field label="Vehicle model">
          <Input value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} />
        </Field>
        <Field label="Plate">
          <Input value={form.vehicle_plate} onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })} />
        </Field>
        <Field label="Color">
          <Input value={form.vehicle_color} onChange={(e) => setForm({ ...form, vehicle_color: e.target.value })} />
        </Field>
        <PhotoUploadField
          label="Vehicle photo"
          description="PNG, JPG, or WebP. Transparent PNG is supported."
          previewUrl={vehiclePhotoPreview}
          kind="vehicle"
          onChange={setVehiclePhotoFile}
        />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create login
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditDriverDialog({ driver, onClose }: { driver: DriverWithProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: driver.profile?.first_name ?? "",
    last_name: driver.profile?.last_name ?? "",
    phone: driver.profile?.phone ?? "",
    license_number: driver.license_number ?? "",
    vehicle_make: driver.vehicle_make ?? "",
    vehicle_model: driver.vehicle_model ?? "",
    vehicle_year: driver.vehicle_year ? String(driver.vehicle_year) : "",
    vehicle_plate: driver.vehicle_plate ?? "",
    vehicle_color: driver.vehicle_color ?? "",
    status: driver.status,
  });
  const [driverPhotoFile, setDriverPhotoFile] = useState<File | null>(null);
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useServerFn(deleteDriver);
  const driverPhotoPreview = useObjectUrl(driverPhotoFile);
  const vehiclePhotoPreview = useObjectUrl(vehiclePhotoFile);
  const savedDriverPhotoUrl = useSignedUrl("driver-photos", driver.photo_url);
  const legacyDriverPhotoUrl = useSignedUrl("avatars", driver.profile?.avatar_url);
  const savedVehiclePhotoUrl = useSignedUrl("vehicle-photos", driver.vehicle_photo_path);
  const driverPhotoUrl = driverPhotoPreview ?? savedDriverPhotoUrl ?? legacyDriverPhotoUrl;
  const vehiclePhotoUrl = vehiclePhotoPreview ?? savedVehiclePhotoUrl;

  async function handleDelete() {
    if (!confirm(`Delete ${driver.profile?.first_name ?? "this driver"}? This removes their login and cannot be undone.`)) return;
    setDeleting(true);
    try {
      await del({ data: { driver_id: driver.id } });
      toast.success("Driver deleted");
      qc.invalidateQueries({ queryKey: ["drivers"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  const update = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase
        .from("profiles")
        .update({ first_name: form.first_name, last_name: form.last_name, phone: form.phone })
        .eq("id", driver.user_id);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("drivers")
        .update({
          license_number: form.license_number || null,
          vehicle_make: form.vehicle_make || null,
          vehicle_model: form.vehicle_model || null,
          vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
          vehicle_plate: form.vehicle_plate || null,
          vehicle_color: form.vehicle_color || null,
          status: form.status,
        })
        .eq("id", driver.id);
      if (e2) throw e2;

      if (driverPhotoFile) await uploadDriverPhotoForUser(driver.user_id, driverPhotoFile);
      if (vehiclePhotoFile) await uploadVehiclePhotoForUser(driver.user_id, vehiclePhotoFile);
    },
    onSuccess: () => {
      toast.success("Driver updated");
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-drivers-v2"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(false),
  });

  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Edit driver</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onValueChange={(v: DriverRow["status"]) => setForm({ ...form, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="busy">Busy</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="License #">
          <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
        </Field>
        <PhotoUploadField
          label="Driver photo"
          description="PNG, JPG, or WebP. Transparent PNG is supported."
          previewUrl={driverPhotoUrl}
          kind="driver"
          onChange={setDriverPhotoFile}
        />
      </div>

      <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Vehicle info
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vehicle year">
          <Input value={form.vehicle_year} onChange={(e) => setForm({ ...form, vehicle_year: e.target.value })} />
        </Field>
        <Field label="Vehicle make">
          <Input value={form.vehicle_make} onChange={(e) => setForm({ ...form, vehicle_make: e.target.value })} />
        </Field>
        <Field label="Vehicle model">
          <Input value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} />
        </Field>
        <Field label="Plate">
          <Input value={form.vehicle_plate} onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })} />
        </Field>
        <Field label="Color">
          <Input value={form.vehicle_color} onChange={(e) => setForm({ ...form, vehicle_color: e.target.value })} />
        </Field>
        <PhotoUploadField
          label="Vehicle photo"
          description="PNG, JPG, or WebP. Transparent PNG is supported."
          previewUrl={vehiclePhotoUrl}
          kind="vehicle"
          onChange={setVehiclePhotoFile}
        />
      </div>

      <div className="mt-4 space-y-3">
        <DriverPayPanel driverId={driver.id} />
        <DriverActivityPanel driverId={driver.id} />
        <GasReceiptsPanel driverId={driver.id} />
      </div>

      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          Delete driver
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              setSaving(true);
              update.mutate();
            }}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function validateImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    toast.error("Choose an image file.");
    return false;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.error("Photo must be 8MB or smaller.");
    return false;
  }
  return true;
}

function imagePath(userId: string, prefix: "driver" | "vehicle", file: File) {
  const extFromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const extFromType = file.type.split("/")[1]?.replace("jpeg", "jpg");
  const ext = extFromName || extFromType || "png";
  return `${userId}/${prefix}-${Date.now()}.${ext}`;
}

async function uploadDriverPhotoForUser(userId: string, file: File) {
  const path = imagePath(userId, "driver", file);
  const { error } = await supabase.storage
    .from("driver-photos")
    .upload(path, file, { contentType: file.type || "image/png", upsert: true });
  if (error) throw new Error(error.message);

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_url: path })
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);
  return path;
}

async function uploadVehiclePhotoForUser(userId: string, file: File) {
  const path = imagePath(userId, "vehicle", file);
  const { error } = await supabase.storage
    .from("vehicle-photos")
    .upload(path, file, { contentType: file.type || "image/png", upsert: true });
  if (error) throw new Error(error.message);

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ vehicle_photo_path: path })
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);
  return path;
}

function PhotoUploadField({
  label,
  description,
  previewUrl,
  kind,
  onChange,
}: {
  label: string;
  description: string;
  previewUrl: string | null;
  kind: "driver" | "vehicle";
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted p-3">
        <div
          className={
            kind === "driver"
              ? "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted"
              : "flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted"
          }
        >
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
          ) : kind === "vehicle" ? (
            <div className="vehicle-photo-placeholder-gradient flex h-full w-full items-center justify-center">
              <Car className="h-9 w-9 text-white/90 drop-shadow" />
            </div>
          ) : (
            <Camera className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{description}</div>
          <div className="mt-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-accent">
              <Camera className="h-3.5 w-3.5" />
              {previewUrl ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (!file) {
                    onChange(null);
                    return;
                  }
                  if (!validateImageFile(file)) {
                    event.target.value = "";
                    return;
                  }
                  onChange(file);
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}