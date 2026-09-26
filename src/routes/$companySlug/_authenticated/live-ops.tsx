import { getPublicDispatchPhone } from '@/lib/guestBooking.functions';
import { locationState } from "@/lib/operationStatus";
import { useWorkspaceSearch } from "@/lib/useWorkspaceSearch";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { PlanRidesPanel } from "@/components/dispatch/PlanRidesPanel";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { GoogleFleetMap, type FleetMarker } from "@/components/nemt/GoogleFleetMap";
import { fmtMoney } from "@/lib/rideMath";
import { adminReassignDriver, adminCancelTrip } from "@/lib/dispatchAdmin.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAutoAssign, setAutoAssign } from "@/lib/settings.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/live-ops")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "today" | "plan"; from?: string; to?: string; q?: string } => ({
    tab: search.tab === "plan" ? "plan" : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: DispatchWorkspace,
});

/**
 * Single Dispatch destination for admins: live operations today, plus the ride
 * planning workflow that used to live on its own top-level Planner page.
 */
function DispatchWorkspace() {
  const search = useSearch({ strict: false }) as { tab?: string };
  const [tab, setTab] = useWorkspaceSearch("tab", "today");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>
        <p className="text-sm text-muted-foreground">
          Live operations and ride planning in one workspace.
        </p>
      </div>
      <div className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
        {(
          [
            { id: "today", label: "Today" },
            { id: "plan", label: "Plan rides" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`rounded-lg px-4 py-1.5 font-medium transition ${
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "today" ? <LiveOps /> : <PlanRidesPanel />}
    </div>
  );
}

const DEFAULT_CENTER: [number, number] = [39.7392, -104.9903]; // Denver
const DEFAULT_ZOOM = 11;

type DriverRow = {
  id: string;
  user_id: string;
  status: "available" | "busy" | "offline";
  current_lat: number | null;
  current_lng: number | null;
  last_location_at: string | null;
  name?: string;
};
type Req = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  contact_phone: string | null;
  estimated_fare: number | null;
  created_at: string;
};

function LiveOps() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    id?: string;
  } | null>(null);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const reassign = useServerFn(adminReassignDriver);
  const cancelTrip = useServerFn(adminCancelTrip);

  const onReassign = useCallback(
    async (requestId: string, driverId: string) => {
      if (!driverId) return;
      setReassigning(requestId);
      try {
        await reassign({ data: { request_id: requestId, driver_id: driverId } });
        toast.success("Driver reassigned");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Reassignment failed");
      } finally {
        setReassigning(null);
      }
    },
    [reassign],
  );

  const onCancel = useCallback(
    async (requestId: string) => {
      if (!window.confirm("Cancel this ride? The driver will be notified.")) return;
      setCancelling(requestId);
      try {
        await cancelTrip({ data: { request_id: requestId } });
        toast.success("Ride cancelled");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Cancel failed");
      } finally {
        setCancelling(null);
      }
    },
    [cancelTrip],
  );

  const [loadError, setLoadError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [{ data: d, error: driverError }, { data: r, error: requestError }] = await Promise.all(
        [
          supabase
            .from("drivers")
            .select("id,user_id,status,current_lat,current_lng,last_location_at"),
          supabase
            .from("ride_requests")
            .select(
              "id,status,driver_id,pickup_address,dropoff_address,contact_phone,estimated_fare,created_at",
            )
            .in("status", ["pending", "accepted"])
            .order("created_at", { ascending: false })
            .limit(50),
        ],
      );
      if (driverError || requestError)
        throw new Error("Driver or ride data could not be refreshed");
      const rows = (d ?? []) as DriverRow[];
      const ids = rows.map((x) => x.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
        : { data: [] as { id: string; first_name: string | null; last_name: string | null }[] };
      const map = new Map<string, string>();
      (profs ?? []).forEach((p) =>
        map.set(p.id, (p.first_name ?? "").trim() || `${p.last_name ?? "Driver"}`),
      );
      setDrivers(rows.map((x) => ({ ...x, name: map.get(x.user_id) ?? "Driver" })));
      setReqs((r ?? []) as Req[]);
      setLoadError(null);
      setUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Connection unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(), 15000);
    const ch = supabase
      .channel("live-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips" }, (payload) => {
        const oldStatus = (payload.old as { status?: string } | null)?.status;
        const newStatus = (payload.new as { status?: string } | null)?.status;
        if (newStatus && oldStatus !== newStatus) {
          const label: Record<string, string> = {
            driver_en_route_to_pickup: "Driver started pickup",
            arrived_at_pickup: "Driver arrived at pickup",
            in_progress: "Trip in progress",
            completed: "Trip completed",
            cancelled: "Trip cancelled",
          };
          const msg = label[newStatus];
          if (msg) toast(msg);
        }
        load();
      })
      .subscribe();
    return () => {
      window.clearInterval(refreshTimer);
      supabase.removeChannel(ch);
    };
  }, [load]);

  const markers: FleetMarker[] = drivers
    .filter((d) => d.current_lat != null && d.current_lng != null)
    .map((d) => ({
      id: d.id,
      lat: Number(d.current_lat),
      lng: Number(d.current_lng),
      status: locationState(d) === "Live" ? d.status : "offline",
      label: d.name ?? "Driver",
    }));

  const onlineCount = drivers.filter((d) => locationState(d) === "Live").length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Real-time drivers and active ride requests. Updates automatically.
      </p>
      {loadError && (
        <div role="alert" className="rounded-xl border border-destructive p-3 text-sm">
          {loadError}. {updated ? "Last successful update: " + updated : "Data unavailable."}{" "}
          <button onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {updated ? "Updated " + updated : "Loading operations…"}
      </p>
      <AutoAssignCard />
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Drivers online", value: onlineCount },
          { label: "Pending requests", value: reqs.filter((r) => r.status === "pending").length },
          { label: "Active trips", value: reqs.filter((r) => r.status === "accepted").length },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-border bg-surface p-4 shadow-soft"
          >
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-2xl font-bold">{loadError || !updated ? "—" : c.value}</div>
          </div>
        ))}
      </div>
      <div className="h-[420px] overflow-hidden rounded-2xl border border-border">
        <GoogleFleetMap
          center={DEFAULT_CENTER}
          markers={markers}
          focus={focus}
          onMarkerClick={(id) => {
            const d = drivers.find((x) => x.id === id);
            if (d?.current_lat && d?.current_lng)
              setFocus({ lat: Number(d.current_lat), lng: Number(d.current_lng), zoom: 14, id });
          }}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-semibold">
          <span>Drivers ({drivers.length})</span>
          {focus && (
            <button
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={() => setFocus(null)}
            >
              Reset view
            </button>
          )}
        </div>
        <div className="divide-y divide-border">
          {!loadError && updated && drivers.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No drivers yet.</div>
          )}
          {drivers.map((d) => {
            const hasGps = d.current_lat != null && d.current_lng != null;
            const dot =
              locationState(d) !== "Live"
                ? "bg-gray-400"
                : d.status === "busy"
                  ? "bg-amber-500"
                  : d.status === "available"
                    ? "bg-emerald-500"
                    : "bg-gray-400";
            const selected = focus?.id === d.id;
            return (
              <button
                key={d.id}
                disabled={!hasGps}
                onClick={() =>
                  hasGps &&
                  setFocus({
                    id: d.id,
                    lat: Number(d.current_lat),
                    lng: Number(d.current_lng),
                    zoom: 16,
                  })
                }
                className={`flex w-full items-center justify-between py-3 text-left text-sm transition ${
                  selected ? "bg-primary/5" : ""
                } ${hasGps ? "hover:bg-muted/50 cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  <div>
                    <div className="font-medium">{d.name ?? "Driver"}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.status.replace(/_/g, " ")} · GPS {locationState(d)}
                      {d.last_location_at
                        ? " · " + new Date(d.last_location_at).toLocaleTimeString()
                        : ""}
                      {!hasGps && " · no GPS"}
                    </div>
                  </div>
                </div>
                {hasGps && (
                  <div className="text-xs font-mono text-muted-foreground">
                    {Number(d.current_lat).toFixed(3)}, {Number(d.current_lng).toFixed(3)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-semibold">
          <span>Active requests</span>
          {(() => {
            const unassigned = reqs.filter((r) => r.status === "pending" && !r.driver_id).length;
            return unassigned > 0 ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                {unassigned} awaiting manual dispatch
              </span>
            ) : null;
          })()}
        </div>
        <div className="divide-y divide-border">
          {reqs.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Nothing active.</div>
          )}
          {reqs.map((r) => {
            const ageSec = Math.max(
              0,
              Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000),
            );
            const unassigned = r.status === "pending" && !r.driver_id;
            const stale = unassigned && ageSec > 45;
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between py-3 text-sm ${
                  stale ? "bg-amber-500/5" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                    <span>{r.status}</span>
                    {unassigned && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal ${
                          stale ? "bg-amber-500 text-white" : "bg-amber-500/15 text-amber-600"
                        }`}
                      >
                        {stale ? "Needs manual dispatch" : "Unassigned"}
                      </span>
                    )}
                    <span className="text-muted-foreground/70">
                      · {ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`} ago
                    </span>
                  </div>
                  <div className="truncate">↑ {r.pickup_address}</div>
                  <div className="truncate">↓ {r.dropoff_address}</div>
                  {unassigned && r.contact_phone && (
                    <a
                      href={`tel:${r.contact_phone.replace(/[^+\d]/g, "")}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Call passenger · {r.contact_phone}
                    </a>
                  )}
                </div>
                <div className="ml-3 flex flex-col items-end gap-2">
                  <div className="font-semibold">{fmtMoney(r.estimated_fare)}</div>
                  <select
                    className="max-w-[140px] rounded-md border border-border bg-background px-2 py-1 text-xs"
                    value={r.driver_id ?? ""}
                    disabled={reassigning === r.id}
                    onChange={(e) => onReassign(r.id, e.target.value)}
                    title="Reassign driver"
                  >
                    <option value="" disabled>
                      {r.driver_id ? "Change driver…" : "Assign driver…"}
                    </option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.status}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onCancel(r.id)}
                    disabled={cancelling === r.id}
                    className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {cancelling === r.id ? "Cancelling…" : "Cancel ride"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DispatchPhoneCard />
    </div>
  );
}

function DispatchPhoneCard() {
  const getPhone = useServerFn(getPublicDispatchPhone);
  const phone = useQuery({queryKey:['company-support'],queryFn:()=>getPhone()});
  return <div className="rounded-2xl border border-border bg-surface p-4"><h2 className="text-sm font-semibold">Passenger support number</h2>
    <p className="mt-2 text-sm">{phone.isLoading ? 'Loading…' : phone.data?.phone || 'Not configured'}</p>
    <p className="mt-2 text-xs text-muted-foreground">The platform owner sets this number in the company profile.</p>
  </div>;
}

/**
 * Company-level auto-assign toggle. Admin-only write (the server function
 * enforces the admin role); dispatchers see the same switch read-only on the
 * dispatch board. When OFF, new ride requests land unassigned in the dispatch
 * queue instead of firing the auto-dispatch logic.
 */
function AutoAssignCard() {
  const qc = useQueryClient();
  const fetchAuto = useServerFn(getAutoAssign);
  const saveAuto = useServerFn(setAutoAssign);
  const auto = useQuery({ queryKey: ["auto-assign"], queryFn: () => fetchAuto() });
  const [saving, setSaving] = useState(false);
  const enabled = auto.data?.enabled ?? false;

  async function toggle() {
    setSaving(true);
    try {
      await saveAuto({ data: { enabled: !enabled } });
      toast.success(`Auto-assign turned ${!enabled ? "ON" : "OFF"}`);
      qc.invalidateQueries({ queryKey: ["auto-assign"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update auto-assign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div>
        <div className="text-sm font-semibold">Auto-assign</div>
        <div className="text-xs text-muted-foreground">
          {enabled
            ? "ON — new requests are dispatched to the nearest driver automatically."
            : "OFF — new requests wait unassigned in the dispatch queue."}
        </div>
      </div>
      <button
        type="button"
        aria-label="Toggle auto-assign"
        aria-pressed={enabled}
        disabled={saving || auto.isLoading}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          enabled ? "bg-primary" : "bg-muted"
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
            enabled ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
