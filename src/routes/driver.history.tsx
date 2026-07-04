import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { fmtMoney } from "@/lib/rideMath";
import { formatDateTime } from "@/lib/format";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/driver/history")({
  component: DriverHistory,
});

type Row = {
  id: string;
  scheduled_pickup_time: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  estimated_fare: number | null;
  passenger_rating: number | null;
};

function DriverHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: d } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!d?.id) return setRows([]);
      const { data } = await supabase
        .from("trips")
        .select(
          "id,scheduled_pickup_time,pickup_address,dropoff_address,status,estimated_fare,passenger_rating",
        )
        .eq("driver_id", d.id)
        .order("scheduled_pickup_time", { ascending: false })
        .limit(60);
      setRows((data ?? []) as Row[]);
    })();
  }, [user]);

  if (rows === null)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Trip history</h1>
      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No trips yet.
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatDateTime(r.scheduled_pickup_time)}</span>
            <span className="uppercase tracking-widest">{r.status.replace(/_/g, " ")}</span>
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="truncate">↑ {r.pickup_address}</div>
            <div className="truncate">↓ {r.dropoff_address}</div>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="font-semibold">{fmtMoney(r.estimated_fare)}</span>
            {r.passenger_rating != null && (
              <span className="text-warning">★ {r.passenger_rating}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
