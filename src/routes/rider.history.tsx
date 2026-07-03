import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { fmtMoney } from "@/lib/rideMath";

export const Route = createFileRoute("/rider/history")({
  component: History,
});

type Row = {
  id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number | null;
  actual_dropoff_time: string | null;
  created_at: string;
  passenger_rating: number | null;
};

function History() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase
      .from("trips")
      .select(
        "id,status,pickup_address,dropoff_address,estimated_fare,actual_dropoff_time,created_at,passenger_rating",
      )
      .eq("passenger_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, [user]);

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No trips yet.
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{r.status}</div>
            <div className="text-sm font-semibold">{fmtMoney(r.estimated_fare)}</div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {new Date(r.actual_dropoff_time ?? r.created_at).toLocaleString()}
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="truncate">↑ {r.pickup_address}</div>
            <div className="truncate">↓ {r.dropoff_address}</div>
          </div>
          {r.passenger_rating && (
            <div className="mt-2 text-xs text-muted-foreground">
              You rated {r.passenger_rating}★
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
