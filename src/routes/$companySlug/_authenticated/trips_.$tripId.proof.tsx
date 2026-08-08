import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTripProofBundle } from "@/lib/tripMedia.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/trips/$tripId/proof")({
  component: ProofPage,
});

type Bundle = Awaited<ReturnType<typeof getTripProofBundle>>;

function ProofPage() {
  const { tripId } = Route.useParams();
  const load = useServerFn(getTripProofBundle);
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    load({ data: { trip_id: tripId } })
      .then((r) => setB(r as Bundle))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [load, tripId]);

  if (err) return <div className="p-6 text-sm text-destructive">{err}</div>;
  if (!b) return <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const { trip, stops, media, passengers, urls } = b;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <AppLink to="/trips" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to trips
        </AppLink>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> Print / PDF
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Trip proof report</div>
        <h1 className="text-2xl font-bold">Trip {trip.id.slice(0, 8)}</h1>
        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <Field label="Purpose" value={trip.ride_purpose || "—"} />
          <Field label="Status" value={String(trip.status)} />
          <Field label="Pickup" value={trip.pickup_address} />
          <Field label="Drop-off" value={trip.dropoff_address} />
          <Field label="Scheduled pickup" value={fmt(trip.scheduled_pickup_time)} />
          <Field label="Actual pickup" value={fmt(trip.actual_pickup_time)} />
          <Field label="Actual drop-off" value={fmt(trip.actual_dropoff_time)} />
          <Field label="Signature timestamp" value={fmt(trip.signed_at)} />
          <Field label="Signer name" value={trip.signer_name || "—"} />
          <Field label="Odometer (start → end)" value={`${trip.odometer_start ?? "—"} → ${trip.odometer_end ?? "—"}`} />
          <Field label="GPS miles" value={trip.gps_miles ? `${Number(trip.gps_miles).toFixed(2)} mi` : "—"} />
        </div>
      </div>

      <ImageBlock title="Pickup odometer" url={urls.pickupOdometer} />
      <ImageBlock title="Drop-off odometer" url={urls.dropoffOdometer} />
      <ImageBlock title="Passenger signature" url={urls.signature} caption={fmt(trip.signed_at)} />

      {stops.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 text-sm font-semibold">Additional stops ({stops.length})</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {stops.map((s) => (
              <li key={s.id}>
                {s.address}
                {s.arrived_at && ` · arrived ${fmt(s.arrived_at)}`}
                {s.departed_at && ` · departed ${fmt(s.departed_at)}`}
              </li>
            ))}
          </ol>
        </div>
      )}

      {passengers.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 text-sm font-semibold">Group manifest ({passengers.length})</div>
          <ul className="space-y-1 text-sm">
            {passengers.map((p) => (
              <li key={p.id}>
                {p.name}{p.medicaid_id ? ` · ${p.medicaid_id}` : ""} — pickup #{p.pickup_sequence}, drop-off #{p.dropoff_sequence}
              </li>
            ))}
          </ul>
        </div>
      )}

      {media.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 text-sm font-semibold">Cabin video clips ({media.length})</div>
          <div className="grid grid-cols-2 gap-3">
            {media.map((m) => (
              <div key={m.id} className="space-y-1">
                <div className="text-xs text-muted-foreground">{m.kind.replace(/_/g, " ")} · {fmt(m.captured_at)}</div>
                {m.url ? <video controls src={m.url} className="w-full rounded-lg bg-black" /> : <div className="text-xs">unavailable</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold">GPS route log</div>
        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[10px]">
          {JSON.stringify(trip.gps_route ?? [], null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
function ImageBlock({ title, url, caption }: { title: string; url: string | null; caption?: string }) {
  if (!url) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <img src={url} alt={title} className="max-h-96 w-full rounded-lg object-contain" />
      {caption && <div className="mt-1 text-xs text-muted-foreground">{caption}</div>}
    </div>
  );
}
function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}
