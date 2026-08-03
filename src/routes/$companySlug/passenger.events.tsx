import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, CalendarDays, Loader2, MapPin, Megaphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listActiveEvents } from "@/lib/events.functions";
import { ensurePushSubscribed, pushSupported } from "@/lib/push";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/$companySlug/$companySlug/passenger/events")({
  ssr: false,
  component: EventsFeed,
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
};

function EventsFeed() {
  const listFn = useServerFn(listActiveEvents);
  const { user } = useAuth();
  const events = useQuery({ queryKey: ["passenger-events"], queryFn: () => listFn() });
  const [pushOn, setPushOn] = useState<boolean>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission === "granted"
      : false,
  );

  useEffect(() => {
    // Auto-prompt for permission for signed-in users on first visit.
    if (!user) return;
    if (Notification.permission === "default") {
      ensurePushSubscribed().then((ok) => setPushOn(ok));
    } else if (Notification.permission === "granted") {
      ensurePushSubscribed().then(() => setPushOn(true));
    }
  }, [user]);

  async function turnOnPush() {
    if (!user) {
      toast("Sign in to enable notifications", {
        description: "Create a free account to get event alerts.",
      });
      return;
    }
    const ok = await ensurePushSubscribed({ force: true });
    if (ok) {
      toast.success("Notifications on");
      setPushOn(true);
    } else {
      toast.error("Enable notifications in your browser settings");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/60 bg-surface/80 p-5 shadow-soft backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Events</h1>
            <p className="text-xs text-muted-foreground">
              Parties, free food, community meetups. Tap Book a ride to get there.
            </p>
          </div>
          {pushSupported() && (
            <Button
              size="sm"
              variant={pushOn ? "outline" : "default"}
              onClick={turnOnPush}
              className="rounded-full"
            >
              {pushOn ? (
                <><BellOff className="mr-1 h-3.5 w-3.5" /> On</>
              ) : (
                <><Bell className="mr-1 h-3.5 w-3.5" /> Enable</>
              )}
            </Button>
          )}
        </div>
        {!user && (
          <div className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            <AppLink to="/passenger/signup" className="font-medium text-primary hover:underline">
              Sign in
            </AppLink>{" "}
            to get push notifications when new events are posted.
          </div>
        )}
      </div>

      {events.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (events.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No events right now — check back soon.
        </div>
      ) : (
        <ul className="space-y-3">
          {(events.data as EventRow[]).map((ev) => (
            <EventCard key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCard({ ev }: { ev: EventRow }) {
  const bookHref = ev.location_address
    ? `/passenger/apply?dropoff=${encodeURIComponent(ev.location_address)}&eventTitle=${encodeURIComponent(ev.title)}`
    : "/passenger/apply";
  return (
    <li className="overflow-hidden rounded-3xl border border-border/60 bg-surface/80 shadow-soft backdrop-blur">
      {ev.image_url ? (
        <img src={ev.image_url} alt="" className="h-44 w-full object-cover" />
      ) : (
        <div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/20 via-primary/10 to-transparent text-primary">
          <Megaphone className="h-10 w-10" />
        </div>
      )}
      <div className="p-4">
        <h3 className="text-base font-semibold">{ev.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {new Date(ev.starts_at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {ev.location_address && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {ev.location_address}
            </span>
          )}
        </div>
        {ev.description && (
          <p className="mt-2 text-sm text-foreground/90">{ev.description}</p>
        )}
        <AppLink to={bookHref}>
          <Button className="mt-4 w-full rounded-full">Book a ride</Button>
        </AppLink>
      </div>
    </li>
  );
}
