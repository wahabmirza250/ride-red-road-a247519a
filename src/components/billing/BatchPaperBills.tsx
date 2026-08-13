import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  UserRound,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { AppLink } from "@/lib/appLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/nemt/PageHeader";
import { formatMoney } from "@/lib/claimReview";
import { calcClaim, type RateRow } from "@/lib/claimCalc";
import {
  createPaperBillTrip,
  getBillingRatesForCalc,
  detectPaperBillOdometers,
} from "@/lib/paperBill.functions";

type Rider = { id: string; full_name: string; medicaid_id: string };

type Item = {
  key: string;
  fileName: string;
  previewUrl: string | null;
  isPdf: boolean;
  mime: string;
  uploadPath: string | null;
  phase: "uploading" | "reading" | "ready" | "saving" | "done" | "error";
  error?: string;
  rider: Rider | null;
  driver_name: string;
  passenger_name: string;
  medicaid_id: string;
  trip_date: string;
  vehicle_type: "ambulatory" | "wheelchair_van";
  l1p: string;
  l1d: string;
  l2p: string;
  l2d: string;
  /** Times exactly as written on the paper form ("" = none readable). */
  l1pt: string;
  l1dt: string;
  l2pt: string;
  l2dt: string;
  result?: { trip_id: string; total: number; trip_kind: string; miles: number };
};

const UNASSIGNED = "Driver not read";

function legsOf(i: Item) {
  const legs: {
    pickup_odometer: number;
    dropoff_odometer: number;
    pickup_time: string | null;
    dropoff_time: string | null;
  }[] = [];
  const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const t = (v: string) => (/^\d{2}:\d{2}$/.test(v.trim()) ? v.trim() : null);
  if (Number.isFinite(n(i.l1p)) && Number.isFinite(n(i.l1d)))
    legs.push({
      pickup_odometer: n(i.l1p),
      dropoff_odometer: n(i.l1d),
      pickup_time: t(i.l1pt),
      dropoff_time: t(i.l1dt),
    });
  if (Number.isFinite(n(i.l2p)) && Number.isFinite(n(i.l2d)))
    legs.push({
      pickup_odometer: n(i.l2p),
      dropoff_odometer: n(i.l2d),
      pickup_time: t(i.l2pt),
      dropoff_time: t(i.l2dt),
    });
  return legs;
}

function isValid(i: Item) {
  const legs = legsOf(i);
  if (!legs.length) return false;
  if (legs.some((l) => l.dropoff_odometer <= l.pickup_odometer)) return false;
  if (!i.trip_date) return false;
  if (!i.rider && !(i.passenger_name.trim() && i.medicaid_id.trim())) return false;
  return true;
}

/**
 * Batch mode: upload many paper trip reports at once, let the same OCR pass
 * read each one, then review every calculated bill grouped by driver before
 * confirming the whole batch. The single-bill chat flow stays untouched.
 */
export function BatchPaperBills() {
  const ratesFn = useServerFn(getBillingRatesForCalc);
  const detectFn = useServerFn(detectPaperBillOdometers);
  const createFn = useServerFn(createPaperBillTrip);
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [confirming, setConfirming] = useState(false);

  const rates = useQuery({
    queryKey: ["paper_bill_rates"],
    queryFn: () => ratesFn() as Promise<RateRow[]>,
    staleTime: 5 * 60 * 1000,
  });

  function patch(key: string, next: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)));
  }

  async function addFiles(files: File[]) {
    const created = files.map<Item>((file) => {
      const isPdf = file.type === "application/pdf";
      return {
        key: crypto.randomUUID(),
        fileName: file.name,
        previewUrl: isPdf ? null : URL.createObjectURL(file),
        isPdf,
        mime: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
        uploadPath: null,
        phase: "uploading",
        rider: null,
        driver_name: "",
        passenger_name: "",
        medicaid_id: "",
        trip_date: new Date().toISOString().slice(0, 10),
        vehicle_type: "ambulatory",
        l1p: "",
        l1d: "",
        l2p: "",
        l2d: "",
        l1pt: "",
        l1dt: "",
        l2pt: "",
        l2dt: "",
      };
    });
    setItems((prev) => [...prev, ...created]);

    const { data: session } = await supabase.auth.getUser();
    const uid = session.user?.id ?? "paper";

    // Sequential so a large batch doesn't hammer the OCR gateway at once.
    for (let idx = 0; idx < created.length; idx++) {
      const item = created[idx];
      const file = files[idx];
      const ext = item.isPdf ? "pdf" : file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${uid}/paper-inbox/${item.key}.${ext}`;
      const { error } = await supabase.storage
        .from("state-pdfs")
        .upload(path, file, { upsert: true, contentType: item.mime });
      if (error) {
        patch(item.key, { phase: "error", error: error.message });
        continue;
      }
      patch(item.key, { uploadPath: path, phase: "reading" });
      await readOne(item.key, file);
    }
  }

  async function readOne(key: string, file: File) {
    if (file.size > 9 * 1024 * 1024) {
      patch(key, { phase: "ready" });
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const res = (await detectFn({
        data: { image_data_url: dataUrl, file_name: file.name },
      })) as {
        name: string | null;
        driver_name: string | null;
        medicaid_id: string | null;
        rider: Rider | null;
        trip_date: string | null;
        vehicle_type: "ambulatory" | "wheelchair_van" | null;
        l1p: string | null;
        l1d: string | null;
        l2p: string | null;
        l2d: string | null;
        l1pt?: string | null;
        l1dt?: string | null;
        l2pt?: string | null;
        l2dt?: string | null;
      };
      patch(key, {
        phase: "ready",
        rider: res?.rider ?? null,
        driver_name: res?.driver_name ?? "",
        passenger_name: res?.rider?.full_name ?? res?.name ?? "",
        medicaid_id: res?.rider?.medicaid_id ?? res?.medicaid_id ?? "",
        ...(res?.trip_date ? { trip_date: res.trip_date } : {}),
        ...(res?.vehicle_type ? { vehicle_type: res.vehicle_type } : {}),
        l1p: res?.l1p ?? "",
        l1d: res?.l1d ?? "",
        l2p: res?.l2p ?? "",
        l2d: res?.l2d ?? "",
        // Never invent a time — blank stays blank for manual entry.
        l1pt: res?.l1pt ?? "",
        l1dt: res?.l1dt ?? "",
        l2pt: res?.l2pt ?? "",
        l2dt: res?.l2dt ?? "",
      });
    } catch (e: any) {
      patch(key, { phase: "ready", error: e?.message ?? "Auto-read failed" });
    }
  }

  async function remove(item: Item) {
    setItems((prev) => prev.filter((i) => i.key !== item.key));
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.uploadPath) await supabase.storage.from("state-pdfs").remove([item.uploadPath]);
  }

  const pending = items.filter((i) => i.phase !== "done");
  const readyCount = pending.filter((i) => i.phase === "ready" && isValid(i)).length;

  async function confirmAll() {
    setConfirming(true);
    let ok = 0;
    let failed = 0;
    for (const item of items) {
      if (item.phase !== "ready" || !isValid(item) || !item.uploadPath) continue;
      patch(item.key, { phase: "saving" });
      try {
        const res = (await createFn({
          data: {
            rider_id: item.rider?.id ?? null,
            new_rider: item.rider
              ? null
              : {
                  full_name: item.passenger_name.trim(),
                  medicaid_id: item.medicaid_id.trim(),
                },
            driver_name: item.driver_name.trim() || null,
            trip_date: item.trip_date,
            vehicle_type: item.vehicle_type,
            // Paper bills always carry a signed paper report → always Yes.
            identity_verified: true,
            legs: legsOf(item),
            upload_path: item.uploadPath,
            upload_mime: item.mime,
          },
        })) as Item["result"];
        patch(item.key, { phase: "done", result: res });
        ok++;
      } catch (e: any) {
        patch(item.key, { phase: "ready", error: e?.message ?? "Could not create the trip" });
        failed++;
      }
    }
    setConfirming(false);
    if (ok) toast.success(`${ok} bill${ok === 1 ? "" : "s"} confirmed and queued to submit`);
    if (failed) toast.error(`${failed} bill${failed === 1 ? "" : "s"} could not be created`);
  }

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of items) {
      const name = i.driver_name.trim() || UNASSIGNED;
      const existing = map.get(name);
      if (existing) existing.push(i);
      else map.set(name, [i]);
    }
    return [...map.entries()].sort((a, b) =>
      a[0] === UNASSIGNED ? 1 : b[0] === UNASSIGNED ? -1 : a[0].localeCompare(b[0]),
    );
  }, [items]);

  const rateRows = rates.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Batch paper bills"
        description="Upload several paper trip reports at once. Each is auto-read, grouped by the driver named on the paper, and calculated so you can review the whole batch before confirming."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addFiles(files);
            e.target.value = "";
          }}
        />
        <Button className="rounded-full" onClick={() => fileRef.current?.click()}>
          <Paperclip className="mr-2 h-4 w-4" /> Upload paper bills
        </Button>
        <span className="text-xs text-muted-foreground">
          {rates.isLoading
            ? "Loading rates…"
            : rateRows.length === 0
              ? "No billing rates configured — ask an admin to set them."
              : `${items.length} uploaded · ${readyCount} ready to confirm`}
        </span>
        <div className="ml-auto">
          <Button
            className="rounded-full"
            disabled={confirming || readyCount === 0}
            onClick={() => void confirmAll()}
          >
            {confirming ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Confirm {readyCount || ""} bill{readyCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Select multiple photos or PDFs of paper trip reports to start a batch.
        </div>
      )}

      <div className="space-y-6">
        {groups.map(([driver, list]) => {
          const groupTotal = list.reduce(
            (s, i) =>
              s +
              calcClaim({ legs: legsOf(i), rates: rateRows, vehicleType: i.vehicle_type }).total,
            0,
          );
          return (
            <section key={driver} className="rounded-2xl border border-border bg-surface">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{driver}</div>
                    <div className="text-xs text-muted-foreground">
                      {list.length} bill{list.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">{formatMoney(groupTotal)}</div>
              </header>
              <div className="divide-y divide-border">
                {list.map((item) => (
                  <BatchRow
                    key={item.key}
                    item={item}
                    rates={rateRows}
                    onPatch={(n) => patch(item.key, n)}
                    onRemove={() => void remove(item)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {items.some((i) => i.phase === "done") && (
        <AppLink
          to="/billing"
          className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Open Workflow → Ready to submit
        </AppLink>
      )}
    </div>
  );
}

function BatchRow({
  item,
  rates,
  onPatch,
  onRemove,
}: {
  item: Item;
  rates: RateRow[];
  onPatch: (n: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const calc = useMemo(
    () => calcClaim({ legs: legsOf(item), rates, vehicleType: item.vehicle_type }),
    [item, rates],
  );
  const valid = isValid(item);

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[120px_1fr_200px]">
      <div className="flex items-start gap-2">
        {item.previewUrl ? (
          <img
            src={item.previewUrl}
            alt={`Paper trip report ${item.fileName}`}
            className="h-24 w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-24 w-full items-center justify-center rounded-lg border border-border text-muted-foreground">
            <FileText className="h-6 w-6" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {item.phase === "uploading" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading {item.fileName}…
          </div>
        )}
        {item.phase === "reading" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Auto-reading {item.fileName}…
          </div>
        )}
        {item.error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {item.error}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Driver name</Label>
            <Input
              aria-label={`Driver name for ${item.fileName}`}
              value={item.driver_name}
              onChange={(e) => onPatch({ driver_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Trip date</Label>
            <Input
              aria-label={`Trip date for ${item.fileName}`}
              type="date"
              value={item.trip_date}
              onChange={(e) => onPatch({ trip_date: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Passenger</Label>
            <Input
              aria-label={`Passenger for ${item.fileName}`}
              value={item.passenger_name}
              onChange={(e) => onPatch({ passenger_name: e.target.value, rider: null })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Medicaid ID
              {item.rider && (
                <span className="ml-1 text-success">existing passenger</span>
              )}
            </Label>
            <Input
              aria-label={`Medicaid ID for ${item.fileName}`}
              value={item.medicaid_id}
              onChange={(e) => onPatch({ medicaid_id: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Vehicle type</Label>
            <select
              aria-label={`Vehicle type for ${item.fileName}`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={item.vehicle_type}
              onChange={(e) => onPatch({ vehicle_type: e.target.value as Item["vehicle_type"] })}
            >
              <option value="ambulatory">Ambulatory</option>
              <option value="wheelchair_van">Wheelchair van</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["l1p", "Leg 1 start"],
              ["l1d", "Leg 1 end"],
              ["l2p", "Leg 2 start"],
              ["l2d", "Leg 2 end"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                aria-label={`${label} for ${item.fileName}`}
                inputMode="decimal"
                value={item[field]}
                onChange={(e) => onPatch({ [field]: e.target.value } as Partial<Item>)}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["l1pt", "Leg 1 pickup time"],
              ["l1dt", "Leg 1 dropoff time"],
              ["l2pt", "Leg 2 pickup time"],
              ["l2dt", "Leg 2 dropoff time"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                aria-label={`${label} for ${item.fileName}`}
                type="time"
                value={item[field]}
                onChange={(e) => onPatch({ [field]: e.target.value } as Partial<Item>)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1 rounded-xl border border-border bg-surface-muted p-3 text-sm">
        <div className="text-xs text-muted-foreground">
          {calc.trip_kind === "round_trip" ? "Round trip (2 units)" : "One way (1 unit)"} ·{" "}
          {calc.miles} miles
        </div>
        {calc.lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {l.label}
              {l.procedure_code ? ` (${l.procedure_code})` : ""}: {l.units} {l.unit_word}
            </span>
            <span className="tabular-nums text-xs font-medium">{formatMoney(l.amount)}</span>
          </div>
        ))}
        {calc.missing_rates.length > 0 && (
          <div className="text-xs text-destructive">
            Missing {calc.missing_rates.join(" + ")} rate for {item.vehicle_type}.
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(calc.total)}</span>
        </div>

        {item.phase === "done" ? (
          <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> Confirmed — ready to submit
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1">
            <span className={valid ? "text-xs text-success" : "text-xs text-muted-foreground"}>
              {item.phase === "saving"
                ? "Saving…"
                : valid
                  ? "Ready"
                  : "Needs passenger, ID and Leg 1 odometers"}
            </span>
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove bill">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
