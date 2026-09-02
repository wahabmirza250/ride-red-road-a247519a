import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Trash2,
  UserRound,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { readPaperBillDataUrl } from "@/lib/paperBillUpload";
import { classifyOcrFailure, batchStopBanner, MANUAL_ENTRY_HINT } from "@/lib/ocrFailure";
import { sha256Hex, type PaperInboxRow } from "@/lib/paperInbox";
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
import {
  listPaperInbox,
  registerPaperInboxFile,
  savePaperInboxState,
  discardPaperInboxFile,
  adoptOrphanPaperInboxFiles,
} from "@/lib/paperInbox.functions";

type Rider = { id: string; full_name: string; medicaid_id: string };

type Item = {
  key: string;
  /** Durable `paper_inbox_files` row id — the real identity of this upload. */
  inboxId: string | null;
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
  /** Defaults to ambulatory; OCR overrides when the paper marks another type. */
  vehicle_type: "ambulatory" | "wheelchair_van" | null;
  l1p: string;
  l1d: string;
  l2p: string;
  l2d: string;
  /** Times exactly as written on the paper form ("" = none readable). */
  l1pt: string;
  l1dt: string;
  l2pt: string;
  l2dt: string;
  result?: { trip_id: string; total?: number; trip_kind?: string; miles?: number };
};

const UNASSIGNED = "Driver not read";

const DRAFT_FIELDS = [
  "driver_name",
  "passenger_name",
  "medicaid_id",
  "trip_date",
  "vehicle_type",
  "l1p",
  "l1d",
  "l2p",
  "l2d",
  "l1pt",
  "l1dt",
  "l2pt",
  "l2dt",
] as const;

function draftOf(i: Item): Record<string, unknown> {
  const out: Record<string, unknown> = { rider_id: i.rider?.id ?? null };
  for (const f of DRAFT_FIELDS) out[f] = i[f];
  return out;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Rebuild an editable row from its durable inbox record. */
function itemFromRow(row: PaperInboxRow): Item {
  const d = (row.draft ?? {}) as Record<string, any>;
  const str = (k: string) => (typeof d[k] === "string" ? d[k] : "");
  return {
    key: row.id,
    inboxId: row.id,
    fileName: row.file_name,
    previewUrl: null,
    isPdf: row.mime === "application/pdf",
    mime: row.mime,
    uploadPath: row.storage_path,
    phase:
      row.status === "done"
        ? "done"
        : row.status === "reading"
          ? "reading"
          : row.status === "error"
            ? "ready"
            : "ready",
    error: row.error ?? undefined,
    rider: (d["rider"] as Rider) ?? null,
    driver_name: str("driver_name"),
    passenger_name: str("passenger_name"),
    medicaid_id: str("medicaid_id"),
    trip_date: str("trip_date") || todayIso(),
    vehicle_type: (d["vehicle_type"] as Item["vehicle_type"]) ?? "ambulatory",
    l1p: str("l1p"),
    l1d: str("l1d"),
    l2p: str("l2p"),
    l2d: str("l2d"),
    l1pt: str("l1pt"),
    l1dt: str("l1dt"),
    l2pt: str("l2pt"),
    l2dt: str("l2dt"),
    ...(row.trip_id ? { result: { trip_id: row.trip_id } } : {}),
  };
}

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
  if (!i.vehicle_type) return false;
  if (!i.rider && !(i.passenger_name.trim() && i.medicaid_id.trim())) return false;
  return true;
}

/**
 * Batch mode: upload many paper trip reports at once, let the same OCR pass
 * read each one, then review every calculated bill grouped by driver before
 * confirming the whole batch.
 *
 * Every upload is backed by a durable `paper_inbox_files` row, so a refresh,
 * timeout, closed browser or server restart can never lose a stored file: it
 * comes back with its read, its draft and its last error until it has really
 * produced a trip + billing record. Nothing here submits anything.
 */
/** Live counts of the import queue, for a workspace that embeds this inbox. */
export type PaperImportProgress = {
  total: number;
  uploading: number;
  extracting: number;
  draftReady: number;
  needsReview: number;
  saving: number;
  imported: number;
  failed: number;
};

export type BatchPaperBillsProps = {
  /** Explicit tenant selected in Super EDI. Server-side authorization still applies. */
  companyId?: string | null;
  /** Hides the standalone page header when rendered inside another workspace. */
  embedded?: boolean;
  /** Fires after a confirm pass with the trips that were actually created. */
  onImported?: (trips: { trip_id: string }[]) => void;
  /** Fires whenever the queue changes, so a host can render batch progress. */
  onProgress?: (progress: PaperImportProgress) => void;
  /** Keeps imported bills inside the currently selected Super EDI company. */
  onOpenReview?: () => void;
};

export function BatchPaperBills({
  companyId,
  embedded,
  onImported,
  onProgress,
  onOpenReview,
}: BatchPaperBillsProps = {}) {
  const ratesFn = useServerFn(getBillingRatesForCalc);
  const detectFn = useServerFn(detectPaperBillOdometers);
  const createFn = useServerFn(createPaperBillTrip);
  const listFn = useServerFn(listPaperInbox);
  const registerFn = useServerFn(registerPaperInboxFile);
  const saveFn = useServerFn(savePaperInboxState);
  const discardFn = useServerFn(discardPaperInboxFile);
  const adoptFn = useServerFn(adoptOrphanPaperInboxFiles);

  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  /** Set when auto-read hit a terminal condition (no AI credits / disabled). */
  const [ocrHalt, setOcrHalt] = useState<string | null>(null);
  const haltRef = useRef(false);
  const hydratedCompany = useRef<string | null | undefined>(undefined);

  const rates = useQuery({
    queryKey: ["paper_bill_rates", companyId],
    queryFn: () => ratesFn({ data: { company_id: companyId } }) as Promise<RateRow[]>,
    staleTime: 5 * 60 * 1000,
  });

  const inbox = useQuery({
    queryKey: ["paper_inbox", companyId],
    queryFn: () => listFn({ data: { company_id: companyId } }) as Promise<PaperInboxRow[]>,
    staleTime: 15 * 1000,
  });

  // Hydrate once from the durable inbox — nothing typed locally is lost.
  useEffect(() => {
    if (hydratedCompany.current === companyId || !inbox.data) return;
    hydratedCompany.current = companyId;
    setItems(inbox.data.map(itemFromRow));
  }, [inbox.data]);

  function patch(key: string, next: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)));
  }

  /** Persist the biller's edits so nothing typed is lost on refresh. */
  async function persistDraft(item: Item, extra?: Partial<Parameters<typeof saveFn>[0]>) {
    if (!item.inboxId) return;
    try {
      await saveFn({
        data: {
          id: item.inboxId,
          company_id: companyId,
          draft: { ...draftOf(item), rider: item.rider },
          ...(extra?.data ?? {}),
        },
      } as any);
    } catch {
      /* draft saving is best-effort; the file itself is already durable */
    }
  }

  // Debounced draft autosave for every editable row.
  useEffect(() => {
    const t = setTimeout(() => {
      for (const i of items) {
        if (i.inboxId && i.phase === "ready") void persistDraft(i);
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function addFiles(files: File[]) {
    const created = files.map<Item>((file) => {
      const isPdf = file.type === "application/pdf";
      return {
        key: crypto.randomUUID(),
        inboxId: null,
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
        trip_date: todayIso(),
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

      // Durable record FIRST — from this point the upload can never be lost.
      let inboxId: string | null = null;
      try {
        const hash = await sha256Hex(await file.arrayBuffer());
        const res = (await registerFn({
          data: { company_id: companyId, storage_path: path, file_name: file.name, mime: item.mime, content_hash: hash },
        })) as { row: PaperInboxRow; duplicate: boolean };
        inboxId = res.row.id;
        if (res.duplicate) {
          patch(item.key, {
            phase: "done",
            inboxId,
            uploadPath: path,
            result: { trip_id: res.row.trip_id! },
            error: undefined,
          });
          toast.info(`${file.name} was already imported — no duplicate bill was created.`);
          continue;
        }
      } catch (e: any) {
        patch(item.key, {
          phase: "error",
          uploadPath: path,
          error: e?.message ?? "Could not record this upload — retry.",
        });
        continue;
      }

      if (haltRef.current) {
        // Auto-read is terminally unavailable: store the file, mark it for
        // manual entry, and never burn another gateway request on it.
        patch(item.key, { inboxId, uploadPath: path, phase: "ready", error: MANUAL_ENTRY_HINT });
        if (inboxId)
          await saveFn({
            data: { company_id: companyId, id: inboxId, status: "needs_review", error: MANUAL_ENTRY_HINT },
          }).catch(() => {});
        continue;
      }
      patch(item.key, { inboxId, uploadPath: path, phase: "reading" });
      await readOne(item.key, inboxId, file);
    }
    void inbox.refetch();
  }

  /** Auto-read a file, persisting both the result and any failure durably. */
  async function readOne(key: string, inboxId: string | null, file: Blob, name?: string) {
    patch(key, { error: undefined, phase: "reading" });
    const fileName = name ?? (file as File).name ?? "trip-report";
    if (inboxId) {
      try {
        await saveFn({ data: { company_id: companyId, id: inboxId, status: "reading", error: null, bump_attempt: true } });
      } catch {
        /* keep reading even if the marker write fails */
      }
    }
    try {
      const dataUrl = await readPaperBillDataUrl(file as File);
      const res = (await detectFn({
        data: { image_data_url: dataUrl, file_name: fileName },
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
      const next: Partial<Item> = {
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
      };
      patch(key, next);
      if (inboxId) {
        setItems((prev) => {
          const row = prev.find((i) => i.key === key);
          if (row)
            void saveFn({
              data: {
                id: inboxId,
                company_id: companyId,
                status: "needs_review",
                error: null,
                ocr: res as any,
                draft: { ...draftOf(row), rider: row.rider },
              },
            }).catch(() => {});
          return prev;
        });
      }
    } catch (e) {
      const failure = classifyOcrFailure(e);
      // Never leave a row silently blank — say what went wrong, keep it in the
      // inbox, and let the biller retry the read or fill the fields by hand.
      patch(key, { phase: "ready", error: failure.message });
      if (inboxId) {
        await saveFn({
          data: {
            // A terminal auto-read outage is not a file problem: the row is
            // simply waiting for manual entry, so it stays reviewable.
            id: inboxId,
            company_id: companyId,
            status: failure.stopBatch ? "needs_review" : "error",
            error: failure.message,
          },
        }).catch(() => {});
      }
      if (failure.stopBatch) {
        haltRef.current = true;
        setOcrHalt(batchStopBanner(failure));
        toast.error(failure.message);
      } else {
        toast.error(`${fileName}: ${failure.message}`);
      }
    }
  }

  /** Retry the auto-read for a stored file we no longer hold in memory. */
  async function retryRead(item: Item) {
    if (!item.uploadPath) return;
    // An explicit retry is the biller saying "try auto-read again".
    haltRef.current = false;
    setOcrHalt(null);
    patch(item.key, { phase: "reading", error: undefined });
    const { data, error } = await supabase.storage.from("state-pdfs").download(item.uploadPath);
    if (error || !data) {
      const message = error?.message ?? "The stored file could not be read";
      patch(item.key, { phase: "ready", error: message });
      if (item.inboxId)
        await saveFn({ data: { company_id: companyId, id: item.inboxId, status: "error", error: message } }).catch(
          () => {},
        );
      return;
    }
    const file = new File([data], item.fileName, { type: item.mime });
    await readOne(item.key, item.inboxId, file, item.fileName);
  }

  async function remove(item: Item) {
    if (item.phase === "done") return;
    setItems((prev) => prev.filter((i) => i.key !== item.key));
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    try {
      if (item.inboxId) await discardFn({ data: { company_id: companyId, id: item.inboxId } });
      else if (item.uploadPath)
        await supabase.storage.from("state-pdfs").remove([item.uploadPath]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove that upload");
      void inbox.refetch();
    }
  }

  /** Adopt stored paper-inbox files that never got a durable record. */
  async function recoverOrphans() {
    setRecovering(true);
    try {
      const res = (await adoptFn({ data: { company_id: companyId } })) as {
        adopted: number;
        skipped: number;
        failures: { path: string; error: string }[];
      };
      const rows = (await listFn({ data: { company_id: companyId } })) as PaperInboxRow[];
      hydratedCompany.current = companyId;
      setItems(rows.map(itemFromRow));
      toast.success(
        `${res.adopted} stored file${res.adopted === 1 ? "" : "s"} recovered into the inbox` +
          (res.skipped ? ` · ${res.skipped} already tracked` : ""),
      );
      for (const f of res.failures) toast.error(`${f.path}: ${f.error}`);
      // Read anything freshly recovered that has no draft yet.
      for (const row of rows) {
        if (row.status === "uploaded" && !row.ocr) {
          const item = itemFromRow(row);
          await retryRead(item);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not scan storage for lost uploads");
    } finally {
      setRecovering(false);
    }
  }

  const pending = items.filter((i) => i.phase !== "done");
  const readyCount = pending.filter((i) => i.phase === "ready" && isValid(i)).length;
  const blockedCount = pending.filter((i) => i.phase === "ready" && !isValid(i)).length;

  // Queue-level progress for an embedding workspace (Super EDI shows this as a
  // strip above the inbox). Derived from the same phases the rows render.
  useEffect(() => {
    if (!onProgress) return;
    onProgress({
      total: items.length,
      uploading: items.filter((i) => i.phase === "uploading").length,
      extracting: items.filter((i) => i.phase === "reading").length,
      draftReady: items.filter((i) => i.phase === "ready" && isValid(i)).length,
      needsReview: items.filter((i) => i.phase === "ready" && !isValid(i)).length,
      saving: items.filter((i) => i.phase === "saving").length,
      imported: items.filter((i) => i.phase === "done").length,
      failed: items.filter((i) => i.phase === "error").length,
    });
  }, [items, onProgress]);

  async function confirmAll() {
    setConfirming(true);
    let ok = 0;
    let failed = 0;
    const created: { trip_id: string }[] = [];
    for (const item of items) {
      if (item.phase !== "ready" || !isValid(item) || !item.uploadPath) continue;
      patch(item.key, { phase: "saving" });
      await persistDraft(item);
      try {
        const res = (await createFn({
          data: {
            company_id: companyId,
            rider_id: item.rider?.id ?? null,
            new_rider: item.rider
              ? null
              : {
                  full_name: item.passenger_name.trim(),
                  medicaid_id: item.medicaid_id.trim(),
                },
            driver_name: item.driver_name.trim() || null,
            trip_date: item.trip_date,
            vehicle_type: item.vehicle_type!,
            // Paper bills always carry a signed paper report → always Yes.
            identity_verified: true,
            legs: legsOf(item),
            upload_path: item.uploadPath,
            upload_mime: item.mime,
            inbox_file_id: item.inboxId,
          },
        })) as Item["result"];
        patch(item.key, { phase: "done", result: res, error: undefined });
        if (res?.trip_id) created.push({ trip_id: res.trip_id });
        ok++;
      } catch (e: any) {
        const message = e?.message ?? "Could not create the trip";
        patch(item.key, { phase: "ready", error: message });
        if (item.inboxId)
          await saveFn({ data: { company_id: companyId, id: item.inboxId, status: "error", error: message } }).catch(
            () => {},
          );
        failed++;
      }
    }
    setConfirming(false);
    void inbox.refetch();
    if (ok) toast.success(`${ok} bill${ok === 1 ? "" : "s"} imported into Ready to submit`);
    if (failed)
      toast.error(`${failed} bill${failed === 1 ? "" : "s"} could not be created — see each row`);
    if (created.length) onImported?.(created);
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
      {!embedded && (
        <PageHeader
          title="Batch paper bills"
          description="Upload several paper trip reports at once. Each file is stored, tracked and auto-read, grouped by the driver named on the paper, and calculated so you can review the whole batch before confirming. Nothing here is submitted to the portal."
        />
      )}

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
        <Button
          variant="outline"
          className="rounded-full"
          disabled={recovering}
          onClick={() => void recoverOrphans()}
        >
          {recovering ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Inbox className="mr-2 h-4 w-4" />
          )}
          Recover stored uploads
        </Button>
        <span className="text-xs text-muted-foreground">
          {rates.isLoading
            ? "Loading rates…"
            : rateRows.length === 0
              ? "No billing rates configured — ask an admin to set them."
              : `${items.length} in the inbox · ${readyCount} ready · ${blockedCount} need details`}
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

      {ocrHalt && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{ocrHalt}</span>
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {inbox.isLoading
            ? "Loading the paper inbox…"
            : "Select multiple photos or PDFs of paper trip reports to start a batch, or recover files already stored."}
        </div>
      )}

      <div className="space-y-6">
        {groups.map(([driver, list]) => {
          const groupTotal = list.reduce(
            (s, i) =>
              s +
              calcClaim({ legs: legsOf(i), rates: rateRows, vehicleType: i.vehicle_type ?? "" }).total,
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
                    onRetryRead={() => void retryRead(item)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {items.some((i) => i.phase === "done") && (
        onOpenReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Open Batch Review → Ready to submit
          </button>
        ) : (
          <AppLink
            to="/billing"
            className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Open Workflow → Ready to submit
          </AppLink>
        )
      )}
    </div>
  );
}

function BatchRow({
  item,
  rates,
  onPatch,
  onRemove,
  onRetryRead,
}: {
  item: Item;
  rates: RateRow[];
  onPatch: (n: Partial<Item>) => void;
  onRemove: () => void;
  onRetryRead: () => void;
}) {
  const calc = useMemo(
    () => calcClaim({ legs: legsOf(item), rates, vehicleType: item.vehicle_type ?? "" }),
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
          <div className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-border text-muted-foreground">
            <FileText className="h-6 w-6" />
            <span className="px-1 text-center text-[10px] leading-tight">{item.fileName}</span>
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
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{item.error}</span>
            {item.phase !== "done" && item.uploadPath && (
              <button
                type="button"
                onClick={onRetryRead}
                className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
              >
                <RefreshCw className="h-3 w-3" /> Retry read
              </button>
            )}
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
              value={item.vehicle_type ?? ""}
              onChange={(e) =>
                onPatch({ vehicle_type: (e.target.value || null) as Item["vehicle_type"] })
              }
            >
              <option value="">Select vehicle type…</option>
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
            Missing {calc.missing_rates.join(" + ")} rate for{" "}
            {item.vehicle_type ?? "the selected vehicle type"}.
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-border pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(calc.total)}</span>
        </div>

        {item.phase === "done" ? (
          <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> Imported — trip and bill created
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
