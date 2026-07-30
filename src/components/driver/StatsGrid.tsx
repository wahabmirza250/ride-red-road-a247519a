import { Clock, DollarSign, Gauge, Route as RouteIcon } from "lucide-react";

type Stats = {
  todayHours: number;
  todayMiles: number;
  /** null when no hourly rate has been set by an admin yet */
  todayEarnings: number | null;
  speedMph: number | null;
  hourlyRate: number | null;
  onShift: boolean;
};

export function StatsGrid(s: Stats) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard icon={<Clock className="h-4 w-4" />} label={s.onShift ? "On shift" : "Hours today"}
        value={`${s.todayHours.toFixed(2)}h`} sub={s.onShift ? "clocked in" : "since 12 AM"} accent="emerald" />
      <StatCard icon={<DollarSign className="h-4 w-4" />} label="Earnings today"
        value={s.todayEarnings == null ? "—" : `$${s.todayEarnings.toFixed(2)}`}
        sub={s.hourlyRate == null ? "rate not set yet" : `@ $${Number(s.hourlyRate).toFixed(2)}/hr`}
        accent="primary" />
      <StatCard icon={<RouteIcon className="h-4 w-4" />} label="Miles today"
        value={`${s.todayMiles.toFixed(1)} mi`} sub="GPS-tracked" />
      <StatCard icon={<Gauge className="h-4 w-4" />} label="Speed"
        value={s.speedMph == null ? "—" : `${Math.round(s.speedMph)}`}
        sub="mph, live" />
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  accent?: "primary" | "emerald";
}) {
  const accentClass =
    accent === "primary" ? "text-primary" : accent === "emerald" ? "text-emerald-500" : "text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest ${accentClass}`}>
        {icon}{label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
