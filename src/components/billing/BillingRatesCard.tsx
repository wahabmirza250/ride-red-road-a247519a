import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Save, X } from "lucide-react";
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
  listBillingRateSettings,
  upsertBillingRatePair,
  type BillingRateSetting,
  type VehicleType,
} from "@/lib/billingRates.functions";

const VEHICLE_LABELS: Record<VehicleType, string> = {
  ambulatory: "Ambulatory",
  wheelchair_van: "Wheelchair Van",
};

const VEHICLE_TYPES: VehicleType[] = ["ambulatory", "wheelchair_van"];

type SectionState = {
  procedure_code: string;
  charge_amount: string;
  place_of_service: string;
};
type SectionErrors = {
  procedure_code?: string;
  charge_amount?: string;
  place_of_service?: string;
};

type FormState = {
  vehicle_type: VehicleType;
  trip: SectionState;
  mile: SectionState;
};

const EMPTY_SECTION: SectionState = {
  procedure_code: "",
  charge_amount: "",
  place_of_service: "",
};

const emptyForm = (vehicle_type: VehicleType): FormState => ({
  vehicle_type,
  trip: { ...EMPTY_SECTION },
  mile: { ...EMPTY_SECTION },
});

type GroupedRates = Record<
  VehicleType,
  { trip?: BillingRateSetting; mile?: BillingRateSetting }
>;

function groupRates(rows: BillingRateSetting[]): GroupedRates {
  const g: GroupedRates = {
    ambulatory: {},
    wheelchair_van: {},
  };
  for (const r of rows) {
    g[r.vehicle_type][r.unit_type] = r;
  }
  return g;
}

export function BillingRatesCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBillingRateSettings);
  const upsertPairFn = useServerFn(upsertBillingRatePair);

  const rows = useQuery({
    queryKey: ["billing_rate_settings"],
    queryFn: () => listFn(),
  });

  const grouped = useMemo<GroupedRates>(
    () => groupRates(rows.data ?? []),
    [rows.data],
  );

  const [form, setForm] = useState<FormState>(() => emptyForm("ambulatory"));
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<{
    trip: SectionErrors;
    mile: SectionErrors;
  }>({ trip: {}, mile: {} });

  const loadVehicle = (vt: VehicleType) => {
    const g = grouped[vt];
    setIsEditing(true);
    setForm({
      vehicle_type: vt,
      trip: {
        procedure_code: g.trip?.procedure_code ?? "",
        charge_amount:
          g.trip?.charge_amount != null ? String(g.trip.charge_amount) : "",
        place_of_service: g.trip?.place_of_service ?? "",
      },
      mile: {
        procedure_code: g.mile?.procedure_code ?? "",
        charge_amount:
          g.mile?.charge_amount != null ? String(g.mile.charge_amount) : "",
        place_of_service: g.mile?.place_of_service ?? "",
      },
    });
    setErrors({ trip: {}, mile: {} });
  };

  const resetForm = () => {
    setIsEditing(false);
    setForm(emptyForm("ambulatory"));
    setErrors({ trip: {}, mile: {} });
  };

  const onVehicleChange = (vt: VehicleType) => {
    const g = grouped[vt];
    if (g.trip || g.mile) {
      loadVehicle(vt);
    } else {
      setForm({ ...emptyForm(vt) });
      setErrors({ trip: {}, mile: {} });
    }
  };

  const upsert = useMutation({
    mutationFn: (payload: Parameters<typeof upsertPairFn>[0]["data"]) =>
      upsertPairFn({ data: payload }),
    onSuccess: () => {
      toast.success("Billing settings saved");
      qc.invalidateQueries({ queryKey: ["billing_rate_settings"] });
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (isEditing && rows.data && rows.data.length === 0) {
      resetForm();
    }
  }, [rows.data, isEditing]);

  const validateSection = (s: SectionState): SectionErrors => {
    const e: SectionErrors = {};
    if (!s.procedure_code.trim()) e.procedure_code = "Required";
    const n = Number(s.charge_amount);
    if (!s.charge_amount.trim() || Number.isNaN(n) || n < 0) {
      e.charge_amount = "Required";
    }
    if (!s.place_of_service.trim()) e.place_of_service = "Required";
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tripErr = validateSection(form.trip);
    const mileErr = validateSection(form.mile);
    setErrors({ trip: tripErr, mile: mileErr });
    if (Object.keys(tripErr).length || Object.keys(mileErr).length) return;

    upsert.mutate({
      vehicle_type: form.vehicle_type,
      trip: {
        procedure_code: form.trip.procedure_code,
        charge_amount: Number(form.trip.charge_amount),
        place_of_service: form.trip.place_of_service,
      },
      mile: {
        procedure_code: form.mile.procedure_code,
        charge_amount: Number(form.mile.charge_amount),
        place_of_service: form.mile.place_of_service,
      },
    });
  };

  const configuredVehicles = VEHICLE_TYPES.filter(
    (vt) => grouped[vt].trip || grouped[vt].mile,
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft space-y-4">
      <div>
        <h3 className="text-base font-semibold">Billing Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure Trip and Mileage rates per vehicle type.
        </p>
      </div>

      {/* Summary */}
      {rows.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : configuredVehicles.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          No billing settings yet. Configure a vehicle type below.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
          {configuredVehicles.map((vt) => {
            const g = grouped[vt];
            const trip = g.trip;
            const mile = g.mile;
            return (
              <div
                key={vt}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">{VEHICLE_LABELS[vt]}</div>
                  <div className="text-xs text-muted-foreground">
                    Trip{" "}
                    {trip ? (
                      <>
                        ${Number(trip.charge_amount).toFixed(2)}{" "}
                        <span className="opacity-70">
                          ({trip.procedure_code}
                          {trip.place_of_service
                            ? `, POS ${trip.place_of_service}`
                            : ""}
                          )
                        </span>
                      </>
                    ) : (
                      <span className="opacity-70">not set</span>
                    )}
                    {"  |  "}
                    Mile{" "}
                    {mile ? (
                      <>
                        ${Number(mile.charge_amount).toFixed(2)}{" "}
                        <span className="opacity-70">
                          ({mile.procedure_code}
                          {mile.place_of_service
                            ? `, POS ${mile.place_of_service}`
                            : ""}
                          )
                        </span>
                      </>
                    ) : (
                      <span className="opacity-70">not set</span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadVehicle(vt)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-border bg-background/50 p-4"
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            {isEditing
              ? `Edit ${VEHICLE_LABELS[form.vehicle_type]} rates`
              : "Add / Edit rates"}
          </h4>
          {isEditing && (
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <Label>Vehicle Type</Label>
          <Select
            value={form.vehicle_type}
            onValueChange={(v) => onVehicleChange(v as VehicleType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ambulatory">Ambulatory</SelectItem>
              <SelectItem value="wheelchair_van">Wheelchair Van</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(["trip", "mile"] as const).map((section) => {
            const label = section === "trip" ? "Trip Rate" : "Mileage Rate";
            const state = form[section];
            const err = errors[section];
            return (
              <div
                key={section}
                className="space-y-3 rounded-lg border border-border bg-surface p-3"
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="space-y-1">
                  <Label>
                    Procedure Code <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={state.procedure_code}
                    placeholder={section === "trip" ? "A0130" : "S0215"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [section]: {
                          ...state,
                          procedure_code: e.target.value,
                        },
                      })
                    }
                    aria-invalid={!!err.procedure_code}
                  />
                  {err.procedure_code && (
                    <p className="text-xs text-destructive">
                      {err.procedure_code}
                    </p>
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
                    placeholder={section === "trip" ? "25.00" : "1.50"}
                    value={state.charge_amount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [section]: {
                          ...state,
                          charge_amount: e.target.value,
                        },
                      })
                    }
                    aria-invalid={!!err.charge_amount}
                  />
                  {err.charge_amount && (
                    <p className="text-xs text-destructive">
                      {err.charge_amount}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>
                    Place of Service <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={state.place_of_service}
                    placeholder={section === "trip" ? "99" : "41"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [section]: {
                          ...state,
                          place_of_service: e.target.value,
                        },
                      })
                    }
                    aria-invalid={!!err.place_of_service}
                  />
                  {err.place_of_service && (
                    <p className="text-xs text-destructive">
                      {err.place_of_service}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
