import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { getDriverLocations, getLocationNews, type NewsItem, type DriverLocation } from "@/lib/news.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/news")({
  ssr: false,
  component: NewsPage,
  head: () => ({
    meta: [
      { title: "Local News — RedArt NEMT" },
      { name: "description", content: "Live local news for each active driver's current city." },
    ],
  }),
});

function timeAgo(pub: string): string {
  const t = Date.parse(pub);
  if (Number.isNaN(t)) return pub;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NewsPage() {
  const fetchLocations = useServerFn(getDriverLocations);
  const fetchNews = useServerFn(getLocationNews);

  const locationsQuery = useQuery({
    queryKey: ["driver-locations"],
    queryFn: () => fetchLocations(),
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => {
    const list = locationsQuery.data ?? [];
    const map = new Map<string, { city: string; region: string | null; drivers: typeof list }>();
    for (const d of list) {
      if (!d.city) continue;
      const key = `${d.city}|${d.region ?? ""}`;
      const g = map.get(key);
      if (g) g.drivers.push(d);
      else map.set(key, { city: d.city, region: d.region, drivers: [d] });
    }
    return Array.from(map.values()).sort((a, b) => b.drivers.length - a.drivers.length);
  }, [locationsQuery.data]);

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && groups.length > 0) setSelected(`${groups[0].city}|${groups[0].region ?? ""}`);
  }, [groups, selected]);

  const active = groups.find((g) => `${g.city}|${g.region ?? ""}` === selected) ?? null;

  const newsQuery = useQuery({
    queryKey: ["news", active?.city, active?.region],
    queryFn: () => fetchNews({ data: { city: active!.city, region: active!.region } }),
    enabled: !!active,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Local News</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live headlines for each city your drivers are currently in.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            locationsQuery.refetch();
            newsQuery.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </header>

      {locationsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Finding driver locations…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-soft">
          No drivers have shared a GPS location yet. Once a driver goes on shift, their city will appear here.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cities ({groups.length})
            </div>
            {groups.map((g) => {
              const key = `${g.city}|${g.region ?? ""}`;
              const isActive = key === selected;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    isActive
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border bg-surface hover:bg-accent"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {g.city}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {g.region ?? "—"} · {g.drivers.length} driver{g.drivers.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
            {!active ? null : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {active.city}
                      {active.region ? `, ${active.region}` : ""}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {active.drivers.map((d: DriverLocation) => d.name).join(" · ")}
                    </p>
                  </div>
                  {newsQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>

                {newsQuery.data?.error ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                    {newsQuery.data.error}
                  </div>
                ) : null}

                <ul className="divide-y divide-border">
                  {(newsQuery.data?.items ?? []).map((item, i) => (
                    <li key={i} className="py-3">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="group block"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-medium leading-snug text-foreground group-hover:text-primary">
                            {item.title}
                          </h3>
                          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{item.source || "News"}</span>
                          <span>·</span>
                          <span>{timeAgo(item.pubDate)}</span>
                        </div>
                        {item.description ? (
                          <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                        ) : null}
                      </a>
                    </li>
                  ))}
                  {newsQuery.data && newsQuery.data.items.length === 0 && !newsQuery.data.error ? (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                      No recent headlines for this area.
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
