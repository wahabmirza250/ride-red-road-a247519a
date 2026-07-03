import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/driver/earnings")({
  component: Earnings,
});

type TripRow = { estimated_fare: number | null; actual_dropoff_time: string | null };

function Earnings() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TripRow[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: d } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!d) return;
      const { data } = await supabase
        .from("trips")
        .select("estimated_fare, actual_dropoff_time")
        .eq("driver_id", d.id)
        .eq("status", "completed")
        .order("actual_dropoff_time", { ascending: false })
        .limit(200);
      setRows((data ?? []) as TripRow[]);
    })();
  }, [user]);

  const now = Date.now();
  const today = rows.filter((r) => r.actual_dropoff_time && now - new Date(r.actual_dropoff_time).getTime() < 86400000);
  const week = rows.filter((r) => r.actual_dropoff_time && now - new Date(r.actual_dropoff_time).getTime() < 7 * 86400000);
  const sum = (a: TripRow[]) => a.reduce((s, r) => s + Number(r.estimated_fare ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Today", value: sum(today), n: today.length },
          { label: "Week", value: sum(week), n: week.length },
          { label: "All-time", value: sum(rows), n: rows.length },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-lg font-bold">{fmtMoney(c.value)}</div>
            <div className="text-xs text-muted-foreground">{c.n} trips</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold">Recent completed trips</div>
        <div className="divide-y divide-border">
          {rows.slice(0, 20).map((r, i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <div className="text-muted-foreground">
                {r.actual_dropoff_time
                  ? new Date(r.actual_dropoff_time).toLocaleString()
                  : "—"}
              </div>
              <div className="font-medium">{fmtMoney(r.estimated_fare)}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No completed trips yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
