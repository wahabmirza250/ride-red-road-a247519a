import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Newspaper, ExternalLink } from "lucide-react";
import { listPublicNews } from "@/lib/passengerPublic.functions";

export const Route = createFileRoute("/passenger/news")({
  component: NewsPage,
});

function NewsPage() {
  const fetchNews = useServerFn(listPublicNews);
  const q = useQuery({ queryKey: ["public-news"], queryFn: () => fetchNews() });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Newspaper className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">What's new</h1>
      </div>

      {q.isLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {q.data && q.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          No news yet. Check back soon.
        </div>
      )}

      <div className="space-y-3">
        {q.data?.map((n, i) => (
          <article
            key={n.id}
            style={{ animationDelay: `${i * 60}ms` }}
            className="animate-rise-in overflow-hidden rounded-3xl border border-border/60 bg-surface/80 shadow-soft backdrop-blur transition hover:shadow-lift"
          >
            {n.image_url && (
              <img src={n.image_url} alt="" className="h-40 w-full object-cover" loading="lazy" />
            )}
            <div className="p-5">
              <h2 className="text-base font-semibold tracking-tight">{n.title}</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>
              <div className="mt-3 flex items-center justify-between">
                <time className="text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleDateString()}
                </time>
                {n.link_url && (
                  <a
                    href={n.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Read more <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
