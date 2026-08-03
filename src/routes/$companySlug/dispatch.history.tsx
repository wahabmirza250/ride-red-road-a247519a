import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/errorMessage";
import { Loader2 } from "lucide-react";
import { getDispatchDayHistory } from "@/lib/dispatchApp.functions";
import { Input } from "@/components/ui/input";
import { TripPdfButton, TripReportEditor } from "@/components/nemt/TripReportEditor";

export const Route = createFileRoute("/$companySlug/$companySlug/dispatch/history")({
  component: HistoryView,
});

type Data = Awaited<ReturnType<typeof getDispatchDayHistory>>;

function HistoryView() {
  const load = useServerFn(getDispatchDayHistory);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (d: string) => {
      setLoading(true);
      try {
        setData(await load({ data: { date: d } }));
      } catch (e) {
        toast.error(friendlyErrorMessage(e, "Could not load history"));
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
        <h1 className="font-display text-lg font-semibold">History</h1>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto" />
      </div>

      {loading || !data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Dispatch activity ({data.events.length})</div>
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dispatch events on this date.</p>
            ) : (
              <ol className="space-y-2 border-l border-border pl-4">
                {data.events.map((e) => (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                    <div className="font-medium">{e.summary}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      {" · "}
                      {String(e.kind).replace(/_/g, " ")}
                      {e.actor_name ? ` · ${e.actor_name}` : ""}
                      {e.driver_name ? ` → ${e.driver_name}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 text-sm font-semibold">Trips created ({data.trips.length})</div>
            {data.trips.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trips created on this date.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.trips.map((t) => (
                  <div key={t.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{t.driver_name ?? "Unassigned"}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {String(t.status).replace(/_/g, " ")}
                        </span>
                        {t.status === "completed" && <TripPdfButton tripId={t.id} />}
                        <TripReportEditor tripId={t.id} />
                      </div>
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
