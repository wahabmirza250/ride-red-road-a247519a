import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Pencil, Trash2, ExternalLink, X, Gamepad2, Upload } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/games")({
  ssr: false,
  component: GamesPage,
  head: () => ({
    meta: [
      { title: "Games — RedArt NEMT" },
      { name: "description", content: "Curated web games for drivers on break." },
    ],
  }),
});

type Game = {
  id: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  category: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type Draft = Omit<Game, "id"> & { id?: string };

const emptyDraft: Draft = {
  title: "",
  url: "",
  thumbnail_url: "",
  category: "",
  description: "",
  sort_order: 0,
  is_active: true,
};

function GamesPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);

  const { data: games, isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Game[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        title: d.title.trim(),
        url: d.url.trim(),
        thumbnail_url: d.thumbnail_url?.trim() || null,
        category: d.category?.trim() || null,
        description: d.description?.trim() || null,
        sort_order: Number(d.sort_order) || 0,
        is_active: d.is_active,
      };
      if (d.id) {
        const { error } = await supabase.from("games").update(payload).eq("id", d.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("games").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["games"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("games").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["games"] }),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Games</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick links to free web games. Great for downtime between trips.
          </p>
        </div>
        {isAdmin ? (
          <Button size="sm" onClick={() => setEditing({ ...emptyDraft })}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add game
          </Button>
        ) : null}
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading games…
        </div>
      ) : (games ?? []).length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-soft">
          No games yet.{isAdmin ? " Click 'Add game' to add one." : ""}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {(games ?? []).map((g) => (
            <div
              key={g.id}
              className={`group relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft transition hover:-translate-y-0.5 hover:shadow-md ${
                g.is_active ? "" : "opacity-60"
              }`}
            >
              <a href={g.url} target="_blank" rel="noreferrer" className="block">
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-surface-muted">
                  <GameThumb src={g.thumbnail_url} title={g.title} />
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-medium">{g.title}</h3>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {g.category ?? "Game"}
                    {!g.is_active ? " · hidden" : ""}
                  </div>
                </div>
              </a>
              {isAdmin ? (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => setEditing(g)}
                    className="rounded-md bg-background/90 p-1.5 text-muted-foreground shadow hover:text-foreground"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${g.title}"?`)) deleteMutation.mutate(g.id);
                    }}
                    className="rounded-md bg-background/90 p-1.5 text-destructive shadow hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editing.id ? "Edit game" : "Add game"}
              </h2>
              <button
                onClick={() => setEditing(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate(editing);
              }}
            >
              <label className="block text-xs font-medium text-muted-foreground">
                Title
                <Input
                  required
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                URL
                <Input
                  type="url"
                  required
                  placeholder="https://…"
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  className="mt-1"
                />
              </label>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Thumbnail</div>
                <div className="flex items-center gap-3">
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
                    <GameThumb src={editing.thumbnail_url ?? null} title={editing.title || "Preview"} />
                  </div>
                  <ThumbnailUploader
                    onUploaded={(path) => setEditing({ ...editing, thumbnail_url: path })}
                  />
                </div>
                <Input
                  type="text"
                  placeholder="Or paste an image URL (https://…) or upload above"
                  value={editing.thumbnail_url ?? ""}
                  onChange={(e) => setEditing({ ...editing, thumbnail_url: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  Category
                  <Input
                    value={editing.category ?? ""}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    className="mt-1"
                  />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Sort order
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                    className="mt-1"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-muted-foreground">
                Description
                <Textarea
                  rows={2}
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                Active (visible to everyone)
              </label>
              {saveMutation.error ? (
                <div className="text-xs text-destructive">
                  {(saveMutation.error as Error).message}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isHttpUrl(v: string | null | undefined): boolean {
  return !!v && /^https?:\/\//i.test(v);
}

function GameThumb({ src, title }: { src: string | null; title: string }) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(null);
      return;
    }
    if (isHttpUrl(src)) {
      setResolved(src);
      return;
    }
    // Treat as storage path in "games" bucket
    supabase.storage
      .from("games")
      .createSignedUrl(src, 60 * 60 * 6)
      .then(({ data }) => {
        if (!cancelled) setResolved(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved) {
    return <Gamepad2 className="h-10 w-10 text-muted-foreground" />;
  }
  return (
    <img
      src={resolved}
      alt={title}
      className="h-full w-full object-cover transition group-hover:scale-105"
      loading="lazy"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function ThumbnailUploader({ onUploaded }: { onUploaded: (path: string) => void }) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("games")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      onUploaded(path);
      toast.success("Thumbnail uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground shadow-soft hover:bg-accent">
      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
      {uploading ? "Uploading…" : "Upload image"}
      <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
    </label>
  );
}

