import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Home, Briefcase, MapPin, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { useCurrentPosition } from "@/lib/useGeolocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/rider/places")({
  component: Places,
});

type Place = { id: string; label: string; address: string; lat: number; lng: number; kind: string };

function Places() {
  const { user } = useAuth();
  const { pos } = useCurrentPosition();
  const [rows, setRows] = useState<Place[]>([]);
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [kind, setKind] = useState<"home" | "work" | "custom">("custom");

  const load = () => {
    if (!user) return;
    supabase
      .from("saved_places")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Place[]));
  };
  useEffect(load, [user]);

  async function add() {
    if (!user) return;
    const m = addr.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return toast.error("Address must be lat,lng for now");
    const { error } = await supabase.from("saved_places").insert({
      user_id: user.id,
      label: label || kind,
      address: addr,
      lat: parseFloat(m[1]),
      lng: parseFloat(m[2]),
      kind,
    });
    if (error) return toast.error(error.message);
    setLabel("");
    setAddr("");
    load();
  }

  async function remove(id: string) {
    await supabase.from("saved_places").delete().eq("id", id);
    load();
  }

  const iconFor = (k: string) => (k === "home" ? Home : k === "work" ? Briefcase : MapPin);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-sm font-semibold">Add a place</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["home", "work", "custom"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-xl border p-2 text-sm capitalize ${
                kind === k ? "border-primary bg-primary/5 text-primary" : "border-border"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <div className="space-y-1">
            <Label>Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mom's house" />
          </div>
          <div className="space-y-1">
            <Label>Coordinates</Label>
            <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="lat,lng" />
            {pos && (
              <button
                onClick={() => setAddr(`${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`)}
                className="text-xs text-primary underline"
              >
                Use current location
              </button>
            )}
          </div>
          <Button onClick={add} className="w-full rounded-full">
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const Icon = iconFor(r.kind);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-border bg-surface p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.address}</div>
                </div>
              </div>
              <button onClick={() => remove(r.id)} className="p-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
