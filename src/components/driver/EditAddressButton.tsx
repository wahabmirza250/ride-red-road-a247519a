import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Loader2 } from "lucide-react";
import { updateTripAddress } from "@/lib/tripStops.functions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Lets the driver correct a pickup/dropoff address mid-trip (wrong unit,
 * clinic entrance, passenger moved). Applied server-side with the service
 * role so the driver-field guard trigger doesn't reject it.
 */
export function EditAddressButton({
  tripId,
  field,
  current,
  onDone,
}: {
  tripId: string;
  field: "pickup" | "dropoff";
  current: string;
  onDone: () => void;
}) {
  const save = useServerFn(updateTripAddress);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!value.trim()) {
      toast.error("Enter an address");
      return;
    }
    setSaving(true);
    try {
      await save({
        data: {
          trip_id: tripId,
          field,
          address: value.trim(),
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        },
      });
      toast.success("Address updated");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update address");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label={`Edit ${field} address`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {field} address</DialogTitle>
        </DialogHeader>
        <AddressAutocomplete
          value={value}
          onChange={(v) => {
            setValue(v);
            setCoords(null);
          }}
          onSelect={(p) => {
            setValue(p.address);
            setCoords(
              typeof p.lat === "number" && typeof p.lng === "number"
                ? { lat: p.lat, lng: p.lng }
                : null,
            );
          }}
          placeholder="Search address"
        />
        <Button onClick={() => void submit()} disabled={saving} className="w-full">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save address
        </Button>
      </DialogContent>
    </Dialog>
  );
}
