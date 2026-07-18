import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Send, MapPin, Clock, Phone, User, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { submitRideRequest } from "@/lib/passengerPublic.functions";
import { passengerRequestRide } from "@/lib/dispatch.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/passenger/apply")({
  validateSearch: (search: Record<string, unknown>) => ({
    dropoff: typeof search.dropoff === "string" ? search.dropoff : undefined,
    pickup: typeof search.pickup === "string" ? search.pickup : undefined,
    eventTitle: typeof search.eventTitle === "string" ? search.eventTitle : undefined,
  }),
  component: ApplyForRide,
});

function ApplyForRide() {
  const { user } = useAuth();
  const submit = useServerFn(submitRideRequest);
  const submitAuthed = useServerFn(passengerRequestRide);
  const search = Route.useSearch();
  const [f, setF] = useState({
    contact_name: "",
    contact_phone: "",
    contact_medicaid: "",
    pickup_address: search.pickup ?? "",
    dropoff_address: search.dropoff ?? "",
    requested_pickup_time: "",
    notes: search.eventTitle ? `Going to: ${search.eventTitle}` : "",
  });
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const phone = window.localStorage.getItem("passenger_phone") ?? "";
    if (phone) setF((p) => ({ ...p, contact_phone: p.contact_phone || phone }));
  }, []);

  function upd<K extends keyof typeof f>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (user && pickupCoords && dropoffCoords) {
        const res = await submitAuthed({
          data: {
            pickup_address: f.pickup_address,
            pickup_lat: pickupCoords.lat,
            pickup_lng: pickupCoords.lng,
            dropoff_address: f.dropoff_address,
            dropoff_lat: dropoffCoords.lat,
            dropoff_lng: dropoffCoords.lng,
            requested_pickup_time: f.requested_pickup_time || null,
            notes: f.notes || null,
            contact_name: f.contact_name || null,
            contact_phone: f.contact_phone || null,
          },
        });
        setDispatchMsg(
          res.assigned
            ? "Driver found — waiting for them to accept."
            : res.reason === "no_drivers_available"
              ? "No drivers available nearby right now. We'll keep trying and notify dispatch."
              : "Request submitted.",
        );
      } else {
        await submit({ data: f });
        setDispatchMsg(null);
      }
      setDone(true);
      if (typeof window !== "undefined" && f.contact_phone) {
        window.localStorage.setItem("passenger_phone", f.contact_phone);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setLoading(false);
    }
  }


  if (done) {
    return (
      <div className="animate-rise-in rounded-3xl border border-border/60 bg-surface/80 p-8 text-center shadow-lift backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">Request received</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {dispatchMsg ?? `Dispatch will call you at ${f.contact_phone} shortly to confirm your ride.`}
        </p>
        <Button
          className="mt-6 rounded-full"
          onClick={() => {
            setDone(false);
            setF({
              contact_name: "",
              contact_phone: "",
              contact_medicaid: "",
              pickup_address: "",
              dropoff_address: "",
              requested_pickup_time: "",
              notes: "",
            });
          }}
        >
          Book another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-6 shadow-soft backdrop-blur">
        <h1 className="text-lg font-semibold tracking-tight">Book a ride</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill out the form and dispatch will call you back to confirm.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <Field icon={<User className="h-4 w-4" />} label="Full name" required>
            <Input value={f.contact_name} onChange={(e) => upd("contact_name", e.target.value)} required />
          </Field>
          <Field icon={<Phone className="h-4 w-4" />} label="Phone" required>
            <Input type="tel" inputMode="tel" value={f.contact_phone} onChange={(e) => upd("contact_phone", e.target.value)} required />
          </Field>
          <Field icon={<FileText className="h-4 w-4" />} label="Medicaid ID (optional)">
            <Input value={f.contact_medicaid} onChange={(e) => upd("contact_medicaid", e.target.value)} />
          </Field>
          <Field icon={<MapPin className="h-4 w-4 text-emerald-500" />} label="Pickup address" required>
            <Input value={f.pickup_address} onChange={(e) => upd("pickup_address", e.target.value)} required />
          </Field>
          <Field icon={<MapPin className="h-4 w-4 text-rose-500" />} label="Drop-off address" required>
            <Input value={f.dropoff_address} onChange={(e) => upd("dropoff_address", e.target.value)} required />
          </Field>
          <Field icon={<Clock className="h-4 w-4" />} label="Pickup time">
            <Input type="datetime-local" value={f.requested_pickup_time} onChange={(e) => upd("requested_pickup_time", e.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <Label>Notes for driver</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => upd("notes", e.target.value)} placeholder="Wheelchair, appointment info, etc." />
          </div>

          <Button type="submit" disabled={loading} className="mt-2 w-full rounded-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Send className="mr-2 h-4 w-4" /> Send request</>)}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  required,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{icon}</span>
        {label}
        {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
