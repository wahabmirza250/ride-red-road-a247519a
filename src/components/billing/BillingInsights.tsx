import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Layers, MessageSquare, Settings } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { AppLink } from "@/lib/appLink";
import { AutoPilotButton } from "@/components/billing/AutoPilotButton";
import { listDeniedClaims } from "@/lib/resubmission.functions";
import type { BillingCounts } from "@/components/billing/BillingKpiRow";

const DONUT_COLORS = ["#10b981", "#7c5cff", "#f59e0b", "#ef4444", "#38bdf8"];

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bill-card min-w-0 p-5 ${className ?? ""}`}>
      <header className="mb-4 min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Claims Overview donut + Processing Activity line + Auto Pilot status. */
export function BillingInsights({ counts }: { counts: BillingCounts }) {
  const n = (k: string) => Number(counts?.[k] ?? 0);
  const donut = [
    { name: "Paid", value: n("paid") },
    { name: "Submitted", value: n("submitted") },
    { name: "Needs Attention", value: n("needs_attention") },
    { name: "Rejected / Denied", value: n("denied") + n("rejected") },
    { name: "Queued", value: n("queued") + n("pending_submit") + n("submitting") },
  ].filter((d) => d.value > 0);
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);

  // Read-only activity trend: how many bills changed state per day recently.
  const activity = useQuery({
    queryKey: ["billing_activity_14d"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const since = new Date(Date.now() - 13 * 86400_000);
      since.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("billing_records")
        .select("status, updated_at")
        .gte("updated_at", since.toISOString())
        .order("updated_at", { ascending: false })
        .limit(3000);
      const buckets = new Map<string, { day: string; submitted: number; paid: number }>();
      for (let i = 0; i < 14; i++) {
        const d = new Date(since.getTime() + i * 86400_000);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { day: key.slice(5), submitted: 0, paid: 0 });
      }
      for (const r of (data ?? []) as any[]) {
        const key = String(r.updated_at ?? "").slice(0, 10);
        const b = buckets.get(key);
        if (!b) continue;
        if (r.status === "paid") b.paid += 1;
        else if (r.status === "submitted") b.submitted += 1;
      }
      return [...buckets.values()];
    },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.85fr)]">
      <Card title="Claims Overview" subtitle="Where every claim currently sits">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donut.length ? donut : [{ name: "No claims", value: 1 }]}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={2}
                stroke="none"
              >
                {(donut.length ? donut : [{ name: "none", value: 1 }]).map((_, i) => (
                  <Cell key={i} fill={donut.length ? DONUT_COLORS[i % DONUT_COLORS.length] : "#e5e7eb"} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-xl font-semibold tabular-nums">{donutTotal.toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">claims</div>
            </div>
          </div>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
          {donut.map((d, i) => (
            <li key={d.name} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="truncate text-muted-foreground">{d.name}</span>
              <span className="ml-auto shrink-0 tabular-nums">{d.value}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Claims Processing Activity" subtitle="Last 14 days">
        <div className="h-[262px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activity.data ?? []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(120,120,140,0.18)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="submitted"
                stroke="#7c5cff"
                strokeWidth={2.5}
                dot={false}
              />
              <Line type="monotone" dataKey="paid" stroke="#10b981" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Auto Pilot" subtitle="Sends ready bills in safe waves">
          <AutoPilotButton />
        </Card>
        <QuickActions />
        <TopDenialReasons />
      </div>
    </div>
  );
}

function QuickActions() {
  const items = [
    { to: "/billing/chat", label: "Add a paper bill", icon: MessageSquare },
    { to: "/billing/batch", label: "Batch upload", icon: Layers },
    { to: "/billing/settings", label: "Billing settings", icon: Settings },
  ];
  return (
    <Card title="Quick Actions">
      <div className="flex flex-col gap-1.5">
        {items.map((i) => (
          <AppLink
            key={i.to}
            to={i.to}
            className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-foreground/80 transition hover:bg-accent"
          >
            <i.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{i.label}</span>
          </AppLink>
        ))}
      </div>
    </Card>
  );
}

function TopDenialReasons() {
  const listFn = useServerFn(listDeniedClaims);
  const q = useQuery({
    queryKey: ["denied_claims", "top_reasons"],
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => listFn({ data: { page: 0, page_size: 100 } }) as Promise<any>,
  });

  const top = useMemo(() => {
    const rows = (q.data?.rows ?? []) as any[];
    const tally = new Map<string, number>();
    for (const r of rows) {
      const raw = String(r.denial_reason ?? "").trim();
      const reason = raw ? raw.slice(0, 60) : "No reason given";
      tally.set(reason, (tally.get(reason) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [q.data]);

  return (
    <Card title="Top Denial Reasons">
      {top.length ? (
        <ul className="flex flex-col gap-2">
          {top.map(([reason, count]) => (
            <li key={reason} className="flex min-w-0 items-start gap-2 text-[12px]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={reason}>
                {reason}
              </span>
              <span className="shrink-0 tabular-nums font-medium">{count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">No denials recorded.</p>
      )}
    </Card>
  );
}
