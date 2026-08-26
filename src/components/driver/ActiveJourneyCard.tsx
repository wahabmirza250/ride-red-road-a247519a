import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Navigation, Route as RouteIcon, Check, Loader2, Users } from "lucide-react";
import { getMyActiveRoute, completeRouteStop } from "@/lib/routes.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/driver/SignaturePad";
import { JourneyNavigation } from "@/components/driver/JourneyNavigation";
import { useLocationBroadcast } from "@/lib/useGeolocation";
import { cn } from "@/lib/utils";
import {
  arriveAtStop, completeStop, completedCount, createJourney, isJourneyComplete,
  journeySummary, nextStop, onboardRides, recordPosition, rideStatus, startJourney,
  stopBlockers, type Journey, type JourneyStop, type StopSeed,
} from "@/lib/journey";
import { loadJourney, mergeSavedProgress, saveJourney } from "@/lib/journeyStore";

type Loaded = Awaited<ReturnType<typeof getMyActiveRoute>>;

function toSeeds(stops: NonNullable<Loaded>["stops"]): StopSeed[] {
  return stops
    .filter((s) => s.kind === "pickup" || s.kind === "dropoff")
    .map((s, i) => ({
      id: String(s.id),
      sequence: Number(s.sequence ?? i + 1),
      kind: s.kind as "pickup" | "dropoff",
      ride_id: String(s.request_id ?? `${s.passenger_name ?? "passenger"}|${s.leg ?? "outbound"}`),
      passenger_name: s.passenger_name ?? "Passenger",
      medicaid_id: (s as { passenger_medicaid_id?: string | null }).passenger_medicaid_id ?? null,
      address: s.address,
      lat: s.lat == null ? null : Number(s.lat),
      lng: s.lng == null ? null : Number(s.lng),
      notes: s.notes ?? null,
      completed_at: s.completed_at ?? null,
    }));
}

/**
 * The driver's one active vehicle route: several passengers, one ordered list
 * of pickups and drop-offs, and one navigation screen that always points at
 * the next stop. Progress is saved on the device, so closing or refreshing the
 * app never loses the route.
 */
export function ActiveJourneyCard() {
  const load = useServerFn(getMyActiveRoute);
  const completeServerStop = useServerFn(completeRouteStop);

  const [journey, setJourney] = useState<Journey | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locationIssue, setLocationIssue] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<JourneyStop | null>(null);
  const [odometer, setOdometer] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    let data: Loaded = null;
    try {
      data = await load(undefined);
    } catch {
      return; // keep the on-device route when the network is down
    }
    if (!data || !data.stops.length) {
      setJourney(null);
      return;
    }
    const companyId = String((data.route as { company_id?: string }).company_id ?? "company");
    const driverId = String((data.route as { driver_id?: string }).driver_id ?? "driver");
    const fresh = createJourney({
      id: String(data.route.id),
      company_id: companyId,
      driver_id: driverId,
      stops: toSeeds(data.stops),
    });
    setJourney(mergeSavedProgress(fresh, loadJourney(companyId, driverId)));
  }, [load]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Persist every change so a refresh or reopen resumes exactly where we were.
  useEffect(() => {
    if (journey) saveJourney(journey);
  }, [journey]);

  const trackingEnabled = Boolean(journey) && !isJourneyComplete(journey ?? ({} as Journey));
  const onPos = useCallback((p: { lat: number; lng: number }) => {
    setPosition(p);
    setLocationIssue(null);
    setJourney((j) => (j ? recordPosition(j, { ...p, at: new Date().toISOString() }) : j));
  }, []);
  useLocationBroadcast(trackingEnabled, onPos, 15000, setLocationIssue);

  const next = journey ? nextStop(journey) : null;
  const onboard = journey ? onboardRides(journey) : [];

  const progressLabel = useMemo(() => {
    if (!journey) return "";
    return `Stop ${Math.min(completedCount(journey) + 1, journey.stops.length)} of ${journey.stops.length}`;
  }, [journey]);

  function openConfirm(stop: JourneyStop) {
    setConfirmStop(stop);
    setOdometer(stop.odometer ?? "");
    setSignature(stop.signature_data_url ?? null);
    setSignerName(stop.signer_name ?? stop.passenger_name ?? "");
  }

  function markArrived(stop: JourneyStop) {
    setJourney((j) => (j ? arriveAtStop(j, stop.id, new Date().toISOString()) : j));
    openConfirm({ ...stop, status: "arrived" });
  }

  async function saveStop() {
    if (!journey || !confirmStop || busyRef.current) return;
    const input = {
      at: new Date().toISOString(),
      odometer,
      signature_data_url: confirmStop.kind === "dropoff" ? signature : null,
      signer_name: confirmStop.kind === "dropoff" ? signerName.trim() || null : null,
    };
    const blockers = stopBlockers(journey, confirmStop.id, input);
    if (blockers.length) {
      toast.error(`Still needed: ${blockers.join(", ")}`);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    try {
      // Record on the device first so a dropped connection never loses the stop.
      setJourney((j) => {
        if (!j) return j;
        const started = startJourney(j, input.at, odometer);
        return completeStop(started, confirmStop.id, input);
      });
      await completeServerStop({ data: { stop_id: confirmStop.id } });
      setConfirmStop(null);
      toast.success(
        confirmStop.kind === "pickup"
          ? `${confirmStop.passenger_name} is on board`
          : `${confirmStop.passenger_name} dropped off`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Saved on this device. We'll sync when you're back online (${e.message})`
          : "Saved on this device — it will sync automatically",
      );
      setConfirmStop(null);
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }

  if (!journey || !journey.stops.length) return null;

  const done = completedCount(journey);
  const finished = isJourneyComplete(journey);

  return (
    <>
      <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
            <RouteIcon className="h-4 w-4" /> Active Route
          </div>
          <div className="text-xs text-muted-foreground">
            {journeySummary(journey)} · {done}/{journey.stops.length} completed
          </div>
        </div>

        {onboard.length > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
            <Users className="h-3.5 w-3.5" />
            {onboard.length} {onboard.length === 1 ? "passenger" : "passengers"} on board
          </div>
        )}

        {locationIssue && (
          <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600">
            {locationIssue} Your route and stop times are safe — continue and record each stop.
          </div>
        )}

        {next ? (
          <div className="space-y-3 rounded-2xl bg-surface p-4 shadow-soft">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Next Stop · {progressLabel}
            </div>
            <div className="text-lg font-semibold leading-tight">
              {next.kind === "pickup" ? "Pickup" : "Drop-off"} · {next.passenger_name}
            </div>
            <div className="text-sm text-muted-foreground">{next.address}</div>
            {next.medicaid_id && (
              <div className="text-[11px] text-muted-foreground">Member ID {next.medicaid_id}</div>
            )}
            <Button
              className="h-14 w-full rounded-2xl text-base font-semibold"
              onClick={() =>
                openNavigation({ lat: next.lat, lng: next.lng, address: next.address })
              }
            >
              <Navigation className="mr-2 h-5 w-5" /> Start Navigation
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-12 flex-1 rounded-2xl text-sm font-semibold"
                onClick={() => (next.status === "pending" ? markArrived(next) : openConfirm(next))}
              >
                {next.status === "pending"
                  ? next.kind === "pickup"
                    ? "Arrived at Pickup"
                    : "Arrived at Drop-off"
                  : next.kind === "pickup"
                    ? "Confirm Pickup"
                    : "Complete Drop-off"}
              </Button>
              <Button
                variant="ghost"
                className="h-12 rounded-2xl text-sm font-semibold"
                onClick={() => setNavOpen(true)}
              >
                <MapIcon className="mr-2 h-4 w-4" /> Route Overview
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-600">
            All stops completed. Every passenger's trip has been recorded.
          </div>
        )}

        <ol className="space-y-1.5">
          {journey.stops.map((s, i) => (
            <li
              key={s.id}
              className={cn(
                "flex items-start gap-2 rounded-xl bg-surface p-2.5 text-xs",
                s.status === "done" && "opacity-55",
                next?.id === s.id && "ring-1 ring-primary",
              )}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                {s.status === "done" ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.kind === "pickup" ? "Pickup" : "Drop-off"} · {s.passenger_name}
                </div>
                <div className="truncate text-muted-foreground">{s.address}</div>
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {s.status === "done"
                  ? "Completed"
                  : rideStatus(journey, s.ride_id) === "on_board"
                    ? "On board"
                    : s.status === "arrived"
                      ? "Arrived"
                      : "Scheduled"}
              </span>
            </li>
          ))}
        </ol>

        {finished && (
          <p className="text-[11px] text-muted-foreground">
            Trip times, signatures and mileage readings were saved for each passenger separately.
          </p>
        )}
      </div>

      {next && (
        <JourneyNavigation
          open={navOpen}
          stop={next}
          position={position}
          progressLabel={progressLabel}
          actionLabel={
            next.status === "pending"
              ? next.kind === "pickup"
                ? "Arrived at Pickup"
                : "Arrived at Drop-off"
              : next.kind === "pickup"
                ? "Confirm Pickup"
                : "Complete Drop-off"
          }
          onAction={() => {
            setNavOpen(false);
            if (next.status === "pending") markArrived(next);
            else openConfirm(next);
          }}
          onClose={() => setNavOpen(false)}
        />
      )}

      <Dialog open={!!confirmStop} onOpenChange={(o) => !o && setConfirmStop(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {confirmStop?.kind === "pickup" ? "Confirm Pickup" : "Complete Drop-off"}
            </DialogTitle>
            <DialogDescription>
              {confirmStop?.passenger_name}
              {confirmStop?.medicaid_id ? ` · Member ID ${confirmStop.medicaid_id}` : ""} —{" "}
              {confirmStop?.address}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="journey-odometer">
                {confirmStop?.kind === "pickup" ? "Odometer at pickup" : "Odometer at drop-off"}
              </label>
              <Input
                id="journey-odometer"
                inputMode="decimal"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="e.g. 148230"
              />
            </div>

            {confirmStop?.kind === "dropoff" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Passenger Signature</label>
                <SignaturePad onChange={setSignature} />
                <Input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Name of the person signing"
                />
              </div>
            )}

            <Button
              className="h-12 w-full rounded-xl text-sm font-semibold"
              disabled={saving}
              onClick={() => void saveStop()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : confirmStop?.kind === "pickup" ? (
                "Passenger On Board"
              ) : (
                "Complete Drop-off"
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              This records only {confirmStop?.passenger_name}'s trip. Other passengers in the
              vehicle stay active until their own drop-off.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
