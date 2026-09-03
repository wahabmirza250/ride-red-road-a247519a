import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAppNavigate, useCompanySlug } from "@/lib/appLink";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { ActiveTripMap } from "@/components/driver/ActiveTripMap";
import { InAppNavigation } from "@/components/driver/InAppNavigation";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  Loader2,
  Navigation,
  WifiOff,
} from "lucide-react";
import { useLocationBroadcast } from "@/lib/useGeolocation";
import { geocodeAddress } from "@/lib/geocode.functions";
import { detectOdometerFromImage } from "@/lib/nemtTrip.functions";
import {
  getDriverTripDraft,
  saveDriverTripDraft,
  closeDriverTripDraft,
} from "@/lib/driverTripDrafts.functions";
import {
  createEmptyDraft,
  draftLabel,
  draftStorageKey,
  legMiles,
  loadDraft,
  nowHM,
  saveDraft,
  clearDraft,
  updateLeg as updateLegIn,
  updateSlot as updateSlotIn,
  type DriverTripDraft,
} from "@/lib/driverTripDraft";
import {
  actionLabel,
  allowedActions,
  applyTransition,
  blockersFor,
  currentDestination,
  getLifecycle,
  phaseLabel,
  withLifecycle,
  type ActiveTripDraft,
  type TripAction,
} from "@/lib/driverTripLifecycle";
import { submitDriverTripToBilling, downloadPdf, type GeneratedPdf } from "@/lib/driverTripSubmit";
import { openNavigation } from "@/lib/mapsDeepLink";

export const Route = createFileRoute("/$companySlug/driver/trip/active")({
  validateSearch: (search) => ({
    draftId: typeof (search as any).draftId === "string" ? ((search as any).draftId as string) : "",
  }),
  component: ActiveTripScreen,
});

type LatLng = { lat: number; lng: number };

function ActiveTripScreen() {
  const { draftId } = Route.useSearch();
  const { user, isDriver } = useAuth();
  const companySlug = useCompanySlug();
  const navigate = useAppNavigate();

  const [draft, setDraft] = useState<ActiveTripDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [destCoords, setDestCoords] = useState<LatLng | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState("");
  const [pdfs, setPdfs] = useState<GeneratedPdf[] | null>(null);
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null);
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});

  const storageKey = useMemo(
    () => draftStorageKey(companySlug, user?.id ?? null),
    [companySlug, user?.id],
  );

  const fetchDraft = useServerFn(getDriverTripDraft);
  const persist = useServerFn(saveDriverTripDraft);
  const closeDraft = useServerFn(closeDriverTripDraft);
  const geocode = useServerFn(geocodeAddress);
  const detectOdo = useServerFn(detectOdometerFromImage);

  /* ------------------------------- online flag ---------------------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setOnline(window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /* --------------------------- load the active trip ----------------------- */
  useEffect(() => {
    if (!draftId || !user?.id) return;
    let cancelled = false;
    fetchDraft({ data: { id: draftId } })
      .then((row: any) => {
        if (cancelled) return;
        if (!row?.payload) {
          setLoadError("That trip is no longer available.");
          return;
        }
        const base = createEmptyDraft();
        const local =
          typeof window !== "undefined" ? loadDraft(window.localStorage, storageKey) : null;
        const server = { ...base, ...(row.payload as DriverTripDraft), version: base.version };
        // Signatures are never stored on the server draft; recover them from the
        // phone's local copy when it belongs to this same trip.
        const merged: ActiveTripDraft =
          local && (local as any).server_draft_id === row.id
            ? {
                ...server,
                rider_slots: server.rider_slots.map((s) => ({
                  ...s,
                  signature_data_url:
                    s.signature_data_url ??
                    local.rider_slots.find((l) => l.rider.id === s.rider.id)?.signature_data_url ??
                    null,
                })),
              }
            : server;
        setDraft(withLifecycle({ ...merged, server_draft_id: row.id }));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the trip"));
    return () => {
      cancelled = true;
    };
  }, [draftId, fetchDraft, storageKey, user?.id]);

  /* -------------------------- local crash protection --------------------- */
  useEffect(() => {
    if (!draft || typeof window === "undefined") return;
    const t = setTimeout(() => saveDraft(window.localStorage, storageKey, draft), 400);
    return () => clearTimeout(t);
  }, [draft, storageKey]);

  /* ------------------------------ live location -------------------------- */
  const onPos = useCallback((p: LatLng) => setPos(p), []);
  useLocationBroadcast(!!draft, onPos, 15_000);

  /* ------------------------- destination coordinates --------------------- */
  const dest = draft ? currentDestination(draft) : null;
  const destAddress = dest?.address ?? "";
  useEffect(() => {
    if (!destAddress) {
      setDestCoords(null);
      return;
    }
    let cancelled = false;
    geocode({ data: { address: destAddress } })
      .then((r: any) => {
        if (cancelled || !r) return;
        setDestCoords({ lat: r.lat, lng: r.lng });
      })
      .catch(() => setDestCoords(null));
    return () => {
      cancelled = true;
    };
  }, [destAddress, geocode]);

  /* ------------------------- server persistence -------------------------- */
  const saveTimer = useRef<number | null>(null);
  const pushToServer = useCallback(
    async (next: ActiveTripDraft, opts: { silent?: boolean } = {}) => {
      if (!next.server_draft_id) return;
      if (!online) {
        if (!opts.silent) toast.error("You're offline — kept on this phone until you reconnect");
        return;
      }
      setSaving(true);
      try {
        await persist({
          data: {
            id: next.server_draft_id,
            label: draftLabel(next),
            rider_id: next.rider_slots[0]?.rider.id ?? null,
            assigned_trip_id: next.assigned_trip_id,
            payload: {
              ...next,
              rider_slots: next.rider_slots.map((s) => ({ ...s, signature_data_url: null })),
            } as any,
          },
        });
      } catch (e) {
        if (!opts.silent) toast.error(e instanceof Error ? e.message : "Could not save the trip");
      } finally {
        setSaving(false);
      }
    },
    [online, persist],
  );

  // Field edits are debounced to the server; transitions push immediately.
  const patch = useCallback(
    (fn: (d: ActiveTripDraft) => ActiveTripDraft) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void pushToServer(next, { silent: true }), 1200);
        return next;
      });
    },
    [pushToServer],
  );

  async function transition(action: TripAction) {
    if (!draft) return;
    let next: ActiveTripDraft;
    try {
      next = applyTransition(draft, action);
    } catch (e) {
      return toast.error(e instanceof Error ? e.message : "Cannot do that yet");
    }
    setDraft(next);
    setNavOpen(false);
    await pushToServer(next);
    if (action === "arrive_pickup" || action === "arrive_dropoff") {
      // Stamp the real clock time the driver arrived, if not set yet.
      const lc = getLifecycle(next);
      const field = action === "arrive_pickup" ? "pickup_time" : "dropoff_time";
      const leg = next.legs[lc.active_leg];
      if (leg && !leg[field]) {
        const stamped = updateLegIn(next, lc.active_leg, { [field]: nowHM() } as any);
        setDraft(stamped as ActiveTripDraft);
        void pushToServer(stamped as ActiveTripDraft, { silent: true });
      }
    }
  }

  function editCompletedLeg(legIndex: number) {
    if (!draft) return;
    patch((current) => {
      const lifecycle = getLifecycle(current);
      return {
        ...current,
        lifecycle: {
          ...lifecycle,
          phase: "at_dropoff",
          active_leg: Math.max(0, Math.min(legIndex, current.legs.length - 1)),
        },
      };
    });
    toast.message("Trip details reopened — correct the missing information, then complete the leg again.");
  }

  async function handleOdometerPhoto(field: "pickup_odometer" | "dropoff_odometer", file: File | null) {
    if (!file || !draft) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an odometer photo");
    if (file.size > 6 * 1024 * 1024) return toast.error("Photo is too large — use a smaller image");
    const legIndex = getLifecycle(draft).active_leg;
    setDetecting((p) => ({ ...p, [field]: true }));
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Could not read photo"));
        reader.readAsDataURL(file);
      });
      const result: any = await detectOdo({ data: { image_data_url: dataUrl } });
      if (!result?.odometer) return toast.error("Could not read the odometer — type it in");
      patch((d) => updateLegIn(d, legIndex, { [field]: result.odometer } as any) as ActiveTripDraft);
      toast.success(`Odometer detected: ${result.odometer}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not detect odometer");
    } finally {
      setDetecting((p) => ({ ...p, [field]: false }));
    }
  }

  async function sendToBilling() {
    if (!draft || !user) return;
    const missing = blockersFor(draft, "finish");
    if (missing.length > 0) return toast.error(`Still needed: ${missing.join(", ")}`);
    if (!online) return toast.error("You're offline — try again on signal");
    setSubmitting(true);
    try {
      const generated = await submitDriverTripToBilling({
        draft,
        userId: user.id,
        driverFallbackName: user.email ?? "",
        onStage: setSubmitStage,
      });
      if (draft.server_draft_id) {
        await closeDraft({ data: { id: draft.server_draft_id, status: "submitted" } }).catch(() => {});
      }
      if (typeof window !== "undefined") clearDraft(window.localStorage, storageKey);
      toast.success("Trip sent to billing");
      setPdfs(generated);
    } catch (e: any) {
      toast.error(e?.message ?? "Submission failed — the trip is still saved");
    } finally {
      setSubmitting(false);
      setSubmitStage("");
    }
  }

  if (!isDriver) {
    return <div className="p-6 text-sm text-muted-foreground">This screen is for drivers.</div>;
  }

  if (!draftId) {
    return (
      <div className="driver-cta-content-pad space-y-3 p-4 text-sm text-muted-foreground">
        No active trip selected.
        <Button className="h-12 w-full" onClick={() => navigate({ to: "/driver/trip/new" })}>
          Create a trip
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="driver-cta-content-pad space-y-3 p-4">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {loadError}
        </div>
        <Button variant="outline" className="h-12 w-full" onClick={() => navigate({ to: "/driver" })}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* ------------------------------ success view ---------------------------- */
  if (pdfs) {
    return (
      <div className="driver-cta-content-pad mx-auto max-w-lg space-y-4 p-4">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          <div className="text-lg font-semibold">Sent to billing</div>
          <p className="text-sm text-muted-foreground">
            Signed state trip log stored. Billing will review and submit it to the state portal.
          </p>
        </div>
        {pdfs.map((p) => (
          <div key={p.url} className="rounded-2xl border bg-surface p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{p.rider_name}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11" onClick={() => setPreview(p)}>
                View PDF
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => downloadPdf(p.url, p.filename).catch(() => toast.error("Download failed"))}
              >
                Download
              </Button>
            </div>
          </div>
        ))}
        <PdfPreviewDialog
          url={preview?.url ?? null}
          filename={preview?.filename ?? "trip.pdf"}
          onClose={() => setPreview(null)}
        />
        <div className="driver-cta-bar -mx-4 border-t bg-background/95 px-4 pt-3 backdrop-blur">
          <Button className="h-14 w-full text-base" onClick={() => navigate({ to: "/driver" })}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const lc = getLifecycle(draft);
  const leg = draft.legs[lc.active_leg];
  const legName = draft.legs.length > 1 ? (lc.active_leg === 0 ? "Outbound" : "Return") : "Trip";
  const actions = allowedActions(draft);
  const primary = actions[0] ?? null;
  const primaryBlockers = lc.phase === "ready_to_finish"
    ? blockersFor(draft, "finish")
    : primary
      ? blockersFor(draft, primary)
      : [];
  const rider = draft.rider_slots[0]?.rider;
  const showMap = lc.phase === "draft" || lc.phase === "to_pickup" || lc.phase === "in_trip";

  return (
    <div className="driver-cta-content-pad mx-auto flex max-w-lg flex-col">
      {/* header */}
      <div className="driver-step-header -mx-4 border-b bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/driver" })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
            aria-label="Back to dashboard"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{rider?.full_name ?? "Active trip"}</div>
            <div className="truncate text-xs text-muted-foreground">{phaseLabel(draft)}</div>
          </div>
          {!online ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          ) : saving ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-4 py-4">
        {/* map-first */}
        {showMap && (
          <ActiveTripMap
            driver={pos}
            destination={destCoords}
            destinationLabel={dest?.address}
            destinationKind={dest?.kind ?? "pickup"}
            onStartNavigation={dest ? () => openNavigation({ ...destCoords, address: dest.address }) : undefined}
            onRouteOverview={destCoords ? () => setNavOpen(true) : undefined}
          />
        )}

        <div className="space-y-1 rounded-2xl border bg-surface p-4 text-xs">
          <Row label={`${legName} date`} value={`${leg?.leg_date ?? ""} ${leg?.pickup_time ?? ""}`} />
          <Row label="Pickup" value={leg?.pickup_address ?? ""} />
          <Row label="Drop-off" value={leg?.dropoff_address ?? ""} />
          {rider && <Row label="Medicaid ID" value={rider.medicaid_id} />}
        </div>

        {/* ------- at pickup: pickup odometer + time ------- */}
        {lc.phase === "at_pickup" && leg && (
          <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="text-sm font-semibold">Start the ride</div>
            <p className="text-xs text-muted-foreground">
              Take the pickup odometer reading now — it is required on the state billing form.
            </p>
            <Field label="Pickup odometer *">
              <OdometerInput
                value={leg.pickup_odometer}
                onChange={(v) =>
                  patch((d) => updateLegIn(d, lc.active_leg, { pickup_odometer: v }) as ActiveTripDraft)
                }
                onPhoto={(f) => handleOdometerPhoto("pickup_odometer", f)}
                detecting={!!detecting["pickup_odometer"]}
              />
            </Field>
            <Field label="Pickup time *">
              <TimeInput
                value={leg.pickup_time}
                onChange={(v) =>
                  patch((d) => updateLegIn(d, lc.active_leg, { pickup_time: v }) as ActiveTripDraft)
                }
              />
            </Field>
          </div>
        )}

        {/* ------- at dropoff: dropoff odometer, time, signature ------- */}
        {lc.phase === "at_dropoff" && leg && (
          <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="text-sm font-semibold">Complete this leg</div>
            <Field label="Drop-off odometer *">
              <OdometerInput
                value={leg.dropoff_odometer}
                onChange={(v) =>
                  patch((d) => updateLegIn(d, lc.active_leg, { dropoff_odometer: v }) as ActiveTripDraft)
                }
                onPhoto={(f) => handleOdometerPhoto("dropoff_odometer", f)}
                detecting={!!detecting["dropoff_odometer"]}
              />
            </Field>
            <Field label="Drop-off time *">
              <TimeInput
                value={leg.dropoff_time}
                onChange={(v) =>
                  patch((d) => updateLegIn(d, lc.active_leg, { dropoff_time: v }) as ActiveTripDraft)
                }
              />
            </Field>
            <div className="text-xs text-muted-foreground">
              {legMiles(leg) === null
                ? "Drop-off odometer must be ≥ pickup."
                : `Billable mileage this leg: ${legMiles(leg)!.toFixed(1)} mi`}
            </div>

            {draft.rider_slots.map((s) => (
              <div key={s.rider.id} className="space-y-2 rounded-xl border bg-background p-3">
                <div className="text-sm font-medium">{s.rider.full_name} — signature</div>
                <SignaturePad
                  onChange={(url) =>
                    patch((d) => updateSlotIn(d, s.rider.id, { signature_data_url: url }) as ActiveTripDraft)
                  }
                />
                <Field label="Signed by">
                  <Input
                    className="h-12 text-base"
                    value={s.signer_name}
                    onChange={(e) =>
                      patch((d) => updateSlotIn(d, s.rider.id, { signer_name: e.target.value }) as ActiveTripDraft)
                    }
                  />
                </Field>
                <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
                  <span className="text-sm">Signed by escort instead</span>
                  <Switch
                    checked={s.signed_by_escort}
                    onCheckedChange={(v) =>
                      patch(
                        (d) =>
                          updateSlotIn(d, s.rider.id, {
                            signed_by_escort: v,
                            signer_name: v ? d.escort_name || s.signer_name : s.rider.full_name,
                          }) as ActiveTripDraft,
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ------- leg complete: choose next leg or finish ------- */}
        {lc.phase === "leg_complete" && (
          <div className="space-y-3 rounded-2xl border bg-surface p-4">
            <div className="text-sm font-semibold">Leg {lc.active_leg + 1} complete</div>
            <p className="text-xs text-muted-foreground">
              The trip stays open. Pick the passenger up again later for the return leg, or finish now.
            </p>
          </div>
        )}

        {/* ------- ready to finish: review ------- */}
        {lc.phase === "ready_to_finish" && (
          <div className="space-y-3 rounded-2xl border bg-surface p-4">
            <div className="text-sm font-semibold">Review before billing</div>
            {draft.legs.map((l, i) => (
              <div key={l.leg_index} className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
                {draft.legs.length > 1 && (
                  <div className="text-xs font-semibold">{i === 0 ? "Outbound" : "Return"}</div>
                )}
                <Row label="From" value={l.pickup_address} />
                <Row label="To" value={l.dropoff_address} />
                <Row label="Pickup odometer" value={l.pickup_odometer || "— missing"} />
                <Row label="Drop-off odometer" value={l.dropoff_odometer || "— missing"} />
                <Row
                  label="Miles"
                  value={legMiles(l) === null ? "Check readings" : `${legMiles(l)!.toFixed(1)} mi`}
                />
                <Row label="Times" value={`${l.pickup_time || "—"} → ${l.dropoff_time || "—"}`} />
              </div>
            ))}
          </div>
        )}

        {primaryBlockers.length > 0 && (
          <div className="space-y-3 rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Still needed: {primaryBlockers.join(", ")}</span>
            </div>
            {(lc.phase === "leg_complete" || lc.phase === "ready_to_finish") && (
              <div className="grid gap-2 sm:grid-cols-2">
                {draft.legs.map((tripLeg, index) => (
                  <Button
                    key={tripLeg.leg_index}
                    type="button"
                    variant="outline"
                    className="h-11 bg-background text-foreground"
                    onClick={() => editCompletedLeg(index)}
                  >
                    {draft.legs.length > 1
                      ? `Fix ${index === 0 ? "outbound" : "return"} details`
                      : "Fix missing trip details"}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* sticky CTA — single layer, sits above the driver nav pill */}
      <div className="driver-cta-bar -mx-4 border-t bg-background/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg space-y-2">
          {submitStage && <div className="text-center text-xs text-muted-foreground">{submitStage}</div>}

          {lc.phase === "ready_to_finish" ? (
            <Button
              className="h-14 w-full text-base"
              disabled={submitting || !online || blockersFor(draft, "finish").length > 0}
              onClick={sendToBilling}
            >
              {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {submitting ? "Sending…" : "Send to billing"}
            </Button>
          ) : (
            primary && (
              <Button
                className="h-14 w-full text-base"
                aria-disabled={false}
                onClick={() => transition(primary)}
              >
                {actionLabel(primary)}
              </Button>
            )
          )}

          {lc.phase === "leg_complete" && (
            <div className="grid grid-cols-2 gap-2">
              {actions.includes("next_leg") && (
                <Button variant="outline" className="h-12" onClick={() => transition("next_leg")}>
                  {actionLabel("next_leg")}
                </Button>
              )}
              <Button
                variant="outline"
                className="h-12"
                onClick={() => transition("finish")}
                aria-disabled={false}
              >
                Finish trip
              </Button>
            </div>
          )}

          {showMap && destCoords && (
            <Button variant="outline" className="h-12 w-full text-sm" onClick={() => setNavOpen(true)}>
              <Navigation className="mr-2 h-4 w-4" /> Route Overview
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-11 w-full text-sm"
            onClick={() => navigate({ to: "/driver" })}
          >
            Pause — resume later from my dashboard
          </Button>
        </div>
      </div>

      {navOpen && destCoords && dest && (
        <InAppNavigation
          open={navOpen}
          driver={pos}
          destination={destCoords}
          destinationLabel={dest.address}
          destinationKind={dest.kind}
          actionLabel={dest.kind === "pickup" ? "Arrived at pickup" : "Arrived at drop-off"}
          onAction={() => transition(dest.kind === "pickup" ? "arrive_pickup" : "arrive_dropoff")}
          onClose={() => setNavOpen(false)}
        />
      )}
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <Input type="time" className="h-12 text-base" value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        aria-label="Set to now"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border"
        onClick={() => onChange(nowHM())}
      >
        <Clock className="h-4 w-4" />
      </button>
    </div>
  );
}

function OdometerInput({
  value,
  onChange,
  onPhoto,
  detecting,
}: {
  value: string;
  onChange: (value: string) => void;
  onPhoto: (file: File | null) => void;
  detecting: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        inputMode="numeric"
        className="h-12 text-base"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="123456"
      />
      <label className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background text-muted-foreground active:bg-accent">
        {detecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        <span className="sr-only">Take odometer photo</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={detecting}
          onChange={(e) => {
            onPhoto(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
