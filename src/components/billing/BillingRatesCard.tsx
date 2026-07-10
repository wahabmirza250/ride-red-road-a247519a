import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteBillingRateSetting,
  listBillingRateSettings,
  upsertBillingRateSetting,
  type BillingRateSetting,
  type UnitType,
  type VehicleType,
} from "@/lib/billingRates.functions";

const VEHICLE_LABELS: Record<VehicleType, string> = {
  ambulatory: "Ambulatory",
  wheelchair_van: "Wheelchair Van",
};

const UNIT_LABELS: Record<UnitType, string> = {
  trip: "Trip",
  mile: "Mile",
};

type FormState = {
  vehicle_type: VehicleType;
  procedure_code: string;
  charge_amount: string;
  unit_type: UnitType;
  place_of_service: string;
};

const EMPTY_FORM: FormState = {
  vehicle_type: "ambulatory",
  procedure_code: "",
  charge_amount: "",
  unit_type: "trip",
  place_of_service: "",
};

export function BillingRatesCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBillingRateSettings);
  const upsertFn = useServerFn(upsertBillingRateSetting);
  const deleteFn = useServerFn(deleteBillingRateSetting);

  const rows = useQuery({
    queryKey: ["billing_rate_settings"],
    queryFn: () => listFn(),
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ procedure_code?: string; charge_amount?: string }>({});

  const loadInto = (r: BillingRateSetting) => {
    setEditingId(r.id);
    setForm({
      vehicle_type: r.vehicle_type,
      procedure_code: r.procedure_code,
      charge_amount: String(r.charge_amount),
      unit_type: r.unit_type,
      place_of_service: r.place_of_service ?? "",
    });
    setErrors({});
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const upsert = useMutation({
    mutationFn: (payload: Parameters<typeof upsertFn>[0]["data"]) =>
      upsertFn({ data: payload }),
    onSuccess: () => {
      toast.success(editingId ? "Setting updated" : "Setting saved");
      qc.invalidateQueries({ queryKey: ["billing_rate_settings"] });
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Setting deleted");
      qc.invalidateQueries({ queryKey: ["billing_rate_settings"] });
      if (editingId) resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // If the row being edited is deleted elsewhere, clear the form
  useEffect(() => {
    if (editingId && rows.data && !rows.data.find((r) => r.id === editingId)) {
      resetForm();
    }
  }, [rows.data, editingId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.procedure_code.trim()) nextErrors.procedure_code = "Required";
    const amount = Number(form.charge_amount);
    if (!form.charge_amount.trim() || Number.isNaN(amount) || amount < 0) {
      nextErrors.charge_amount = "Required";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    upsert.mutate({
      vehicle_type: form.vehicle_type,
      procedure_code: form.procedure_code,
      charge_amount: amount,
      unit_type: form.unit_type,
      place_of_service: form.place_of_service || null,
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft space-y-4">
      <div>
        <h3 className="text-base font-semibold">Billing Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure billing codes and charges per vehicle type.
        </p>
      </div>

      {/* Existing settings table */}
      {rows.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !rows.data?.length ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          No billing settings yet. Add one below.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Vehicle</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Charge</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">POS</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.data.map((r) => (
                <tr key={r.id} className={editingId === r.id ? "bg-accent/40" : ""}>
                  <td className="px-3 py-2 font-medium">{VEHICLE_LABELS[r.vehicle_type]}</td>
                  <td className="px-3 py-2">{r.procedure_code}</td>
                  <td className="px-3 py-2">${Number(r.charge_amount).toFixed(2)}</td>
                  <td className="px-3 py-2">{UNIT_LABELS[r.unit_type]}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.place_of_service ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => loadInto(r)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={del.isPending}
                        onClick={() => {
                          if (confirm(`Delete billing setting for ${VEHICLE_LABELS[r.vehicle_type]}?`)) {
                            del.mutate(r.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            {editingId ? "Edit setting" : "Add setting"}
          </h4>
          {editingId && (
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Vehicle Type</Label>
            <Select
              value={form.vehicle_type}
              onValueChange={(v) => setForm({ ...form, vehicle_type: v as VehicleType })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ambulatory">Ambulatory</SelectItem>
                <SelectItem value="wheelchair_van">Wheelchair Van</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Unit Type</Label>
            <Select
              value={form.unit_type}
              onValueChange={(v) => setForm({ ...form, unit_type: v as UnitType })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trip">Trip</SelectItem>
                <SelectItem value="mile">Mile</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>
              Procedure Code <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.procedure_code}
              placeholder="A0100"
              onChange={(e) => setForm({ ...form, procedure_code: e.target.value })}
              aria-invalid={!!errors.procedure_code}
            />
            {errors.procedure_code && (
              <p className="text-xs text-destructive">{errors.procedure_code}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>
              Charge Amount <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="25.00"
              value={form.charge_amount}
              onChange={(e) => setForm({ ...form, charge_amount: e.target.value })}
              aria-invalid={!!errors.charge_amount}
            />
            {errors.charge_amount && (
              <p className="text-xs text-destructive">{errors.charge_amount}</p>
            )}
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Place of Service</Label>
            <Input
              value={form.place_of_service}
              placeholder="99"
              onChange={(e) => setForm({ ...form, place_of_service: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {editingId ? "Update" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
