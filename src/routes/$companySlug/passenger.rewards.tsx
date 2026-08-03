import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy, Sparkles, Loader2, CheckCircle2, Lock } from "lucide-react";
import { getRewardsPublic, getMyProgress } from "@/lib/rewards.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/$companySlug/passenger/rewards")({
  ssr: false,
  component: RewardsPage,
});

function RewardsPage() {
  const { user } = useAuth();
  const publicFn = useServerFn(getRewardsPublic);
  const progressFn = useServerFn(getMyProgress);

  const pub = useQuery({
    queryKey: ["rewards-public"],
    queryFn: () => publicFn(),
    enabled: !!user,
  });
  const prog = useQuery({
    queryKey: ["rewards-progress"],
    queryFn: () => progressFn(),
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  if (!user) {
    return (
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-8 text-center shadow-soft">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Sign in to see rewards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your rides and enter contests for prizes.
        </p>
        <AppLink to="/passenger/signup" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          Sign in
        </AppLink>
      </div>
    );
  }

  if (pub.isLoading || prog.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const settings = pub.data?.settings;
  if (!settings?.enabled) {
    return (
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-8 text-center shadow-soft">
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Rewards coming soon</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Our rewards program is paused right now. Check back soon.
        </p>
      </div>
    );
  }

  const p = prog.data!;
  const pct = Math.min(100, Math.round((p.ride_count / p.settings.rides_required) * 100));
  const remaining = Math.max(0, p.settings.rides_required - p.ride_count);
  const label = p.settings.period_type === "monthly" ? "this month" : "this week";

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-primary/15 via-surface/80 to-surface/60 p-6 shadow-lift backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
            <Trophy className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Ride Rewards</h1>
            <p className="text-xs text-muted-foreground">
              Current prize · {p.settings.winners_per_period} winner{p.settings.winners_per_period > 1 ? "s" : ""} {label}
            </p>
            <p className="mt-1 text-base font-semibold text-primary">
              {p.settings.prize_description}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {p.ride_count} of {p.settings.rides_required} rides {label}
            </span>
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          {p.entered ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              You're entered in this {p.settings.period_type === "monthly" ? "month's" : "week's"} contest!
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {remaining} more ride{remaining === 1 ? "" : "s"} to qualify.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-surface/80 p-5 shadow-soft backdrop-blur">
        <h2 className="text-sm font-semibold">Recent winners</h2>
        {(pub.data?.winners ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Be the first to win — complete rides to enter.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pub.data!.winners.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{w.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(w.period_start).toLocaleDateString()} – {new Date(w.period_end).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-xs font-medium text-primary">{w.prize_description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
