import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createPassengerAccount } from "@/lib/admin.functions";
import { VerifyMedicaidButton } from "@/components/VerifyMedicaidButton";

export const Route = createFileRoute("/_authenticated/passengers")({
  component: PassengersPage,
});

type Passenger = {
  id: string;
  first_name: string;
  last_name: string;
  medicaid_id: string;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  county: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

function PassengersPage() {
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<Passenger | null>(null);

  const passengers = useQuery({
    queryKey: ["passengers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passengers")
        .select("*")
        .order("last_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Passenger[];
    },
  });

  const filtered = (passengers.data ?? []).filter((p) => {
    const s = q.toLowerCase();
    if (!s) return true;
    return (
      p.first_name.toLowerCase().includes(s) ||
      p.last_name.toLowerCase().includes(s) ||
      p.medicaid_id.toLowerCase().includes(s) ||
      (p.phone ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Passengers"
        description="Colorado Medicaid ride recipients."
        actions={
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Add passenger
              </Button>
            </DialogTrigger>
            <PassengerFormDialog onClose={() => setOpenNew(false)} />
          </Dialog>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search name, Medicaid ID, phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Medicaid ID</th>
              <th className="px-4 py-3 text-left">County</th>
              <th className="px-4 py-3 text-left">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {passengers.isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : filtered.length ? (
              filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setEdit(p)}
                  className="cursor-pointer hover:bg-accent/60"
                >
                  <td className="px-4 py-3 font-medium">
                    {p.first_name} {p.last_name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.medicaid_id}</td>
                  <td className="px-4 py-3">{p.county ?? "—"}</td>
                  <td className="px-4 py-3">{p.phone ?? "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No passengers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && <PassengerFormDialog existing={edit} onClose={() => setEdit(null)} />}
      </Dialog>
    </div>
  );
}

function PassengerFormDialog({
  existing,
  onClose,
}: {
  existing?: Passenger;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useServerFn(createPassengerAccount);
  const [form, setForm] = useState({
    first_name: existing?.first_name ?? "",
    last_name: existing?.last_name ?? "",
    medicaid_id: existing?.medicaid_id ?? "",
    date_of_birth: existing?.date_of_birth ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    county: existing?.county ?? "",
    address: existing?.address ?? "",
    notes: existing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      if (existing) {
        const { error } = await supabase.from("passengers").update(form).eq("id", existing.id);
        if (error) throw error;
        toast.success("Updated");
      } else {
        await create({
          data: {
            first_name: form.first_name,
            last_name: form.last_name,
            medicaid_id: form.medicaid_id,
            date_of_birth: form.date_of_birth || null,
            phone: form.phone || null,
            email: form.email || null,
            county: form.county || null,
            address: form.address || null,
            notes: form.notes || null,
          },
        });
        toast.success("Passenger added");
      }
      qc.invalidateQueries({ queryKey: ["passengers"] });
      qc.invalidateQueries({ queryKey: ["passengers-all"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit passenger" : "Add passenger"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="First name">
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </F>
        <F label="Last name">
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </F>
        <F label="Medicaid ID" className="sm:col-span-2">
          <Input value={form.medicaid_id} onChange={(e) => setForm({ ...form, medicaid_id: e.target.value })} />
        </F>
        <F label="Date of birth">
          <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
        </F>
        <F label="County">
          <Input value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })} />
        </F>
        <F label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </F>
        <F label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </F>
        <F label="Address" className="sm:col-span-2">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </F>
        <F label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </F>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {existing ? "Save" : "Add"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function F({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
