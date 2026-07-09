import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarPlus,
  Loader2,
  MapPin,
  Trash2,
  Pencil,
  Megaphone,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteEvent,
  listEventsAdmin,
  upsertEvent,
  type EventInput,
} from "@/lib/events.functions";

export const Route = createFileRoute("/_authenticated/events")({
  component: EventsPage,
});

type EventRow = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
};

function EventsPage() {
  const listFn = useServerFn(listEventsAdmin);
  const events = useQuery({ queryKey: ["events-admin"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Post parties, free food, community events — passengers get a push notification and a one-tap Book a Ride."
      />

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              onClick={() => setEditing(null)}
              className="rounded-full"
            >
              <CalendarPlus className="mr-2 h-4 w-4" /> New event
            </Button>
          </DialogTrigger>
          <EventDialog
            editing={editing}
            onClose={() => {
              setOpen(false);
              setEditing(null);
            }}
          />
        </Dialog>
      </div>

      {events.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (events.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No events yet. Create your first one to notify passengers.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(events.data as EventRow[]).map((e) => (
            <EventCard
              key={e.id}
              row={e}
              onEdit={() => {
                setEditing(e);
                setOpen(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ row, onEdit }: { row: EventRow; onEdit: () => void }) {
  const q = useQueryClient();
  const delFn = useServerFn(deleteEvent);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`Delete "${row.title}"?`)) return;
    setBusy(true);
    try {
      await delFn({ data: { id: row.id } });
      toast.success("Event deleted");
      q.invalidateQueries({ queryKey: ["events-admin"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      {row.image_url ? (
        <img src={row.image_url} alt="" className="h-40 w-full object-cover" />
      ) : (
        <div className="flex h-40 items-center justify-center bg-primary/10 text-primary">
          <Megaphone className="h-10 w-10" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold">{row.title}</h3>
              {!row.is_active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  Draft
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(row.starts_at).toLocaleString()}
            </div>
            {row.location_address && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {row.location_address}
              </div>
            )}
          </div>
        </div>
        {row.description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.description}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 rounded-full" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full text-rose-500"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function EventDialog({
  editing,
  onClose,
}: {
  editing: EventRow | null;
  onClose: () => void;
}) {
  const q = useQueryClient();
  const save = useServerFn(upsertEvent);
  const [form, setForm] = useState<EventInput>(() => ({
    id: editing?.id,
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    starts_at: toLocalInput(editing?.starts_at) || toLocalInput(new Date().toISOString()),
    ends_at: toLocalInput(editing?.ends_at ?? undefined),
    location_address: editing?.location_address ?? "",
    location_lat: editing?.location_lat ?? null,
    location_lng: editing?.location_lng ?? null,
    image_url: editing?.image_url ?? "",
    is_active: editing?.is_active ?? true,
    notify: !editing,
  }));
  const [busy, setBusy] = useState(false);

  function upd<K extends keyof EventInput>(k: K, v: EventInput[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (!form.title.trim() || !form.starts_at) {
      return toast.error("Title and start time are required");
    }
    setBusy(true);
    try {
      await save({
        data: {
          ...form,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        },
      });
      toast.success(editing ? "Event updated" : "Event published");
      q.invalidateQueries({ queryKey: ["events-admin"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit event" : "New event"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={form.title}
            onChange={(e) => upd("title", e.target.value)}
            placeholder="Free food night, Community party..."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={3}
            value={form.description ?? ""}
            onChange={(e) => upd("description", e.target.value)}
            placeholder="What's happening, who's invited..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Starts</Label>
            <Input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => upd("starts_at", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ends (optional)</Label>
            <Input
              type="datetime-local"
              value={form.ends_at ?? ""}
              onChange={(e) => upd("ends_at", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Location address</Label>
          <Input
            value={form.location_address ?? ""}
            onChange={(e) => upd("location_address", e.target.value)}
            placeholder="123 Main St, Colorado Springs, CO"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            <ImageIcon className="h-3.5 w-3.5" /> Image URL (optional)
          </Label>
          <Input
            value={form.image_url ?? ""}
            onChange={(e) => upd("image_url", e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <div>
            <div className="text-sm font-medium">Active</div>
            <div className="text-xs text-muted-foreground">
              Show to passengers in the app.
            </div>
          </div>
          <Switch
            checked={form.is_active ?? true}
            onCheckedChange={(v) => upd("is_active", v)}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border bg-primary/5 px-3 py-2">
          <div>
            <div className="text-sm font-medium">Send push notification</div>
            <div className="text-xs text-muted-foreground">
              Notify all subscribed passengers now.
            </div>
          </div>
          <Switch
            checked={form.notify ?? false}
            onCheckedChange={(v) => upd("notify", v)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editing ? "Save" : "Publish"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
