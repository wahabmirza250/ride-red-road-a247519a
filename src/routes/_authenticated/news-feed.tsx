import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/news-feed")({
  component: NewsAdmin,
});

type Item = { id: string; title: string; body: string; image_url: string | null; link_url: string | null; is_active: boolean };

function NewsAdmin() {
  const [rows, setRows] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState("");
  const [link, setLink] = useState("");

  const load = () =>
    supabase
      .from("news_items")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Item[]));
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    if (!title || !body) return toast.error("Title and body required");
    const { error } = await supabase.from("news_items").insert({
      title,
      body,
      image_url: image || null,
      link_url: link || null,
    });
    if (error) return toast.error(error.message);
    setTitle("");
    setBody("");
    setImage("");
    setLink("");
    void load();
  }

  async function toggle(row: Item) {
    await supabase.from("news_items").update({ is_active: !row.is_active }).eq("id", row.id);
    void load();
  }
  async function remove(id: string) {
    await supabase.from("news_items").delete().eq("id", id);
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Passenger News Feed</h1>
        <p className="text-sm text-muted-foreground">Announcements shown in the Rider app.</p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-6 shadow-soft md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Image URL (optional)</Label>
          <Input value={image} onChange={(e) => setImage(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Body</Label>
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Link URL (optional)</Label>
          <Input value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button onClick={add} className="rounded-full">
            Publish
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{r.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{r.body}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Active
                  <Switch checked={r.is_active} onCheckedChange={() => toggle(r)} />
                </div>
                <button
                  onClick={() => remove(r.id)}
                  className="p-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No news items yet.
          </div>
        )}
      </div>
    </div>
  );
}
