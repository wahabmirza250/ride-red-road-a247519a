import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getTodaysSchedule } from "@/lib/dispatchApp.functions";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$companySlug/$companySlug/dispatch/schedule")({
  component: ScheduleView,
});

type Data = Awaited<ReturnType<typeof getTodaysSchedule>>;

function ScheduleView() {
  const load = useServerFn(getTodaysSchedule);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (d: string) => {
      setLoading(true);
      try {
        setData(await load({ data: { date: d } }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load schedule");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void refresh(date);
  }, [refresh, date]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-lg font-semibold">Schedule</h1>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 w-auto"
        />
      </div>

      {loading || !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Drivers ({data.drivers.length})</div>
            {data.drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No drivers on file.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.drivers.map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.shift
                          ? `Shift ${new Date(d.shift.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${new Date(d.shift.end_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${d.shift.status}`
                          : "No shift scheduled"}
                        {d.vehicle_type ? ` · ${d.vehicle_type.replace(/_/g, " ")}` : ""}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        d.online
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.online ? "online" : "offline"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">
              Scheduled rides ({data.trips.length})
            </div>
            {data.trips.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled for this date.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.trips.map((t) => (
                  <div key={t.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {t.requested_pickup_time
                          ? new Date(t.requested_pickup_time).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "Time TBD"}
                        {" · "}
                        {t.contact_name || "Passenger"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.driver_name ?? "unassigned"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.pickup_address} → {t.dropoff_address}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
