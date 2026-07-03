import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Gamepad2, Newspaper, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";

export const Route = createFileRoute("/rider/fun")({
  component: Fun,
});

type NewsItem = { id: string; title: string; body: string; image_url: string | null; link_url: string | null };
type Game = { id: string; title: string; description: string | null; url: string | null; thumbnail_url: string | null };

function Fun() {
  const [tab, setTab] = useState<"news" | "games">("news");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    supabase
      .from("news_items")
      .select("id,title,body,image_url,link_url")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setNews((data ?? []) as NewsItem[]));
    supabase
      .from("games")
      .select("id,title,description,url,thumbnail_url")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setGames((data ?? []) as Game[]));
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-full border border-border bg-surface p-1">
        {(["news", "games"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center justify-center gap-2 rounded-full py-2 text-sm font-medium capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t === "news" ? <Newspaper className="h-4 w-4" /> : <Gamepad2 className="h-4 w-4" />}
            {t}
          </button>
        ))}
      </div>

      {tab === "news" && (
        <div className="space-y-3">
          {news.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No news yet.
            </div>
          )}
          {news.map((n) => (
            <article key={n.id} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
              {n.image_url && (
                <img src={n.image_url} alt={n.title} className="h-40 w-full object-cover" />
              )}
              <div className="p-4">
                <h3 className="text-base font-semibold">{n.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                {n.link_url && (
                  <a
                    href={n.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline"
                  >
                    Read more <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "games" && (
        <div className="grid grid-cols-2 gap-3">
          {games.length === 0 && (
            <div className="col-span-2 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No games available.
            </div>
          )}
          {games.map((g) => (
            <a
              key={g.id}
              href={g.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
            >
              {g.thumbnail_url && (
                <img src={g.thumbnail_url} alt={g.title} className="aspect-square w-full object-cover" />
              )}
              <div className="p-3">
                <div className="text-sm font-semibold">{g.title}</div>
                {g.description && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{g.description}</div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
