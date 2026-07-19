import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { GoogleFleetMap, type FleetMarker } from "@/components/nemt/GoogleFleetMap";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/_authenticated/live-ops")({
  component: LiveOps,
});

const DEFAULT_CENTER: [number, number] = [39.7392, -104.9903]; // Denver
const DEFAULT_ZOOM = 11;

type DriverRow = {
  id: string;
  user_id: string;
  status: "available" | "busy" | "offline";
  current_lat: number | null;
  current_lng: number | null;
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
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; id?: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from("drivers").select("id,user_id,status,current_lat,current_lng"),
      supabase
        .from("ride_requests")
        .select("id,status,driver_id,pickup_address,dropoff_address,contact_phone,estimated_fare,created_at")
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false })
        .limit(50),

    ]);
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
  }, []);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("live-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, load)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        (payload) => {
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
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const markers: FleetMarker[] = drivers
    .filter((d) => d.current_lat != null && d.current_lng != null)
    .map((d) => ({
      id: d.id,
      lat: Number(d.current_lat),
      lng: Number(d.current_lng),
      status: d.status,
      label: d.name ?? "Driver",
    }));

  const onlineCount = drivers.filter((d) => d.status !== "offline").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live Ops</h1>
        <p className="text-sm text-muted-foreground">
          Real-time drivers + active ride requests. Updates automatically.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Drivers online", value: onlineCount },
          { label: "Pending requests", value: reqs.filter((r) => r.status === "pending").length },
          { label: "Active trips", value: reqs.filter((r) => r.status === "accepted").length },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
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
          {drivers.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No drivers yet.</div>
          )}
          {drivers.map((d) => {
            const hasGps = d.current_lat != null && d.current_lng != null;
            const dot =
              d.status === "busy"
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
                      {d.status.replace(/_/g, " ")}
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
            const unassigned = reqs.filter(
              (r) => r.status === "pending" && !r.driver_id,
            ).length;
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
                          stale
                            ? "bg-amber-500 text-white"
                            : "bg-amber-500/15 text-amber-600"
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
                <div className="ml-3 font-semibold">{fmtMoney(r.estimated_fare)}</div>
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
  const [phone, setPhone] = useState<string>("");
  const [initial, setInitial] = useState<string>("");
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (uid) {
        const { data: role } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "admin")
          .maybeSingle();
        setCanEdit(!!role);
      }
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "dispatch_phone_number")
        .maybeSingle();
      const v = data?.value ?? "";
      setPhone(v);
      setInitial(v);
    })();
  }, []);

  const dirty = phone.trim() !== initial;

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "dispatch_phone_number", value: phone.trim() }, { onConflict: "key" });
      if (error) {
        toast.error(error.message);
      } else {
        setInitial(phone.trim());
        toast.success("Dispatch phone updated");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold">Dispatch phone number</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Shown to passengers when no driver is auto-matched. Use a number that reaches your
        dispatch team 24/7.
      </p>
      <div className="flex gap-2">
        <input
          type="tel"
          value={phone}
          disabled={!canEdit}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 (800) 555-1234"
          className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />
        {canEdit && (
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {!canEdit && (
        <p className="mt-2 text-xs text-muted-foreground">Admin access required to edit.</p>
      )}
    </div>
  );
}

    </div>
  );
}
