import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { formatDateTime, humanizeStatus } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/incidents")({
  component: IncidentsPage,
});

type Incident = {
  id: string;
  driver_id: string;
  trip_id: string | null;
  incident_type: "accident" | "late" | "no_show" | "complaint" | "mechanical" | "other";
  description: string;
  photo_url: string | null;
  status: "open" | "reviewed" | "closed";
  admin_notes: string | null;
  created_at: string;
};

const TABS: Array<{ key: "all" | "open" | "reviewed" | "closed"; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "reviewed", label: "Reviewed" },
  { key: "closed", label: "Closed" },
];

function IncidentsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "open" | "reviewed" | "closed">("all");
  const [selected, setSelected] = useState<Incident | null>(null);

  const list = useQuery({
    queryKey: ["incidents", tab],
    queryFn: async () => {
      let q = supabase.from("incidents").select("*").order("created_at", { ascending: false });
      if (tab !== "all") q = q.eq("status", tab);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Incident[];
    },
  });

  const counts = useQuery({
    queryKey: ["incident-counts"],
    queryFn: async () => {
      const [{ count: open }, { count: reviewed }, { count: closed }] = await Promise.all([
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "reviewed"),
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "closed"),
      ]);
      return { open: open ?? 0, reviewed: reviewed ?? 0, closed: closed ?? 0 };
    },
  });

  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const openDetail = async (inc: Incident) => {
    setSelected(inc);
    setNotes(inc.admin_notes ?? "");
    setPhotoUrl(null);
    if (inc.photo_url) {
      const { data } = await supabase.storage.from("incidents").createSignedUrl(inc.photo_url, 600);
      setPhotoUrl(data?.signedUrl ?? null);
    }
  };

  const update = useMutation({
    mutationFn: async (patch: Partial<Incident>) => {
      if (!selected) return;
      const { error } = await supabase.from("incidents").update(patch).eq("id", selected.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident-counts"] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Driver-reported issues." />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition",
              tab === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:bg-accent",
            )}
          >
            {t.label}
            {t.key !== "all" && counts.data ? (
              <span className="ml-2 text-xs opacity-75">{counts.data[t.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          {list.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : list.data?.length ? (
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {list.data.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => openDetail(i)}
                    className={cn(
                      "flex w-full items-start gap-3 p-4 text-left hover:bg-accent",
                      selected?.id === i.id && "bg-primary/8",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{humanizeStatus(i.incident_type)}</span>
                        <StatusPill status={i.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(i.created_at)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-10 text-center text-sm text-muted-foreground">No incidents.</div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an incident to review.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{humanizeStatus(selected.incident_type)}</h2>
                  <p className="text-xs text-muted-foreground">{formatDateTime(selected.created_at)}</p>
                </div>
                <StatusPill status={selected.status} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</div>
                <p className="whitespace-pre-wrap text-sm">{selected.description}</p>
              </div>
              {photoUrl && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Photo</div>
                  <img src={photoUrl} alt="Incident" className="max-h-80 rounded-xl border border-border" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Admin notes
                </label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => update.mutate({ admin_notes: notes })}>
                  Save notes
                </Button>
                <Button variant="outline" onClick={() => update.mutate({ status: "reviewed", admin_notes: notes })}>
                  Mark reviewed
                </Button>
                <Button onClick={() => update.mutate({ status: "closed", admin_notes: notes })}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
