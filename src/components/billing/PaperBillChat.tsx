import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Paperclip,
  ReceiptText,
  CheckCircle2,
  Pencil,
  FileText,
  Search,
  Plus,
} from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/nemt/PageHeader";
import { formatMoney } from "@/lib/claimReview";
import { calcClaim, type RateRow } from "@/lib/claimCalc";
import {
  createPaperBillTrip,
  getBillingRatesForCalc,
  searchBillingRiders,
  detectPaperBillOdometers,
} from "@/lib/paperBill.functions";

type Rider = { id: string; full_name: string; medicaid_id: string; dob?: string | null };

type OdoField = "l1p" | "l1d" | "l2p" | "l2d";

type Draft = {
  rider: Rider | null;
  newRider: { full_name: string; medicaid_id: string };
  trip_date: string;
  vehicle_type: "ambulatory" | "wheelchair_van";
  l1p: string;
  l1d: string;
  l2p: string;
  l2d: string;
};

type Entry = {
  key: string;
  fileName: string;
  previewUrl: string | null;
  isPdf: boolean;
  uploadPath: string | null;
  mime: string;
  uploading: boolean;
  ocr: "idle" | "running" | "done" | "failed";
  ocrFilled: OdoField[];
  stage: "form" | "review" | "done";
  draft: Draft;
  result?: { trip_id: string; total: number; trip_kind: string; miles: number };
};

const emptyDraft = (): Draft => ({
  rider: null,
  newRider: { full_name: "", medicaid_id: "" },
  trip_date: new Date().toISOString().slice(0, 10),
  vehicle_type: "ambulatory",
  l1p: "",
  l1d: "",
  l2p: "",
  l2d: "",
});

function legsFromDraft(d: Draft) {
  const legs: { pickup_odometer: number; dropoff_odometer: number }[] = [];
  const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const a = n(d.l1p);
  const b = n(d.l1d);
  if (Number.isFinite(a) && Number.isFinite(b)) legs.push({ pickup_odometer: a, dropoff_odometer: b });
  const c = n(d.l2p);
  const e = n(d.l2d);
  if (Number.isFinite(c) && Number.isFinite(e)) legs.push({ pickup_odometer: c, dropoff_odometer: e });
  return legs;
}

/**
 * Chat-style paper trip report entry. Uploaded photos get a cheap OCR pass
 * that pre-fills odometer fields (clearly marked for verification); the
 * biller keys the odometer numbers and the app does the same math the
 * automation uses at the portal.
 */
export function PaperBillChat() {
  const ratesFn = useServerFn(getBillingRatesForCalc);
  const createFn = useServerFn(createPaperBillTrip);
  const detectFn = useServerFn(detectPaperBillOdometers);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const rates = useQuery({
    queryKey: ["paper_bill_rates"],
    queryFn: () => ratesFn() as Promise<RateRow[]>,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, entries[entries.length - 1]?.stage]);

  function patch(key: string, next: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...next } : e)));
  }
  function patchDraft(key: string, next: Partial<Draft>) {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, draft: { ...e.draft, ...next } } : e)),
    );
  }

  async function onPickFile(file: File) {
    const key = crypto.randomUUID();
    const isPdf = file.type === "application/pdf";
    const entry: Entry = {
      key,
      fileName: file.name,
      previewUrl: isPdf ? null : URL.createObjectURL(file),
      isPdf,
      uploadPath: null,
      mime: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
      uploading: true,
      ocr: "idle",
      ocrFilled: [],
      stage: "form",
      draft: emptyDraft(),
    };
    setEntries((prev) => [...prev, entry]);

    const { data: session } = await supabase.auth.getUser();
    const uid = session.user?.id ?? "paper";
    const ext = isPdf ? "pdf" : file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${uid}/paper-inbox/${key}.${ext}`;
    const { error } = await supabase.storage
      .from("state-pdfs")
      .upload(path, file, { upsert: true, contentType: entry.mime });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      patch(key, { uploading: false });
      return;
    }
    patch(key, { uploading: false, uploadPath: path });
    void runOcr(key, file);
  }

  /**
   * Single cheap vision pass over the uploaded report (image or PDF). It
   * pre-fills passenger, date, vehicle type and the odometers; when enough
   * was read the chat jumps straight to the calculated claim so the biller
   * only has to Confirm or Edit.
   */
  async function runOcr(key: string, file: File) {
    if (file.size > 9 * 1024 * 1024) {
      patch(key, { ocr: "failed" });
      return;
    }
    patch(key, { ocr: "running" });
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
        medicaid_id: string | null;
        rider: Rider | null;
        trip_date: string | null;
        vehicle_type: "ambulatory" | "wheelchair_van" | null;
      } & Record<OdoField, string | null>;

      const filled: OdoField[] = [];
      const nextDraft: Partial<Draft> = {};
      (["l1p", "l1d", "l2p", "l2d"] as OdoField[]).forEach((f) => {
        if (res?.[f]) {
          nextDraft[f] = res[f] as string;
          filled.push(f);
        }
      });
      if (res?.trip_date) nextDraft.trip_date = res.trip_date;
      if (res?.vehicle_type) nextDraft.vehicle_type = res.vehicle_type;
      if (res?.rider) {
        // Known member — bill against the existing passenger record.
        nextDraft.rider = res.rider;
      } else if (res?.name || res?.medicaid_id) {
        nextDraft.newRider = {
          full_name: res.name ?? "",
          medicaid_id: res.medicaid_id ?? "",
        };
      }

      const readyToReview =
        !!nextDraft.l1p &&
        !!nextDraft.l1d &&
        (!!nextDraft.rider ||
          !!(nextDraft.newRider?.full_name && nextDraft.newRider?.medicaid_id));


      setEntries((prev) =>
        prev.map((e) =>
          e.key === key
            ? {
                ...e,
                ocr: "done",
                ocrFilled: filled,
                stage: readyToReview ? "review" : "form",
                draft: { ...e.draft, ...nextDraft },
              }
            : e,
        ),
      );
      if (filled.length === 0) {
        toast.message("Couldn't read the document — enter the details manually.");
      }
    } catch {
      patch(key, { ocr: "failed", ocrFilled: [] });
    }
  }


  async function confirm(entry: Entry) {
    const legs = legsFromDraft(entry.draft);
    setSaving(entry.key);
    try {
      const res = (await createFn({
        data: {
          rider_id: entry.draft.rider?.id ?? null,
          new_rider: entry.draft.rider
            ? null
            : {
                full_name: entry.draft.newRider.full_name.trim(),
                medicaid_id: entry.draft.newRider.medicaid_id.trim(),
              },
          trip_date: entry.draft.trip_date,
          vehicle_type: entry.draft.vehicle_type,
          legs,
          upload_path: entry.uploadPath!,
          upload_mime: entry.mime,
        },
      })) as any;
      patch(entry.key, { stage: "done", result: res });
      toast.success("Trip created and paper report attached");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the trip");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Paper bills"
        description="Upload a paper trip report, key the odometer readings, confirm the calculated claim. Each confirmed bill flows into the normal review and submission pipeline."
      />

      <div className="flex min-h-[60vh] flex-col rounded-2xl border border-border bg-surface">
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {entries.length === 0 && (
            <div className="mx-auto mt-10 max-w-sm text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ReceiptText className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">Start with a paper trip report</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload the photo or PDF, then enter the odometer readings. Leave Leg 2 blank for a
                one-way trip.
              </p>
            </div>
          )}

          {entries.map((entry) => (
            <ChatEntry
              key={entry.key}
              entry={entry}
              rates={rates.data ?? []}
              saving={saving === entry.key}
              onPatchDraft={(d) => {
                patchDraft(entry.key, d);
                const touched = Object.keys(d) as OdoField[];
                setEntries((prev) =>
                  prev.map((e) =>
                    e.key === entry.key
                      ? { ...e, ocrFilled: e.ocrFilled.filter((f) => !touched.includes(f)) }
                      : e,
                  ),
                );
              }}
              onStage={(stage) => patch(entry.key, { stage })}
              onConfirm={() => confirm(entry)}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} className="rounded-full">
            <Paperclip className="mr-2 h-4 w-4" /> Upload paper bill
          </Button>
          <span className="text-xs text-muted-foreground">
            {rates.isLoading
              ? "Loading rates…"
              : (rates.data ?? []).length === 0
                ? "No billing rates configured — ask an admin to set them."
                : "Rates loaded — totals calculate instantly."}
          </span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- bubbles --------------------------------- */

function Bubble({
  side,
  children,
}: {
  side: "user" | "bot";
  children: React.ReactNode;
}) {
  return (
    <div className={side === "user" ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          side === "user"
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
            : "max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-surface-muted px-3 py-2 text-foreground"
        }
      >
        {children}
      </div>
    </div>
  );
}

function ChatEntry({
  entry,
  rates,
  saving,
  onPatchDraft,
  onStage,
  onConfirm,
}: {
  entry: Entry;
  rates: RateRow[];
  saving: boolean;
  onPatchDraft: (d: Partial<Draft>) => void;
  onStage: (s: Entry["stage"]) => void;
  onConfirm: () => void;
}) {
  const legs = legsFromDraft(entry.draft);
  const calc = useMemo(
    () => calcClaim({ legs, rates, vehicleType: entry.draft.vehicle_type }),
    [entry.draft, rates],
  );
  const riderName = entry.draft.rider?.full_name || entry.draft.newRider.full_name || "—";

  const canReview =
    legs.length >= 1 &&
    !!entry.draft.trip_date &&
    (!!entry.draft.rider ||
      (entry.draft.newRider.full_name.trim() && entry.draft.newRider.medicaid_id.trim()));

  return (
    <div className="space-y-3">
      <Bubble side="user">
        {entry.isPdf || !entry.previewUrl ? (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" /> {entry.fileName}
          </div>
        ) : (
          <img
            src={entry.previewUrl}
            alt={`Paper trip report ${entry.fileName}`}
            className="max-h-56 rounded-lg"
          />
        )}
        <div className="mt-1 text-[11px] opacity-80">
          {entry.uploading ? "Uploading…" : "Uploaded"}
        </div>
      </Bubble>

      {entry.stage === "form" && (
        <Bubble side="bot">
          <div className="w-[min(78vw,520px)] space-y-3">
            <p className="text-sm">
              Got it. Who was the passenger, and what were the odometer readings?
            </p>
            {entry.ocr === "running" && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Auto-reading the odometer
                fields…
              </div>
            )}
            {entry.ocr === "done" && entry.ocrFilled.length > 0 && (
              <div className="rounded-lg border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                Auto-read {entry.ocrFilled.length} of 4 odometer fields — please verify the
                highlighted numbers against the paper before calculating.
              </div>
            )}
            {((entry.ocr === "done" && entry.ocrFilled.length === 0) ||
              entry.ocr === "failed") && (
              <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground">
                Couldn't auto-read the odometers — enter them manually below.
              </div>
            )}
            <EntryForm draft={entry.draft} onPatch={onPatchDraft} ocrFilled={entry.ocrFilled} />
            <Button
              size="sm"
              className="rounded-full"
              disabled={!canReview || entry.uploading || !entry.uploadPath}
              onClick={() => onStage("review")}
            >
              Calculate
            </Button>
          </div>
        </Bubble>
      )}

      {entry.stage === "review" && (
        <Bubble side="bot">
          <div className="w-[min(78vw,520px)] space-y-2">
            {entry.ocrFilled.length > 0 && (
              <div className="rounded-lg border border-amber-400/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                Read from the uploaded document. Check the numbers — Confirm if correct, Edit to
                fix anything.
              </div>
            )}
            <div className="text-sm font-semibold">{riderName}</div>

            <div className="text-xs text-muted-foreground">
              {entry.draft.trip_date} ·{" "}
              {calc.trip_kind === "round_trip" ? "Round trip (2 units)" : "One way (1 unit)"} ·{" "}
              {calc.miles} miles
            </div>
            <div className="mt-2 space-y-1 rounded-xl border border-border bg-surface p-3 text-sm">
              {calc.lines.map((l) => (
                <div key={l.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {l.label}
                    {l.procedure_code ? ` (${l.procedure_code})` : ""}: {l.units} {l.unit_word} ×{" "}
                    {formatMoney(l.rate)}
                  </span>
                  <span className="tabular-nums font-medium">{formatMoney(l.amount)}</span>
                </div>
              ))}
              {calc.missing_rates.length > 0 && (
                <div className="text-xs text-destructive">
                  Missing {calc.missing_rates.join(" + ")} rate for {entry.draft.vehicle_type}.
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(calc.total)}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="rounded-full" disabled={saving} onClick={onConfirm}>
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={saving}
                onClick={() => onStage("form")}
              >
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
            </div>
          </div>
        </Bubble>
      )}

      {entry.stage === "done" && entry.result && (
        <Bubble side="bot">
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> Trip created
            </div>
            <div className="text-xs text-muted-foreground">
              {riderName} · {entry.result.trip_kind === "round_trip" ? "Round trip" : "One way"} ·{" "}
              {entry.result.miles} miles · {formatMoney(entry.result.total)}
            </div>
            <div className="text-xs text-muted-foreground">
              Paper report attached as the proof of service. It's now in{" "}
              <strong>Pending Review</strong>. Upload the next bill whenever you're ready.
            </div>
          </div>
        </Bubble>
      )}
    </div>
  );
}

const AUTO_READ_CLASS =
  "border-amber-400 bg-amber-50 dark:bg-amber-500/10 focus-visible:border-amber-500";

function EntryForm({
  draft,
  onPatch,
  ocrFilled = [],
}: {
  draft: Draft;
  onPatch: (d: Partial<Draft>) => void;
  ocrFilled?: OdoField[];
}) {
  const searchFn = useServerFn(searchBillingRiders);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const riders = useQuery({
    queryKey: ["paper_bill_riders", q],
    queryFn: () => searchFn({ data: { q } }) as Promise<Rider[]>,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      {draft.rider ? (
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
          <div>
            <div className="text-sm font-medium">{draft.rider.full_name}</div>
            <div className="font-mono text-xs text-muted-foreground">{draft.rider.medicaid_id}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onPatch({ rider: null })}>
            Change
          </Button>
        </div>
      ) : adding ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Passenger name</Label>
            <Input
              aria-label="Passenger name"
              value={draft.newRider.full_name}
              onChange={(e) => onPatch({ newRider: { ...draft.newRider, full_name: e.target.value } })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Medicaid ID</Label>
            <Input
              aria-label="Medicaid ID"
              value={draft.newRider.medicaid_id}
              onChange={(e) =>
                onPatch({ newRider: { ...draft.newRider, medicaid_id: e.target.value } })
              }
            />
          </div>
          <button
            type="button"
            className="text-left text-xs text-primary sm:col-span-2"
            onClick={() => setAdding(false)}
          >
            Search existing passengers instead
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search passenger by name or Medicaid ID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {(riders.data ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onPatch({ rider: r })}
                className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span>{r.full_name}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.medicaid_id}</span>
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New passenger
          </Button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Trip date</Label>
          <Input
            aria-label="Trip date"
            type="date"
            value={draft.trip_date}
            onChange={(e) => onPatch({ trip_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vehicle type</Label>
          <select
            aria-label="Vehicle type"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={draft.vehicle_type}
            onChange={(e) => onPatch({ vehicle_type: e.target.value as Draft["vehicle_type"] })}
          >
            <option value="ambulatory">Ambulatory</option>
            <option value="wheelchair_van">Wheelchair van</option>
          </select>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">
            Leg 1 pickup odometer
            {ocrFilled.includes("l1p") && (
              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                auto-read — please verify
              </span>
            )}
          </Label>
          <Input
            aria-label="Leg 1 pickup odometer"
            inputMode="decimal"
            className={ocrFilled.includes("l1p") ? AUTO_READ_CLASS : undefined}
            value={draft.l1p}
            onChange={(e) => onPatch({ l1p: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Leg 1 dropoff odometer
            {ocrFilled.includes("l1d") && (
              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                auto-read — please verify
              </span>
            )}
          </Label>
          <Input
            aria-label="Leg 1 dropoff odometer"
            inputMode="decimal"
            className={ocrFilled.includes("l1d") ? AUTO_READ_CLASS : undefined}
            value={draft.l1d}
            onChange={(e) => onPatch({ l1d: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Leg 2 pickup odometer (optional)
            {ocrFilled.includes("l2p") && (
              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                auto-read — please verify
              </span>
            )}
          </Label>
          <Input
            aria-label="Leg 2 pickup odometer"
            inputMode="decimal"
            className={ocrFilled.includes("l2p") ? AUTO_READ_CLASS : undefined}
            value={draft.l2p}
            onChange={(e) => onPatch({ l2p: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Leg 2 dropoff odometer (optional)
            {ocrFilled.includes("l2d") && (
              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                auto-read — please verify
              </span>
            )}
          </Label>
          <Input
            aria-label="Leg 2 dropoff odometer"
            inputMode="decimal"
            className={ocrFilled.includes("l2d") ? AUTO_READ_CLASS : undefined}
            value={draft.l2d}
            onChange={(e) => onPatch({ l2d: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
