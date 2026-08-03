import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Newspaper, ExternalLink, MapPin } from "lucide-react";
import { getRegionalNews, listPublicNews } from "@/lib/passengerPublic.functions";

export const Route = createFileRoute("/passenger/news")({
  component: NewsPage,
});

function getVisitorLocation(): { city?: string; region?: string } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("passenger_location");
    if (!raw) return {};
    return JSON.parse(raw) as { city?: string; region?: string };
  } catch {
    return {};
  }
}

function NewsPage() {
  const fetchRegional = useServerFn(getRegionalNews);
  const fetchCurated = useServerFn(listPublicNews);
  const loc = getVisitorLocation();

  const regional = useQuery({
    queryKey: ["regional-news", loc.city ?? "Colorado Springs", loc.region ?? "CO"],
    queryFn: () => fetchRegional({ data: { city: loc.city, region: loc.region } }),
    staleTime: 15 * 60_000,
  });
  const curated = useQuery({
    queryKey: ["public-news"],
    queryFn: () => fetchCurated(),
  });

  const cityLabel = regional.data?.city ?? loc.city ?? "Colorado Springs";
  const regionLabel = regional.data?.region ?? loc.region ?? "CO";
  const isLoading = regional.isLoading || curated.isLoading;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">What's happening</h1>
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {cityLabel}, {regionLabel}
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {curated.data && curated.data.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            From RedArt
          </h2>
          {curated.data.map((n, i) => (
            <article
              key={n.id}
              style={{ animationDelay: `${i * 60}ms` }}
              className="animate-rise-in overflow-hidden rounded-3xl border border-border/60 bg-surface/80 shadow-soft backdrop-blur transition hover:shadow-lift"
            >
              {n.image_url && (
                <img src={n.image_url} alt="" className="h-40 w-full object-cover" loading="lazy" />
              )}
              <div className="p-5">
                <h3 className="text-base font-semibold tracking-tight">{n.title}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>
                <div className="mt-3 flex items-center justify-between">
                  <time className="text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleDateString()}
                  </time>
                  {n.link_url && (
                    <a href={n.link_url} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Read more <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Local headlines
        </h2>
        {regional.data?.items.length === 0 && !regional.isLoading && (
          <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            No local headlines right now.
          </div>
        )}
        {regional.data?.items.map((n, i) => (
          <a
            key={n.link || i}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            style={{ animationDelay: `${i * 40}ms` }}
            className="animate-rise-in block rounded-2xl border border-border/60 bg-surface/70 p-4 shadow-soft backdrop-blur transition hover:shadow-lift hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold tracking-tight line-clamp-2">{n.title}</h3>
                {n.description && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.description}</p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {n.source && <span>{n.source}</span>}
                  {n.pubDate && <span>· {new Date(n.pubDate).toLocaleDateString()}</span>}
                </div>
              </div>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
