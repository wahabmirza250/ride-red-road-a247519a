import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Gamepad2, X } from "lucide-react";
import { listPublicGames } from "@/lib/passengerPublic.functions";

export const Route = createFileRoute("/passenger/games")({
  component: GamesPage,
});

function GamesPage() {
  const fetchGames = useServerFn(listPublicGames);
  const q = useQuery({ queryKey: ["public-games"], queryFn: () => fetchGames() });
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState<string>("");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gamepad2 className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Play a game</h1>
      </div>
      <p className="text-xs text-muted-foreground">Pass the time while you wait for your ride.</p>

      {q.isLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {q.data && q.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          No games available yet.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {q.data?.map((g, i) => (
          <button
            key={g.id}
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => {
              setOpenTitle(g.title);
              setOpenUrl(g.url);
            }}
            className="animate-rise-in group overflow-hidden rounded-2xl border border-border/60 bg-surface/80 text-left shadow-soft backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="relative aspect-square bg-surface-muted">
              {g.thumbnail_url ? (
                <img
                  src={g.thumbnail_url}
                  alt={g.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl">🎮</div>
              )}
              {g.category && (
                <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur">
                  {g.category}
                </span>
              )}
            </div>
            <div className="p-2.5">
              <div className="truncate text-xs font-semibold">{g.title}</div>
              {g.description && (
                <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {g.description}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {openUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-rise-in">
          <div className="flex items-center justify-between border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur">
            <div className="truncate text-sm font-semibold">{openTitle}</div>
            <button
              onClick={() => setOpenUrl(null)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <iframe
            src={openUrl}
            title={openTitle}
            className="flex-1 w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
            allow="autoplay; fullscreen; gamepad"
          />
        </div>
      )}
    </div>
  );
}
