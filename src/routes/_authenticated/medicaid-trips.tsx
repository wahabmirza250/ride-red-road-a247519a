import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { StatusPill } from "@/components/nemt/StatusPill";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/medicaid-trips")({
  component: MedicaidTripsPage,
});

function MedicaidTripsPage() {
  const { user, isAdmin } = useAuth();

  const trips = useQuery({
    queryKey: ["medicaid_trips", "mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicaid_trips")
        .select("id, pickup_at, pickup_address, dropoff_address, miles, status, riders(full_name, medicaid_id)")
        .order("pickup_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAdmin ? "All Medicaid Trips" : "My Medicaid Trips"}
        description="Colorado NEMT trip records"
        actions={
          <Link to="/medicaid-trips/new">
            <Button className="rounded-full">
              <Plus className="mr-1 h-4 w-4" /> New Trip
            </Button>
          </Link>
        }
      />

      {trips.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !trips.data?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No trips yet. Tap <span className="font-medium">New Trip</span> to fill out your first Colorado state form.
        </div>
      ) : (
        <div className="space-y-3">
          {trips.data.map((t: any) => (
            <div
              key={t.id}
              className="rounded-2xl border border-border bg-surface p-4 shadow-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {t.riders?.full_name ?? "Unknown rider"}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · Medicaid {t.riders?.medicaid_id}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(t.pickup_at)} · {t.miles} mi
                  </div>
                  <div className="mt-2 text-xs text-foreground/80">
                    <div className="truncate">↑ {t.pickup_address}</div>
                    <div className="truncate">↓ {t.dropoff_address}</div>
                  </div>
                </div>
                <StatusPill status={t.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
