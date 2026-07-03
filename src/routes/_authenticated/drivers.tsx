import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Plus, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { createDriver } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/drivers")({
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
  status: "available" | "on_trip" | "offline";
  rating: number;
  total_ratings: number;
  total_trips: number;
};

type ProfileRow = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };

function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data: drivers, error } = await supabase.from("drivers").select("*");
      if (error) throw error;
      const ids = (drivers ?? []).map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name, email, phone").in("id", ids)
        : { data: [] as ProfileRow[] };
      const map = new Map<string, ProfileRow>();
      (profs ?? []).forEach((p) => map.set(p.id, p));
      return (drivers ?? []).map((d) => ({
        ...(d as DriverRow),
        profile: map.get(d.user_id) ?? null,
      }));
    },
  });
}

function DriversPage() {
  const drivers = useDrivers();
  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<null | (DriverRow & { profile: ProfileRow | null })>(null);

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {drivers.isLoading && (
          <div className="col-span-full flex justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {drivers.data?.map((d) => (
          <button
            key={d.id}
            onClick={() => setEdit(d)}
            className="rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition hover:shadow-lift"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {d.profile?.first_name} {d.profile?.last_name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.profile?.email}
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
        {!drivers.isLoading && !drivers.data?.length && (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No drivers yet. Add your first driver above.
          </div>
        )}
      </div>

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
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await create({
        data: {
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          license_number: form.license_number || null,
          vehicle_make: form.vehicle_make || null,
          vehicle_model: form.vehicle_model || null,
          vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
          vehicle_plate: form.vehicle_plate || null,
          vehicle_color: form.vehicle_color || null,
        },
      });
      toast.success("Driver created");
      qc.invalidateQueries({ queryKey: ["drivers"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Add driver</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Password" className="sm:col-span-2">
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="License #">
          <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
        </Field>
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
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditDriverDialog({
  driver,
  onClose,
}: {
  driver: DriverRow & { profile: ProfileRow | null };
  onClose: () => void;
}) {
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
  const [saving, setSaving] = useState(false);

  const update = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase
        .from("profiles")
        .update({
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
        })
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
    },
    onSuccess: () => {
      toast.success("Driver updated");
      qc.invalidateQueries({ queryKey: ["drivers"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(false),
  });

  return (
    <DialogContent className="max-w-lg">
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
              <SelectItem value="on_trip">On trip</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="License #">
          <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
        </Field>
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
      </div>
      <DialogFooter>
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
      </DialogFooter>
    </DialogContent>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
