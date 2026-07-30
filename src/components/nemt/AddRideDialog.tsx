import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { dispatchListPassengers, dispatchScheduleRide } from "@/lib/dispatchSchedule.functions";

type Passenger = { id: string; name: string; medicaid_id: string; phone: string };

function defaultTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One-click ride scheduling from the dispatch board. Supports today or any
 * future date/time, with an optional driver picked from the board's driver
 * list (passed in so both surfaces stay in sync).
 */
export function AddRideDialog({
  drivers,
  preselectedDriverId,
  onCreated,
}: {
  drivers: Array<{ id: string; name: string; activity: string }>;
  preselectedDriverId?: string | null;
  onCreated: () => void;
}) {
  const loadPassengers = useServerFn(dispatchListPassengers);
  const schedule = useServerFn(dispatchScheduleRide);

  const [open, setOpen] = useState(false);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [search, setSearch] = useState("");
  const [passengerId, setPassengerId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [pickup, setPickup] = useState("");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [when, setWhen] = useState(defaultTime);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDriverId(preselectedDriverId ?? "");
    loadPassengers(undefined)
      .then((rows) => setPassengers(rows as Passenger[]))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load passengers"));
  }, [loadPassengers, open, preselectedDriverId]);

  const filtered = passengers.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.medicaid_id.toLowerCase().includes(q);
  });

  async function submit() {
    setSaving(true);
    try {
      await schedule({
        data: {
          passenger_id: passengerId,
          pickup_address: pickup,
          dropoff_address: dropoff,
          pickup_lat: pickupCoords?.lat ?? null,
          pickup_lng: pickupCoords?.lng ?? null,
          dropoff_lat: dropoffCoords?.lat ?? null,
          dropoff_lng: dropoffCoords?.lng ?? null,
          scheduled_pickup_time: new Date(when).toISOString(),
          driver_id: driverId || null,
          notes,
        },
      });
      toast.success("Ride scheduled");
      setOpen(false);
      setPassengerId("");
      setPickup("");
      setDropoff("");
      setPickupCoords(null);
      setDropoffCoords(null);
      setNotes("");
      setWhen(defaultTime());
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule ride");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" /> Add ride
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule a ride</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Passenger</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or Medicaid ID"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-40 overflow-auto rounded-xl border border-border">
                {filtered.slice(0, 25).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPassengerId(p.id)}
                    className={`flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent ${
                      passengerId === p.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.medicaid_id}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    No passengers match.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Pickup address</Label>
              <AddressAutocomplete
                value={pickup}
                onChange={(v) => {
                  setPickup(v);
                  setPickupCoords(null);
                }}
                onResolve={(p) => {
                  setPickup(p.address);
                  setPickupCoords({ lat: p.lat, lng: p.lng });
                }}
                placeholder="Start typing pickup address…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Drop-off address</Label>
              <AddressAutocomplete
                value={dropoff}
                onChange={(v) => {
                  setDropoff(v);
                  setDropoffCoords(null);
                }}
                onResolve={(p) => {
                  setDropoff(p.address);
                  setDropoffCoords({ lat: p.lat, lng: p.lng });
                }}
                placeholder="Start typing drop-off address…"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Pickup date &amp; time</Label>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Driver (optional)</Label>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">Leave unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.activity}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Schedule ride
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
